// THROWAWAY probe (011-core/research/catch-up.md). What each way of learning another worktree's
// stored results costs on cezar's store copy (390 MB, 315k results): (a) the storer looks up the
// rows at each key it stored (test_file_keys_by_key), as the heal does; (b) a receiver reads the
// keys recorded since a watermark (results_by_time) and intersects them with its stale keys;
// (c) a receiver re-looks-up every stale key (results_by_key); and the state listing a foreign
// `sink.refresh` begins with. Read-only; best of 5 runs each, load printed beside.
import { DatabaseSync } from "node:sqlite";
import { loadavg } from "node:os";
const db = new DatabaseSync(process.argv[2] ?? "/tmp/r3/cezar-store.sqlite", { readOnly: true });
const best = (fn) => { let b = Infinity, r; for (let i = 0; i < 5; i++) { const t = performance.now(); r = fn(); b = Math.min(b, performance.now() - t); } return [b, r]; };
const MAIN = "b7555ac0d0f19f40", SECOND = "ba5234dcb8b7abbe";
// The run-all c9183f's 200-file tier 70a6dce1 (21:42:50Z): its stored keys.
const tierKeys = db.prepare("select distinct key from results where run_id like '70a6dce1%'").all().map((r) => r.key);
const withKey = db.prepare("select worktree_id, project, path, pending from test_file_keys where key = ?");
const [aMs, aRows] = best(() => tierKeys.reduce((n, k) => n + withKey.all(k).filter((r) => r.worktree_id !== MAIN).length, 0));
console.log(`load ${loadavg()[0].toFixed(1)}`);
console.log(`(a) storer, one 200-file tier (${tierKeys.length} keys): ${aMs.toFixed(1)} ms for ${aRows} other worktrees' rows at those keys`);
const since = db.prepare("select distinct key from results where recorded_at > ? and recorded_at <= ?");
const t0 = Date.parse("2026-10-19T21:43:00Z");
for (const w of [1, 30]) {
  const [ms, rows] = best(() => since.all(t0, t0 + w * 1000));
  console.log(`(b) receiver, keys recorded in a ${w} s window during the run-all: ${ms.toFixed(2)} ms, ${rows.length} keys`);
}
const [idleMs] = best(() => since.all(Date.parse("2026-10-20T03:00:00Z"), Date.parse("2026-10-20T03:00:30Z")));
console.log(`(b) receiver, an empty window: ${idleMs.toFixed(3)} ms`);
const stale = db.prepare("select key from test_file_keys where worktree_id = ? and key is not null").all("c74589eb15bec84b").map((r) => r.key);
const byKey = db.prepare("select check_id, outcome from results where key = ?");
const [cMs, cHits] = best(() => stale.reduce((n, k) => n + (byKey.all(k).length > 0 ? 1 : 0), 0));
console.log(`(c) receiver, re-look-up of ${stale.length} stale keys: ${cMs.toFixed(1)} ms (${cHits} with results)`);
const states = db.prepare("select * from known_states where worktree_id = ?");
const keys = db.prepare("select * from test_file_keys where worktree_id = ?");
const [rMs, rN] = best(() => states.all(SECOND).length + keys.all(SECOND).length);
console.log(`foreign sink.refresh's begin(): ${rMs.toFixed(1)} ms to list ${rN} state and key rows of one worktree`);
const [pv] = best(() => db.prepare("select data_version from pragma_data_version").get());
console.log(`data_version read: ${pv.toFixed(3)} ms`);
