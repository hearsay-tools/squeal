// Throwaway, row 005-110. On a code-store COPY only: query plan and time (median of N, warm) of the
// two code reads a boundary makes three times each: the failing states (`list` with an outcome) and
// the edited states (`edits`), as written, then with a candidate partial index, which is dropped after.
// Usage: node code-reads.mjs <copy code.sqlite> <worktree id> [N]
import { DatabaseSync } from "node:sqlite";
const [path, wt, n = "15"] = process.argv.slice(2);
if (!path.includes("/t/cd01ba62/")) throw new Error("refusing: not a scratch copy");
const db = new DatabaseSync(path);
const COLS = "c.path, c.qualified_name, c.occurrence";
const list = `SELECT s.*, ${COLS} FROM states s JOIN checks c ON c.id = s.check_id WHERE s.worktree_id = ? AND (? IS NULL OR s.measure = ?) AND (? IS NULL OR s.outcome = ?) ORDER BY c.path, c.qualified_name, c.occurrence, s.measure`;
const edits = `SELECT s.measure, s.edited_revision, s.edited_at, ${COLS} FROM states s JOIN checks c ON c.id = s.check_id WHERE s.worktree_id = ? AND s.measure = ? AND s.edited_at IS NOT NULL ORDER BY c.path, c.qualified_name, c.occurrence`;
const measures = db.prepare("SELECT measure, outcome, count(*) n, sum(edited_at IS NOT NULL) edited FROM states WHERE worktree_id = ? GROUP BY 1, 2").all(wt);
console.log(JSON.stringify({ worktree: wt, measures }));
const time = (sql, params) => { const st = db.prepare(sql); const xs = []; let rows = 0;
  for (let i = 0; i < Number(n); i++) { const t = performance.now(); rows = st.all(...params).length; xs.push(performance.now() - t); }
  xs.sort((a, b) => a - b); return { rows, medMs: +xs[Math.floor(xs.length / 2)].toFixed(2) }; };
const plan = (sql, params) => db.prepare("EXPLAIN QUERY PLAN " + sql).all(...params).map((r) => r.detail).join(" | ");
const m = measures[0]?.measure ?? "complexity";
const cases = { listFail: [list, [wt, null, null, "fail", "fail"]], listMeasureFail: [list, [wt, m, m, "fail", "fail"]], edits: [edits, [wt, m]] };
const run = (label) => { for (const [k, [sql, p]] of Object.entries(cases)) console.log(JSON.stringify({ label, k, ...time(sql, p), plan: plan(sql, p) })); };
run("as now");
db.exec("CREATE INDEX probe_states_edited ON states (worktree_id, measure) WHERE edited_at IS NOT NULL");
db.exec("CREATE INDEX probe_states_failing ON states (worktree_id) WHERE outcome = 'fail'");
run("with partial indexes (planner's choice)");
const forced = {
  listFailForced: [`SELECT s.*, ${COLS} FROM states s INDEXED BY probe_states_failing JOIN checks c ON c.id = s.check_id WHERE s.worktree_id = ? AND s.outcome = 'fail' ORDER BY c.path, c.qualified_name, c.occurrence, s.measure`, [wt]],
  editsForced: [`SELECT s.measure, s.edited_revision, s.edited_at, ${COLS} FROM states s INDEXED BY probe_states_edited JOIN checks c ON c.id = s.check_id WHERE s.worktree_id = ? AND s.measure = ? AND s.edited_at IS NOT NULL ORDER BY c.path, c.qualified_name, c.occurrence`, [wt, m]],
};
for (const [k, [sql, p]] of Object.entries(forced)) console.log(JSON.stringify({ label: "forced with INDEXED BY, plain predicate", k, ...time(sql, p), plan: plan(sql, p) }));
db.exec("DROP INDEX probe_states_edited"); db.exec("DROP INDEX probe_states_failing");
db.close();
