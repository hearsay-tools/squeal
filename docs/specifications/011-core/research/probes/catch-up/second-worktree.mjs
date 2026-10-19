// THROWAWAY probe (011-core/research/catch-up.md). Replays worktree 2d626467 (ba5234dc) on cezar
// commit 7fe10d99, 2026-10-19, from its lookup-only baselines at revision 48 (checkpoints
// 5e4538 at 21:24:14Z with 747 misses and 933724 at 21:56:52Z with 83): for each file the
// second baseline adopted, when the result at its revision-48 key was stored and by whom. Today
// it became current at the daemon's restart; adopting on store makes it current at the store.
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
const db = new DatabaseSync(process.argv[2] ?? "/tmp/r3/cezar-store.sqlite", { readOnly: true });
const WT = "ba5234dcb8b7abbe";
const cps = db.prepare("select id, started_at, test_files from checkpoints where worktree_id = ? and revision = 48 order by started_at").all(WT);
const files = (cp) => new Map(JSON.parse(cp.test_files).map((r) => [`${r.project}\0${r.path}`, r]));
const [first, second, third] = cps.map(files);
const [t1, t2, t3] = cps.map((c) => c.started_at);
// The key at revision 48: this worktree's row when it was written at or before 48 (rev 49 re-keyed the rest).
const row = db.prepare("select key, revision from test_file_keys where worktree_id = ? and project = ? and path = ?");
const atKey = db.prepare(`select r.worktree_id wt, r.outcome, r.recorded_at at, r.run_id from results r join checks c on c.id = r.check_id
  where r.key = ? and c.project = ? and c.test_path = ?`);
// Fallback when 49 re-keyed it: the file's results recorded by others between the baselines.
const between = db.prepare(`select r.key, r.worktree_id wt, r.outcome, r.recorded_at at from results r join checks c on c.id = r.check_id
  where c.project = ? and c.test_path = ? and r.recorded_at > ? and r.recorded_at <= ? and r.worktree_id != ?`);
const adopted = [...second.keys()].filter((id) => !third.has(id));
const rows = [];
let viaKey = 0, viaWindow = 0, none = 0;
for (const id of adopted) {
  const ref = second.get(id);
  const k = row.get(WT, ref.project, ref.path);
  let hits = k && k.revision <= 48 && k.key ? atKey.all(k.key, ref.project, ref.path) : [];
  if (hits.length > 0) viaKey++;
  else { hits = between.all(ref.project, ref.path, t2, t3, WT); if (hits.length) viaWindow++; else none++; }
  if (hits.length === 0) { rows.push({ id, at: null }); continue; }
  const at = Math.max(...hits.map((h) => h.at)); // a file is current once all its checks are stored
  rows.push({ id, at, by: [...new Set(hits.map((h) => h.wt.slice(0, 8)))].join(","), fail: hits.some((h) => h.outcome === "fail") });
}
const stored = rows.filter((r) => r.at !== null);
const iso = (t) => new Date(t).toISOString().slice(11, 19);
console.log(`baselines: ${iso(t1)} ${first.size} misses, ${iso(t2)} ${second.size}, ${iso(t3)} ${third.size}; adopted at the restart: ${adopted.length}`);
console.log(`key known at rev 48: ${viaKey}; matched by window: ${viaWindow}; no result found: ${none}`);
console.log(`stored by: ${JSON.stringify(Object.fromEntries([...new Set(stored.map((r) => r.by))].map((b) => [b, stored.filter((r) => r.by === b).length])))}`);
console.log(`with a fail among their checks: ${stored.filter((r) => r.fail).length}`);
const waits = stored.map((r) => (t3 - r.at) / 1000).sort((a, b) => a - b);
const sum = waits.reduce((a, b) => a + b, 0);
console.log(`stored ${iso(Math.min(...stored.map((r) => r.at)))} to ${iso(Math.max(...stored.map((r) => r.at)))}; stale after its result was stored: median ${waits[waits.length >> 1].toFixed(0)} s, max ${waits.at(-1).toFixed(0)} s, ${(sum / 60).toFixed(0)} file-minutes in all`);
// The curve: stale files of the 747 over time, today against adopt-on-store.
const curve = [];
for (let t = t2; t <= t3; t += 60_000) curve.push({ at: iso(t), today: second.size, adopt: second.size - stored.filter((r) => r.at <= t).length });
console.log(curve.filter((_, i) => i % 4 === 0).map((c) => `${c.at} ${c.today}/${c.adopt}`).join("  "));
writeFileSync("results/second-worktree.json", JSON.stringify({ baselines: [t1, t2, t3].map(iso), sizes: [first.size, second.size, third.size], viaKey, viaWindow, none, rows, curve }, null, 1));
