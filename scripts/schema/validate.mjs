// Validates GraphQL strings against Shopify's Admin API 2025-10 schema, so the mocked tests fail
// on a field or argument that doesn't exist in the real API. The schema is the introspection file
// shipped in @shopify/dev-mcp@1.5.0 (dist/data/admin_2025-10.json.gz), copied here unchanged.
import fs from "node:fs";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { buildClientSchema, parse, validate, getVariableValues } from "graphql";

const file = fileURLToPath(new URL("./admin_2025-10.json.gz", import.meta.url));
let schema = null;
export function adminSchema() {
  return (schema ??= buildClientSchema(JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8")).data));
}
const seen = new Map(); // query text -> error list, so each distinct string is checked once
export function schemaErrors(query) {
  if (!seen.has(query)) {
    let errs;
    try { errs = validate(adminSchema(), parse(query)).map((e) => e.message); }
    catch (e) { errs = [`parse: ${e.message}`]; }
    seen.set(query, errs);
  }
  return seen.get(query);
}
export const checked = () => [...seen.keys()];

// Checks the variables sent with a query against its variable types (input field names, enum
// values, required fields), the part validate() can't see.
export function variableErrors(query, variables = {}) {
  let doc;
  try { doc = parse(query); } catch (e) { return [`parse: ${e.message}`]; }
  const op = doc.definitions.find((d) => d.kind === "OperationDefinition");
  const { errors } = getVariableValues(adminSchema(), op?.variableDefinitions ?? [], variables ?? {});
  return (errors ?? []).map((e) => e.message);
}
