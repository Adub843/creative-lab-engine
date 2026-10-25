// Charleston 3D product publishing for the console.
// GET  /api/products   every Shopify product with whether it's live on charleston3d.com
// POST /api/products   { id, live } puts a product on the site (active + published to the site's
//                      sales channel) or takes it off, then rebuilds the site.
// Writes require the x-console-key header to match the CONSOLE_KEY env var when it is set.
// Env: SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_TOKEN, SITE_PUBLICATION_ID, SITE_BUILD_HOOK

const API_VERSION = "2025-10";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const env = (k) => Netlify.env.get(k);
const canWrite = (req) => {
  const key = env("CONSOLE_KEY");
  return !key || req.headers.get("x-console-key") === key;
};

async function admin(query, variables = {}) {
  const res = await fetch(`https://${env("SHOPIFY_STORE_DOMAIN")}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Shopify-Access-Token": env("SHOPIFY_ADMIN_TOKEN") },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) throw new Error(`Shopify: ${JSON.stringify(body.errors ?? res.status)}`);
  return body.data;
}

const userErrors = (payload) => {
  const errs = payload?.userErrors ?? [];
  if (errs.length) throw new Error(errs.map((e) => e.message).join(" "));
};

async function list(pub) {
  const products = [];
  let cursor = null;
  do {
    const d = await admin(`query($cursor: String, $pub: ID!) {
      products(first: 100, after: $cursor, sortKey: UPDATED_AT, reverse: true) {
        pageInfo { hasNextPage endCursor }
        nodes { id handle title status productType updatedAt
          featuredMedia { preview { image { url } } }
          priceRangeV2 { minVariantPrice { amount } }
          publishedOnPublication(publicationId: $pub) } } }`, { cursor, pub });
    for (const p of d.products.nodes)
      products.push({
        id: p.id, handle: p.handle, title: p.title, status: p.status, type: p.productType, updatedAt: p.updatedAt,
        image: p.featuredMedia?.preview?.image?.url ?? null,
        price: Number(p.priceRangeV2.minVariantPrice.amount),
        live: p.status === "ACTIVE" && p.publishedOnPublication,
      });
    cursor = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
  } while (cursor);
  return products;
}

async function setLive(id, live, pub) {
  if (live) {
    const u = await admin(`mutation($p: ProductUpdateInput!) { productUpdate(product: $p) { userErrors { message } } }`,
      { p: { id, status: "ACTIVE" } });
    userErrors(u.productUpdate);
    const p = await admin(`mutation($id: ID!, $pub: ID!) { publishablePublish(id: $id, input: [{ publicationId: $pub }]) { userErrors { message } } }`, { id, pub });
    userErrors(p.publishablePublish);
  } else {
    const p = await admin(`mutation($id: ID!, $pub: ID!) { publishableUnpublish(id: $id, input: [{ publicationId: $pub }]) { userErrors { message } } }`, { id, pub });
    userErrors(p.publishableUnpublish);
  }
  const hook = env("SITE_BUILD_HOOK");
  if (hook) await fetch(hook, { method: "POST", body: "" }).catch(() => {});
  return Boolean(hook);
}

export default async (req) => {
  const pub = env("SITE_PUBLICATION_ID");
  if (!env("SHOPIFY_STORE_DOMAIN") || !env("SHOPIFY_ADMIN_TOKEN") || !pub)
    return json({ error: "Shopify isn't connected yet. Set SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_TOKEN and SITE_PUBLICATION_ID in Netlify." }, 503);

  try {
    if (req.method === "GET") return json({ products: await list(pub) });

    if (req.method === "POST") {
      if (!canWrite(req)) return json({ error: "Wrong or missing console key" }, 401);
      const { id, live } = await req.json().catch(() => ({}));
      if (typeof id !== "string" || !id.startsWith("gid://shopify/Product/") || typeof live !== "boolean")
        return json({ error: "Send { id: product gid, live: true | false }" }, 400);
      const rebuilding = await setLive(id, live, pub);
      return json({ id, live, rebuilding });
    }
    return json({ error: "Not supported" }, 405);
  } catch (e) {
    return json({ error: e.message }, 502);
  }
};

export const config = { path: "/api/products" };
