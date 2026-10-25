// Throwaway probe (016-27), section 6: a crude static walk from one test file of a TypeScript workspace,
// following relative imports and `@open-mercato/cezar-contract[/x]` (cezar's contract package, whose
// exports map to `packages/contract/src/*.ts`), type-only imports left out, to tell whether a legacy observed path is still reachable.
// Reads files only. Usage: reach.mjs <repo root> <test file> <path>...
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
const [root, start, ...wanted] = process.argv.slice(2);
const seen = new Set();
const resolve = (from, spec) => {
  let base;
  if (spec.startsWith(".")) base = join(dirname(from), spec);
  else if (spec === "@open-mercato/cezar-contract") base = join(root, "packages/contract/src/index");
  else if (spec.startsWith("@open-mercato/cezar-contract/")) base = join(root, "packages/contract/src", spec.slice(29));
  else return null;
  base = base.replace(/\.js$/, "");
  for (const c of [`${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}/index.ts`, base]) if (existsSync(c) && !c.endsWith("/")) { try { readFileSync(c); return normalize(c); } catch {} }
  return null;
};
const walk = (file) => {
  if (seen.has(file)) return;
  seen.add(file);
  const text = readFileSync(file, "utf8");
  // Type-only imports and re-exports are erased at run time, so they load nothing.
  const code = text.replace(/^\s*(?:import|export)\s+type\b[^;]*;/gms, "");
  for (const m of code.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) { const r = resolve(file, m[1]); if (r) walk(r); }
};
walk(join(root, start));
const reached = new Set([...seen].map((f) => relative(root, f)));
for (const w of wanted) console.log(reached.has(w) ? "reachable" : "not reachable", w);
console.log("files reached", reached.size, "contract files", [...reached].filter((f) => f.startsWith("packages/contract/")).length);
