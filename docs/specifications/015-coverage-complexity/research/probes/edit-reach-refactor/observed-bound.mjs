// Bound on the observed-read carry-over: observed reads (recorded at main) of files that are in the
// value closure of the bundle entries at main but not at the candidate, and that the candidate reaches
// by no other path. If the CLI bundle no longer reads them, the "after" reach overstates by this much.
import { DatabaseSync } from "node:sqlite";
const b = (await import("/tmp/er112/out-main-static.json", { with: { type: "json" } })).default;
const a = (await import("/tmp/er112/out-cand-static.json", { with: { type: "json" } })).default;
const ENTRIES = ["src/cli/index.ts", "src/cli/ps-index.ts", "src/core/daemon/front-desk.ts", "src/core/code/coverage/map-worker.ts", "src/core/lint/provider/worker.ts"];
const bfs = (g, ss) => { const seen = new Set(ss); const q = [...ss]; while (q.length) { const x = q.pop(); for (const y of g[x]?.v ?? []) if (!seen.has(y)) { seen.add(y); q.push(y); } } return seen; };
const cb = bfs(b.graph, ENTRIES), ca = bfs(a.graph, ENTRIES);
const leave = new Set([...cb].filter((p) => !ca.has(p) && p in a.graph));
console.log("bundle closure: main", cb.size, "candidate", ca.size, "files kept by the candidate but out of its bundle closure", leave.size);
const db = new DatabaseSync("/tmp/er112/stores/store.sqlite", { readOnly: true });
const obs = JSON.parse(db.prepare("select value from meta where key = 'observed.'").get().value);
const mods = JSON.parse(db.prepare("select value from meta where key = 'observedModules.'").get().value);
const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
let sec = 0, editSec = 0, tests = 0;
for (const [t, info] of Object.entries(a.testSec)) {
  if (info.m || !obs[t]) continue;
  const v = bfs(a.graph, [t]); const m = new Set(mods[t] ?? []);
  let hit = 0;
  for (const p of obs[t]) if (leave.has(p) && CODE.test(p) && !v.has(p) && !m.has(p)) { hit++; sec += info.s; editSec += info.s * (a.edits[p] ?? 0); }
  if (hit) tests++;
}
console.log({ tests, pairSec: Math.round(sec), pairEditSec: Math.round(editSec),
  pctOfAfterPairSec: +(100 * sec / a.outcome.pairSec).toFixed(2), pctOfAfterEditSec: +(100 * editSec / a.outcome.pairEditSec).toFixed(2) });
