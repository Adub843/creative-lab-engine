// Lists every database collection the Lab's code names, so the move from claude.ai copies all of them.
// node scripts/find-collections.mjs <lab site folder>   ->  fixed names, then dynamic calls to check by hand
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const root = process.argv[2]; const fixed = new Set(), dynamic = new Set();
const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (!/vendor|minipaint|img/.test(f)) walk(p); } else if (/\.(js|html)$/.test(f)) scan(p); } };
function scan(p) {
  const s = readFileSync(p, "utf8");
  for (const m of s.matchAll(/\.(collection|doc)\(\s*(["'`])([^"'`$]*)(\$\{|\2|["'`]\s*\+)/g)) {
    const first = m[3].split("/")[0]; if (first) fixed.add(first); else dynamic.add(p.replace(root, "") + ": " + m[0]);
  }
  for (const m of s.matchAll(/\.(collection|doc)\(\s*([A-Za-z_][\w.]*(\[[^\]]*\])?(\.[\w]+)?)\s*[,)+]/g)) dynamic.add(p.replace(root, "") + ": " + m[0]);
  for (const m of s.matchAll(/\b(?:col|map)\(\s*["']([a-z][\w-]*)["']/g)) fixed.add(m[1]); // research.js helpers
  for (const m of s.matchAll(/[A-Z_]*COLS\s*=\s*\[([^\]]*)\]/g)) for (const n of m[1].matchAll(/["']([a-z][\w-]*)["']/g)) fixed.add(n[1]);
}
walk(root);
console.log([...fixed].sort().join("\n"));
console.error("\nDynamic names to check by hand:\n" + [...dynamic].sort().join("\n"));
