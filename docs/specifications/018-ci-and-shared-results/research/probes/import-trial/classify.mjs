// Throwaway (018-08): for test files whose key differs between two clones' stores, classify
// the closure paths the second store has and the first lacks, and the reverse (read-only).
import { DatabaseSync } from "node:sqlite";
const [A, B] = process.argv.slice(2, 4).map((p) => new DatabaseSync(p, { readOnly: true }));
const rows = (db) => new Map(db.prepare("select project, path, closure_paths c from test_files").all().map((r) => [r.project + "|" + r.path, JSON.parse(r.c)]));
const keys = (db) => new Map(db.prepare("select project, path, key from test_file_keys").all().map((r) => [r.project + "|" + r.path, r.key]));
const [ra, rb, ka, kb] = [rows(A), rows(B), keys(A), keys(B)];
const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const cls = (p) => uuid.test(p) ? "uuid-named" : /(^|\/)package\.json$/.test(p) ? "package.json" : /\.(ts|tsx|mjs|cjs|js)$/.test(p) ? "source/script" : "other";
const plus = {}, minus = {}; let files = 0, onlyUuid = 0; const others = new Map();
for (const [id, k] of ka) {
  if (id.startsWith("e2e|") || kb.get(id) === k || !ra.has(id) || !rb.has(id)) continue;
  files++;
  const x = new Set(ra.get(id)), y = new Set(rb.get(id));
  const p = [...y].filter((q) => !x.has(q)), m = [...x].filter((q) => !y.has(q));
  for (const q of p) { plus[cls(q)] = (plus[cls(q)] ?? 0) + 1; if (cls(q) !== "uuid-named") others.set(q, (others.get(q) ?? 0) + 1); }
  for (const q of m) minus[cls(q)] = (minus[cls(q)] ?? 0) + 1;
  if (p.length + m.length > 0 && [...p, ...m].every((q) => uuid.test(q))) onlyUuid++;
}
console.log({ files, onlyUuid, extraInSecond: plus, extraInFirst: minus });
console.log("most common non-uuid extras:", [...others].sort((a, b) => b[1] - a[1]).slice(0, 15));
