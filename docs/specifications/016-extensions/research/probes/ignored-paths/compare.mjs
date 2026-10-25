// Throwaway (016-19). Q2: two consecutive runs with no edit. Ignored file paths new in
// the second run, and ignored file paths of the first run that no longer exist.
// Usage: node compare.mjs <root> <run1/result.json> <run2/result.json>
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
const [root, a, b] = process.argv.slice(2);
const r1 = JSON.parse(readFileSync(a, "utf8")), r2 = JSON.parse(readFileSync(b, "utf8"));
const s1 = new Set(r1.files), s2 = new Set(r2.files);
const fresh = [...s2].filter((p) => !s1.has(p));
const gone = [...s1].filter((p) => !existsSync(join(root, p)));
const union = new Set([...s1, ...s2]);
const top = (p) => p.split("/").slice(0, p.startsWith("packages/") ? 3 : 1).join("/");
const group = (xs) => xs.reduce((m, p) => ((m[top(p)] = (m[top(p)] ?? 0) + 1), m), {});
console.log(JSON.stringify({ run1: s1.size, run2: s2.size, union: union.size,
  newInRun2: fresh.length, newByTop: group(fresh), sampleNew: fresh.slice(0, 15),
  run1Gone: gone.length, goneByTop: group(gone), sampleGone: gone.slice(0, 15) }, null, 1));
