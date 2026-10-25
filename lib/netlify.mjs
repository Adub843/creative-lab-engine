// The only Netlify-specific glue: turns a Web Request into the plain request the handlers in
// lib/ expect, and their { status, body } back into a Response. To move hosts, write the same
// few lines for the new platform and keep lib/shopify.mjs and lib/insights.mjs as they are.
export function netlifyHandler(handler) {
  return async (req) => {
    const url = new URL(req.url);
    const out = await handler(
      { method: req.method, query: url.searchParams, header: (k) => req.headers.get(k), text: () => req.text() },
      { env: (k) => globalThis.Netlify?.env?.get(k) ?? process.env[k], fetch: globalThis.fetch },
    );
    return new Response(JSON.stringify(out.body), {
      status: out.status,
      headers: {
        "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
        // netlify.toml [[headers]] don't reach function responses, so these are set here.
        "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; frame-ancestors 'none'; sandbox",
      },
    });
  };
}
