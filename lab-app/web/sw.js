/* The Lab's app shell: the page files are fetched fresh when the server answers, and the last good copy
   opens the app when it doesn't (for example away from home with Tailscale off). Data is never cached here. */
const SHELL = "lab-shell-v1";
self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== SHELL) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  if (u.pathname.startsWith("/_lab/") && !/^\/_lab\/(runtime\.js|icon|login|webauthn)/.test(u.pathname)) return; // live data and sign-in
  if (u.pathname.startsWith("/_blob/")) return; // files: the browser's own cache keeps them
  e.respondWith((async () => {
    try {
      const r = await fetch(e.request);
      if (r.ok && !r.redirected) (await caches.open(SHELL)).put(e.request, r.clone());
      return r;
    } catch {
      const hit = await caches.match(e.request, { ignoreSearch: e.request.mode === "navigate" });
      if (hit) return hit;
      if (e.request.mode === "navigate") return new Response(OFFLINE, { headers: { "content-type": "text/html; charset=utf-8" } });
      return Response.error();
    }
  })());
});
const OFFLINE = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Lab</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#15171b;color:#eef0f3;font:16px system-ui,sans-serif;text-align:center;padding:16px">
<div><h1 style="font-size:22px;margin:0 0 8px">Can't reach the Lab server</h1><p style="color:#a3a9b4;margin:0 0 20px">Turn Tailscale on, or check that the server is running.</p>
<button onclick="location.reload()" style="height:44px;padding:0 22px;border:0;border-radius:10px;background:#c9a24a;color:#1b1e23;font:inherit;font-weight:700">Try again</button></div>`;
