# LabBridge: the Fusion add-in that builds the Lab's Fusion jobs.
#
# It runs inside Fusion (it starts with Fusion: runOnStartup in LabBridge.manifest) and never talks to the internet.
# The runner on this PC (creative-lab-engine\scripts\fusion-runner.mjs) puts each job in its own folder:
#     %LOCALAPPDATA%\CreativeLab\fusion-jobs\inbox\<job id>\job.json   (+ input.step / input.stl / design.svg)
# Every few seconds this add-in writes heartbeat.json (so the runner knows Fusion is up), takes the oldest folder
# that has a job.json but no result.json, builds it in a new Fusion design, saves the files the job asks for
# (model.3mf, model.stl, model.step and preview.png) next to it, closes the design and writes result.json.
#
# job.json: { id, name, code, params, formats }   code = Python text with make(design, root, P) (a recipe from
# tools\fusion\recipes or a script Claude/Stacy/Alice wrote). Fusion works in centimetres; P holds millimetres,
# so recipes use mm(). The helpers in labkit.py are handed to every script.
import adsk.core, adsk.fusion
import json, math, os, threading, time, traceback

APP = adsk.core.Application.get()
BASE = os.environ.get("LAB_FUSION_JOBS") or os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "CreativeLab", "fusion-jobs")
INBOX = os.path.join(BASE, "inbox")
EVENT_ID = "CreativeLabBridgeTick"
VERSION = "1.0.0"
_handlers = []
_stop = threading.Event()
_busy = False
_event = None


def _write_json(path, value):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(value, f)
    os.replace(tmp, path)


def _load_kit():
    here = os.path.dirname(os.path.abspath(__file__))
    ns = {"adsk": adsk, "math": math, "__name__": "labkit"}
    with open(os.path.join(here, "labkit.py"), encoding="utf-8") as f:
        exec(compile(f.read(), "labkit.py", "exec"), ns)
    return {k: v for k, v in ns.items() if not k.startswith("_")}


def _next_job():
    if not os.path.isdir(INBOX):
        return None
    folders = []
    for name in os.listdir(INBOX):
        d = os.path.join(INBOX, name)
        if os.path.isfile(os.path.join(d, "job.json")) and not os.path.exists(os.path.join(d, "result.json")):
            folders.append((os.path.getmtime(os.path.join(d, "job.json")), d))
    return sorted(folders)[0][1] if folders else None


def _export(design, folder, formats):
    root = design.rootComponent
    em = design.exportManager
    files = {}
    if "step" in formats:
        p = os.path.join(folder, "model.step")
        em.execute(em.createSTEPExportOptions(p, root))
        files["step"] = "model.step"
    if "stl" in formats or "3mf" in formats:
        p = os.path.join(folder, "model.stl")
        o = em.createSTLExportOptions(root, p)
        o.isBinaryFormat = True
        o.meshRefinement = adsk.fusion.MeshRefinementSettings.MeshRefinementHigh
        em.execute(o)
        if "stl" in formats:
            files["stl"] = "model.stl"
    if "3mf" in formats:
        p = os.path.join(folder, "model.3mf")
        try:
            em.execute(em.createC3MFExportOptions(root, p))
            files["3mf"] = "model.3mf"
        except Exception:
            # Older Fusion builds have no 3MF export: the runner makes the 3MF from model.stl instead.
            files["3mf_from_stl"] = "model.stl"
    return files


def _size_mm(root):
    box = None
    for b in list(root.bRepBodies) + list(root.meshBodies):
        bb = b.boundingBox
        if box is None:
            box = bb.copy()
        else:
            box.combine(bb)
    for occ in root.allOccurrences:
        for b in list(occ.bRepBodies) + list(occ.meshBodies):
            if box is None:
                box = b.boundingBox.copy()
            else:
                box.combine(b.boundingBox)
    if box is None:
        return None
    return {k: round((getattr(box.maxPoint, k) - getattr(box.minPoint, k)) * 10, 2) for k in ("x", "y", "z")}


def _run_job(folder):
    started = time.time()
    with open(os.path.join(folder, "job.json"), encoding="utf-8") as f:
        job = json.load(f)
    result = {"id": job.get("id"), "ok": False, "addin": VERSION}
    doc = None
    try:
        doc = APP.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
        design = adsk.fusion.Design.cast(APP.activeProduct)
        design.designType = adsk.fusion.DesignTypes.DirectDesignType
        design.fusionUnitsManager.distanceDisplayUnits = adsk.fusion.DistanceUnits.MillimeterDistanceUnits
        root = design.rootComponent
        P = dict(job.get("params") or {})
        P["_folder"] = folder
        for name in os.listdir(folder):
            if name.startswith("input."):
                P["_input"] = os.path.join(folder, name)
            if name == "design.svg":
                P["_svg"] = os.path.join(folder, name)
        ns = dict(_load_kit())
        ns.update({"adsk": adsk, "math": math, "app": APP, "__name__": "labjob"})
        exec(compile(job["code"], "job-%s.py" % job.get("id", "x"), "exec"), ns)
        ns["make"](design, root, P)
        size = _size_mm(root)
        if not size:
            raise RuntimeError("The job made no solid. Check the sizes or the script.")
        result["size"] = size
        result["files"] = _export(design, folder, job.get("formats") or ["3mf", "stl"])
        try:
            vp = APP.activeViewport
            vp.camera.viewOrientation = adsk.core.ViewOrientations.IsoTopRightViewOrientation
            vp.fit()
            if vp.saveAsImageFile(os.path.join(folder, "preview.png"), 400, 400):
                result["preview"] = "preview.png"
        except Exception:
            pass
        result["ok"] = True
    except Exception:
        result["error"] = traceback.format_exc()[-3000:]
    finally:
        try:
            if doc:
                doc.close(False)
        except Exception:
            pass
    result["seconds"] = round(time.time() - started, 1)
    _write_json(os.path.join(folder, "result.json"), result)


class _Tick(adsk.core.CustomEventHandler):
    def notify(self, args):
        global _busy
        if _busy:
            return
        _busy = True
        try:
            os.makedirs(INBOX, exist_ok=True)
            _write_json(os.path.join(BASE, "heartbeat.json"), {"at": time.time(), "version": VERSION, "fusion": APP.version})
            folder = _next_job()
            if folder:
                _run_job(folder)
        except Exception:
            try:
                with open(os.path.join(BASE, "addin-error.log"), "a", encoding="utf-8") as f:
                    f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + traceback.format_exc() + "\n")
            except Exception:
                pass
        finally:
            _busy = False


class _Clock(threading.Thread):
    # Fusion's API may only be used on Fusion's own thread, so this thread just asks Fusion to run _Tick.
    def run(self):
        while not _stop.wait(5):
            try:
                APP.fireCustomEvent(EVENT_ID, "")
            except Exception:
                pass


def run(context):
    global _event
    try:
        _event = APP.registerCustomEvent(EVENT_ID)
        h = _Tick()
        _event.add(h)
        _handlers.append(h)
        _stop.clear()
        _Clock(daemon=True).start()
    except Exception:
        APP.userInterface.messageBox("LabBridge couldn't start:\n" + traceback.format_exc())


def stop(context):
    _stop.set()
    try:
        if _event and _handlers:
            _event.remove(_handlers[0])
        APP.unregisterCustomEvent(EVENT_ID)
    except Exception:
        pass
    _handlers.clear()
