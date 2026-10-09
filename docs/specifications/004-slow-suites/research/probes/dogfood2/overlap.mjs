// Slow-file runs of several worktrees, from their stores (read only): each run's start,
// end and files, then every interval where the number of slow files running changed,
// per worktree and in total, against the per-user permits. Times UTC.
// Usage: node overlap.mjs <since iso> <label>=<store.sqlite>:<worktree-id>:<slow-path regex> ...
import { DatabaseSync } from "node:sqlite";

const [since, ...specs] = process.argv.slice(2);
const hm = (ms) => (ms == null ? "-" : new Date(ms).toISOString().slice(11, 23));
const events = [];
const now = Date.now();
for (const spec of specs) {
  const [label, rest] = spec.split("=");
  const [file, wt, re] = rest.split(":");
  const isSlow = new RegExp(re);
  const db = new DatabaseSync(file, { readOnly: true });
  const runs = db.prepare("select * from runs where worktree_id = ? and started_at > ? order by started_at").all(wt, Date.parse(since));
  // A run with no end whose file a later run re-ran was abandoned when its daemon died: cut there.
  for (const r of runs) {
    const slow = JSON.parse(r.test_files).map((f) => f.path ?? f).filter((p) => isSlow.test(p));
    if (slow.length === 0) continue;
    const later = runs.find((y) => y.started_at > r.started_at && JSON.parse(y.test_files).some((f) => isSlow.test(f.path ?? f)));
    const abandoned = r.ended_at == null && later !== undefined && JSON.parse(later.test_files).some((f) => (f.path ?? f) === JSON.parse(r.test_files)[0].path);
    const end = r.ended_at ?? (abandoned ? later.started_at : now);
    console.log(`${label} ${hm(r.started_at)} -> ${r.ended_at ? hm(r.ended_at) : abandoned ? "abandoned (daemon died; cut at its re-run)" : "running"} (${((end - r.started_at) / 1000).toFixed(1)} s) ${r.end_state ?? "-"} ${slow.length} file(s): ${slow.map((p) => p.split("/").at(-1)).join(" ")}`);
    events.push({ at: r.started_at, label, d: slow.length }, { at: end, label, d: -slow.length });
  }
}
console.log("\n## slow files running at once (per worktree, total)");
events.sort((a, b) => a.at - b.at || a.d - b.d);
const count = {};
let last = "";
for (const e of events) {
  count[e.label] = (count[e.label] ?? 0) + e.d;
  const total = Object.values(count).reduce((a, b) => a + b, 0);
  const line = `${Object.entries(count).map(([k, v]) => `${k}=${v}`).join(" ")} total=${total}`;
  if (line !== last) console.log(`${hm(e.at)} ${line}`);
  last = line;
}
