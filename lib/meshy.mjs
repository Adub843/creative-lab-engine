// Charleston 3D's 3D generator: a photo (or up to four views) or a description in, a printable model out,
// made by Meshy (https://docs.meshy.ai) with Aaron's Meshy account. The key lives only in the Worker
// (secret MESHY_API_KEY), so the browser never sees it; every route needs the console key.
// GET  /api/meshy                              is Meshy connected, and the credit balance
// GET  /api/meshy/tasks                        the latest models of every kind, newest first
// GET  /api/meshy/tasks/:kind/:id              one model (the page asks again while it's being made)
// POST /api/meshy/tasks                        start one: { kind: "text"|"image"|"refine", prompt, images, texture }
// GET  /api/meshy/tasks/:kind/:id/:part        its picture (thumb) or a file (glb, stl, 3mf, obj), with the key
//                                              or a signed link (?exp=&sig=) from the task, so <img> and downloads work
// handleMeshy(req, { env, fetch }) returns a Response.
import { createHmac, timingSafeEqual } from "node:crypto";
import { requireKey } from "./shopify.mjs";

const BASE = "https://api.meshy.ai/openapi";
// Each kind of task and where Meshy keeps it.
export const KINDS = { text: "v2/text-to-3d", image: "v1/image-to-3d", multi: "v1/multi-image-to-3d" };
// The formats asked for: GLB for the preview, STL and 3MF for Bambu Studio, OBJ for anything else.
// Meshy only makes a 3MF when it is asked for by name.
export const FORMATS = ["glb", "stl", "3mf", "obj"];
export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_BODY = (MAX_IMAGES * MAX_IMAGE_BYTES * 4) / 3 + 64 * 1024;
const ID_RE = /^[0-9a-f-]{8,64}$/i;
const DATA_RE = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const FILE_TYPES = { glb: "model/gltf-binary", stl: "model/stl", "3mf": "model/3mf", obj: "model/obj" };

const BASE_HEADERS = { "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; frame-ancestors 'none'; sandbox" };
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const keyRefusal = (req, env, what) => {
  try { requireKey({ header: (k) => req.headers.get(k) }, env, what); return null; }
  catch (e) { return json({ error: e.message, code: e.code }, e.status); }
};

// Signed links, like the 3D file library's, so pictures and downloads open without sending the key.
const LINK_MS = 60 * 60 * 1000;
const sigFor = (path, exp, env) => createHmac("sha256", `meshy-link:${env("CONSOLE_KEY")}`).update(`${path}.${exp}`).digest("base64url");
const signed = (path, env) => {
  const exp = (Math.floor(Date.now() / LINK_MS) + 2) * LINK_MS;
  return `/api/meshy/tasks/${path}?exp=${exp}&sig=${sigFor(path, exp, env)}`;
};
const validLink = (req, path, env) => {
  if (!env("CONSOLE_KEY")) return false;
  const q = new URL(req.url).searchParams;
  const exp = Number(q.get("exp")), sig = q.get("sig") ?? "";
  if (!Number.isSafeInteger(exp) || exp < Date.now() || exp > Date.now() + 2 * LINK_MS) return false;
  const want = Buffer.from(sigFor(path, exp, env)), got = Buffer.from(sig);
  return got.length === want.length && timingSafeEqual(got, want);
};

// Meshy's own answers, turned into a plain reason Aaron can act on.
function meshyError(status, body) {
  const said = typeof body?.message === "string" ? body.message.slice(0, 300) : "";
  if (status === 401) return json({ error: "Meshy refused the API key. Put a fresh one in with: npx wrangler secret put MESHY_API_KEY", code: "meshy_key" }, 502);
  if (status === 402) return json({ error: "Not enough Meshy credits for that. Top up at meshy.ai, then try again.", code: "meshy_credits" }, 402);
  if (status === 429) return json({ error: "Meshy is busy with too many requests. Wait a minute and try again.", code: "meshy_busy" }, 429);
  if (status === 400) return json({ error: said ? `Meshy couldn't take that: ${said}` : "Meshy couldn't take that request.", code: "meshy_rejected" }, 400);
  return json({ error: `Meshy answered with an error (${status}). Try again in a minute.`, code: "meshy_error" }, 502);
}

async function call(ctx, method, path, body) {
  let res;
  try {
    res = await ctx.fetch(`${BASE}/${path}`, {
      method,
      headers: { authorization: `Bearer ${ctx.env("MESHY_API_KEY")}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { error: json({ error: "Couldn't reach Meshy just now. Try again in a minute.", code: "meshy_offline" }, 502) };
  }
  const out = await res.json().catch(() => null);
  if (!res.ok) return { error: meshyError(res.status, out) };
  return { out };
}

// One task as the page needs it. Meshy's own download links are never passed on: the page gets
// signed links to this Worker, which fetches the file from Meshy itself.
export function shapeTask(t, kind, env) {
  const path = `${kind}/${t.id}`;
  const formats = FORMATS.filter((f) => typeof t.model_urls?.[f] === "string");
  return {
    id: t.id, kind,
    mode: kind === "text" ? (String(t.type ?? t.mode ?? "").includes("refine") ? "refine" : "preview") : kind,
    status: t.status, progress: Number(t.progress) || 0,
    prompt: typeof t.prompt === "string" ? t.prompt : "",
    textured: kind === "text" ? String(t.type ?? t.mode ?? "").includes("refine") : !!(t.texture_urls?.length),
    created: t.created_at ?? null, finished: t.finished_at ?? null,
    credits: Number.isFinite(t.consumed_credits) ? t.consumed_credits : null,
    error: t.task_error?.message || null,
    queue: t.status === "PENDING" && Number.isFinite(t.preceding_tasks) ? t.preceding_tasks : null,
    thumbUrl: t.thumbnail_url ? signed(`${path}/thumb`, env) : null,
    files: Object.fromEntries(formats.map((f) => [f, signed(`${path}/${f}`, env)])),
  };
}

// What the page sends, checked before any credits are spent.
export function parseCreate(body) {
  if (!body || typeof body !== "object") return { error: "Send what to make." };
  const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 800) : "";
  const texture = body.texture === true;
  if (body.kind === "refine") {
    if (!ID_RE.test(String(body.previewId ?? ""))) return { error: "Pick the shape to add colour to." };
    return { kind: "text", payload: { mode: "refine", preview_task_id: body.previewId, target_formats: FORMATS, ...(prompt ? { texture_prompt: prompt } : {}) } };
  }
  if (body.kind === "text") {
    if (prompt.length < 3) return { error: "Describe the model in a few words." };
    return { kind: "text", payload: { mode: "preview", prompt, target_formats: FORMATS } };
  }
  if (body.kind === "image") {
    const images = Array.isArray(body.images) ? body.images : [];
    if (!images.length) return { error: "Add a photo of the object." };
    if (images.length > MAX_IMAGES) return { error: `Use up to ${MAX_IMAGES} photos of the same object.` };
    for (const img of images) {
      const m = typeof img === "string" ? DATA_RE.exec(img) : null;
      if (!m) return { error: "Photos must be PNG, JPG or WebP." };
      if ((m[2].length * 3) / 4 > MAX_IMAGE_BYTES) return { error: "Each photo must be under 8 MB." };
    }
    const common = { should_texture: texture, target_formats: FORMATS, ...(texture && prompt ? { texture_prompt: prompt } : {}) };
    return images.length === 1
      ? { kind: "image", payload: { image_url: images[0], ...common } }
      : { kind: "multi", payload: { image_urls: images, ...common } };
  }
  return { error: "Choose a photo or a description." };
}

async function readCapped(req, max) {
  if (Number(req.headers.get("content-length")) > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => {}); return null; }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

// Only Meshy's own file host is ever fetched, so a task can't point this Worker anywhere else.
const meshyAsset = (u) => {
  try { const h = new URL(u); return h.protocol === "https:" && (h.hostname === "meshy.ai" || h.hostname.endsWith(".meshy.ai")); }
  catch { return false; }
};

export async function handleMeshy(req, ctx) {
  const env = ctx.env;
  let rest;
  try { rest = decodeURIComponent(new URL(req.url).pathname.replace(/^\/api\/meshy\/?/, "")); }
  catch { return json({ error: "Not found" }, 404); }
  const [section = "", kind = "", id = "", part = "", extra] = rest.split("/");
  if (extra !== undefined || (section && section !== "tasks")) return json({ error: "Not found" }, 404);
  if (kind && (!Object.hasOwn(KINDS, kind) || !ID_RE.test(id))) return json({ error: "Not found" }, 404);
  if (part && part !== "thumb" && !FORMATS.includes(part)) return json({ error: "Not found" }, 404);

  // A picture or a file: the key or a signed link.
  if (req.method === "GET" && part) {
    if (!validLink(req, `${kind}/${id}/${part}`, env)) {
      const refused = keyRefusal(req, env, "Meshy models");
      if (refused) return json({ error: "Not found" }, 404);
    }
    if (!env("MESHY_API_KEY")) return json({ error: "Meshy isn't connected yet." }, 503);
    const { out, error } = await call(ctx, "GET", `${KINDS[kind]}/${id}`);
    if (error) return error;
    const src = part === "thumb" ? out?.thumbnail_url : out?.model_urls?.[part];
    if (typeof src !== "string" || !meshyAsset(src)) return json({ error: "That file isn't ready." }, 404);
    let res;
    try { res = await ctx.fetch(src); } catch { res = null; }
    if (!res?.ok || !res.body) return json({ error: "Couldn't fetch the file from Meshy just now." }, 502);
    const name = `${(out.prompt || "meshy-model").replace(/[^\w\- ]+/g, "").trim().slice(0, 60).replace(/\s+/g, "-") || "meshy-model"}-${id.slice(0, 8)}.${part}`;
    const headers = { ...BASE_HEADERS, "cache-control": "private, max-age=3600" };
    if (part === "thumb") headers["content-type"] = /png/i.test(res.headers.get("content-type") ?? "") ? "image/png" : "image/jpeg";
    else { headers["content-type"] = "application/octet-stream"; headers["content-disposition"] = `attachment; filename="${name}"`; headers["x-file-type"] = FILE_TYPES[part]; }
    const len = res.headers.get("content-length");
    if (len) headers["content-length"] = len;
    return new Response(res.body, { headers });
  }

  const refused = keyRefusal(req, env, "The 3D generator");
  if (refused) return refused;
  if (!env("MESHY_API_KEY"))
    return json({ configured: false, error: "Meshy isn't connected yet. Aaron adds his Meshy API key once with: npx wrangler secret put MESHY_API_KEY", code: "meshy_not_set" }, section ? 503 : 200);

  if (req.method === "GET" && !section) {
    const { out, error } = await call(ctx, "GET", "v1/balance");
    if (error) return error;
    return json({ configured: true, balance: Number.isFinite(out?.balance) ? out.balance : null });
  }

  if (req.method === "GET" && !kind) {
    const lists = await Promise.all(Object.entries(KINDS).map(async ([k, path]) => {
      const { out, error } = await call(ctx, "GET", `${path}?page_size=24&sort_by=-created_at`);
      return { k, items: error ? null : (Array.isArray(out) ? out : []) , error };
    }));
    const failed = lists.find((l) => !l.items);
    if (failed && lists.every((l) => !l.items)) return failed.error;
    const items = lists.flatMap(({ k, items }) => (items ?? []).map((t) => shapeTask(t, k, env)));
    items.sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
    return json({ items: items.slice(0, 48) });
  }

  if (req.method === "GET") {
    const { out, error } = await call(ctx, "GET", `${KINDS[kind]}/${id}`);
    if (error) return error;
    return json({ item: shapeTask(out, kind, env) });
  }

  if (req.method === "POST" && !kind) {
    const text = await readCapped(req, MAX_BODY);
    if (text === null) return json({ error: "Those photos are too large. Use smaller pictures." }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: "Send a JSON body" }, 400); }
    const parsed = parseCreate(body);
    if (parsed.error) return json({ error: parsed.error }, 400);
    const { out, error } = await call(ctx, "POST", KINDS[parsed.kind], parsed.payload);
    if (error) return error;
    if (typeof out?.result !== "string") return json({ error: "Meshy didn't say which task it started." }, 502);
    return json({ item: { id: out.result, kind: parsed.kind, status: "PENDING", progress: 0, prompt: parsed.payload.prompt ?? "", files: {} } }, 201);
  }

  return json({ error: "Not supported" }, 405);
}
