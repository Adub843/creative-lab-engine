// GET /api/insights?store=c3d|ed&days=90   sales, sessions, growth, forecast and next steps
// Logic lives in lib/insights.mjs; this file only adapts it to Netlify.
import { handleInsights } from "../../lib/insights.mjs";
import { netlifyHandler } from "../../lib/netlify.mjs";

export default netlifyHandler(handleInsights);
export const config = { path: "/api/insights" };
