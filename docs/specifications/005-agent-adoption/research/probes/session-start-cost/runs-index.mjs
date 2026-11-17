// Throwaway. Times runs.inFlight's query (src/core/store/repos/runs.ts:36) on a store COPY before
// and after a partial index on open runs, and the index's size. Writes only to the copy.
// Usage: node runs-index.mjs <copy.sqlite> <worktree-id> <reps>
import { DatabaseSync } from "node:sqlite";
const [path, wt, reps] = process.argv.slice(2);
if (!path.includes("/t/38faef1c/")) throw new Error("copies only");
const db = new DatabaseSync(path);
const sql = `SELECT * FROM runs WHERE worktree_id = ? AND end_state IS NULL AND started_at >= ? ORDER BY started_at, rowid`;
const since = Date.now() - 3600_000;
const time = () => { const st = db.prepare(sql); const xs = []; for (let i = 0; i < Number(reps); i++) { const t = performance.now(); st.all(wt, since); xs.push(performance.now() - t); } xs.sort((a, b) => a - b); return { median: +xs[xs.length >> 1].toFixed(3), p90: +xs[Math.floor(xs.length * 0.9)].toFixed(3) }; };
const plan = () => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(wt, since).map((r) => r.detail).join(" | ");
db.exec("DROP INDEX IF EXISTS probe_runs_open");
console.log("before", plan(), JSON.stringify(time()));
const t = performance.now();
db.exec("CREATE INDEX probe_runs_open ON runs (worktree_id, started_at) WHERE end_state IS NULL");
const build = performance.now() - t;
let bytes = null; try { bytes = Number(db.prepare("SELECT SUM(pgsize) b FROM dbstat WHERE name='probe_runs_open'").get().b); } catch {}
console.log("after ", plan(), JSON.stringify(time()), `build ${build.toFixed(0)} ms, ${bytes} bytes`);
db.exec("DROP INDEX probe_runs_open");
