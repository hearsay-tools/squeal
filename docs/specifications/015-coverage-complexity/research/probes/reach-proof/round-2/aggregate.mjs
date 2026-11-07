// Row 015-114 round 2: aggregate.mjs of round 1, reading 0.1.416's test_file_imports for --block.
// Row 015-114: pool a `squeal reach --json` answer into the research's units.
// Usage: node aggregate.mjs <reach.json> [<prefix regex>] [--block <store.sqlite> <root file>]
// Pair-seconds: an entry's seconds (each file's reach) times its files, split by
// its kinds and coverage shares; real edits weight by editSeconds instead.
// --block keeps only the files the root file reaches by stored import edges.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { inflateSync, inflateRawSync } from "node:zlib";

const [jsonPath, ...rest] = process.argv.slice(2);
const at = rest.indexOf("--block");
const prefix = at === 0 ? null : rest[0] ? new RegExp(rest[0]) : null;
const report = JSON.parse(readFileSync(jsonPath, "utf8"));

function block(storePath, root) {
  // Every walk stored at a key some worktree holds now; each blob is deflated JSON of [path, static, dynamic].
  const db = new DatabaseSync(storePath, { readOnly: true });
  const edges = new Map();
  const rows = db.prepare("select i.imports from test_file_imports i where exists (select 1 from test_file_keys k where k.project = i.project and k.path = i.path and k.key = i.key)").all();
  for (const r of rows) {
    const buf = Buffer.from(r.imports);
    let text;
    try { text = inflateSync(buf).toString(); } catch { text = inflateRawSync(buf).toString(); }
    for (const [path, stat, dyn] of JSON.parse(text)) edges.set(path, [...(stat ?? []), ...(dyn ?? [])]);
  }
  const seen = new Set([root]);
  const todo = [root];
  while (todo.length) for (const t of edges.get(todo.pop()) ?? []) if (!seen.has(t)) (seen.add(t), todo.push(t));
  return seen;
}
const keep = at >= 0 ? block(rest[at + 1], rest[at + 2]) : null;

const sums = { once: {}, edits: {} };
const add = (bucket, key, v) => (bucket[key] = (bucket[key] ?? 0) + v);
let files = 0, once = 0, edits = 0;
for (const e of report.files) {
  const own = e.files.filter((p) => (!prefix || prefix.test(p)) && (!keep || keep.has(p)));
  if (own.length === 0) continue;
  const part = own.length / e.files.length;
  const w = { once: e.seconds * own.length, edits: e.editSeconds * part };
  files += own.length; once += w.once; edits += w.edits;
  for (const m of ["once", "edits"]) {
    for (const [k, s] of Object.entries(e.kinds)) add(sums[m], `kind ${k}`, s * w[m]);
    for (const [k, s] of Object.entries(e.coverage)) add(sums[m], `cov ${k}`, s * w[m]);
  }
}
const pct = (v, t) => (t === 0 ? "-" : `${((100 * v) / t).toFixed(1)}%`);
console.log(`${jsonPath}: ${files} files, ${Math.round(once)} pair-s every source once, ${Math.round(edits)} by real edits`);
const keys = [...new Set([...Object.keys(sums.once), ...Object.keys(sums.edits)])].sort();
for (const k of keys) console.log(`  ${k.padEnd(36)} ${pct(sums.once[k] ?? 0, once).padStart(6)}  ${pct(sums.edits[k] ?? 0, edits).padStart(6)}`);
