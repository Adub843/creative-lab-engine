/* Sign-in for the Lab: a passkey (face, fingerprint or device PIN). A new device is added with a one-time setup code. */
(() => {
  const $ = id => document.getElementById(id);
  const W = window.SimpleWebAuthnBrowser;
  const next = (() => { const n = new URLSearchParams(location.search).get("next") || "/"; return n.startsWith("/") && !n.startsWith("//") ? n : "/"; })();
  const say = t => { $("msg").textContent = t || ""; };
  async function post(path, body) {
    const r = await fetch("/_lab/auth/" + path, { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error((j.error && j.error.message) || "The Lab server didn't answer.");
    return j;
  }
  const friendly = e => e && e.name === "NotAllowedError" ? "Sign-in was cancelled." : (e && e.message) || "Something went wrong.";
  function busy(btn, on) { btn.disabled = on; }

  fetch("/_lab/auth/me", { credentials: "same-origin" }).then(r => r.json()).then(j => { if (j.person) location.replace(next); }).catch(() => {});
  if (!W || !W.browserSupportsWebAuthn()) say("This browser can't use passkeys. Update it, or use Chrome, Edge or Safari.");

  $("go").onclick = async () => {
    say(""); busy($("go"), true);
    try {
      const { options, ticket } = await post("login-options");
      const response = await W.startAuthentication({ optionsJSON: options });
      await post("login-verify", { ticket, response });
      location.replace(next);
    } catch (e) { say(friendly(e)); } finally { busy($("go"), false); }
  };
  $("register").onclick = async () => {
    say(""); busy($("register"), true);
    try {
      const code = $("code").value.trim();
      if (!/^[0-9A-Fa-f]{5}-?[0-9A-Fa-f]{5}$/.test(code)) throw new Error("A setup code looks like 1A2B3-C4D5E.");
      const { options, ticket } = await post("register-options", { code });
      const response = await W.startRegistration({ optionsJSON: options });
      await post("register-verify", { ticket, response, device: navigator.userAgentData?.platform || navigator.platform || "" });
      location.replace(next);
    } catch (e) { say(friendly(e)); } finally { busy($("register"), false); }
  };
  $("code").addEventListener("input", e => { let v = e.target.value.toUpperCase().replace(/[^0-9A-F]/g, "").slice(0, 10); if (v.length > 5) v = v.slice(0, 5) + "-" + v.slice(5); e.target.value = v; });
  $("code").addEventListener("keydown", e => { if (e.key === "Enter") $("register").click(); });
  $("toSetup").onclick = () => { $("signin").hidden = true; $("setup").hidden = false; say(""); $("code").focus(); };
  $("toSignin").onclick = () => { $("setup").hidden = true; $("signin").hidden = false; say(""); };
  if (location.hash === "#setup") $("toSetup").click();
})();
