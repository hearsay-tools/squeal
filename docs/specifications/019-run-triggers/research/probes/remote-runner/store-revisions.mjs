// Throwaway (019-04): paths per watch revision and edit-run wall times in a store,
// opened read-only. Sizes are of the same path in the checkout given as the second argument
// (the bytes a whole-file sync would send). Usage: node store-revisions.mjs <store.sqlite> <checkout> [days]
import { DatabaseSync } from "node:sqlite";
import { statSync } from "node:fs";
import { join } from "node:path";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const root = process.argv[3];
const days = Number(process.argv[4] ?? 30);
const since = Date.now() - days * 86400000;
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const revs = db.prepare("SELECT changes FROM revisions WHERE trigger = 'watch' AND created_at >= ?").all(since);
const paths = [], bytes = [];
let missing = 0;
for (const r of revs) {
  const ch = JSON.parse(r.changes);
  paths.push(ch.length);
  let b = 0;
  for (const c of ch) {
    if (c.newHash === null) continue;
    try { b += statSync(join(root, c.path)).size; } catch { missing++; }
  }
  bytes.push(b);
}
console.log(`watch revisions since ${new Date(since).toISOString()}: ${revs.length}`);
console.log(`paths per revision: median ${q(paths, 0.5)}, p90 ${q(paths, 0.9)}, max ${Math.max(...paths)}`);
console.log(`whole-file bytes per revision (current sizes; ${missing} paths gone): median ${q(bytes, 0.5)}, p90 ${q(bytes, 0.9)}, max ${Math.max(...bytes)}`);
const runs = db.prepare("SELECT test_files, started_at, ended_at FROM runs WHERE checkpoint_id IS NULL AND ended_at IS NOT NULL AND started_at >= ?").all(since);
const wall = runs.map((r) => (r.ended_at - r.started_at) / 1000);
const files = runs.map((r) => JSON.parse(r.test_files).length);
console.log(`edit runs: ${runs.length}; wall s median ${q(wall, 0.5)}, p90 ${q(wall, 0.9)}; files per run median ${q(files, 0.5)}, p90 ${q(files, 0.9)}`);
const one = runs.filter((r) => JSON.parse(r.test_files).length === 1).map((r) => (r.ended_at - r.started_at) / 1000);
console.log(`one-file edit runs: ${one.length}; wall s median ${q(one, 0.5)}, p90 ${q(one, 0.9)}`);
