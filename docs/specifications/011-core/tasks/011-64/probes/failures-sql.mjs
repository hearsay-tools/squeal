// THROWAWAY probe (011-64 design, question 1). Times `squeal failures`' queries, today's and
// the filtered ones the design proposes, on a read-only store copy. Prints each plan and the
// median of RUNS timings with the load beside it.
// Usage: STORE=<copy.sqlite> WT=<worktree id> FILE=<test path> CHECK=<name part> node failures-sql.mjs
import { loadavg } from "node:os";
import { DatabaseSync } from "node:sqlite";

const store = process.env.STORE ?? "/tmp/t64/cezar-store.sqlite";
const db = new DatabaseSync(store, { readOnly: true });
const RUNS = Number(process.env.RUNS ?? 7);
const WT = process.env.WT ?? "b7555ac0d0f19f40";
const FILE = process.env.FILE ?? "packages/cezar/src/core/harness-parity.test.ts";
const CHECK = process.env.CHECK ?? "autosave";

const SELECT = `SELECT r.*, c.project AS check_project, c.test_path AS check_test_path,
  c.kind AS check_kind, c.full_name AS check_full_name, f.summary, f.errors
  FROM results r JOIN checks c ON c.id = r.check_id LEFT JOIN failure_texts f ON f.id = r.failure_id`;
// Today's (src/core/store/repos/results.ts at 775dfe14f).
const TODAY = `r.outcome = 'fail' AND (? IS NULL OR r.worktree_id = ?) AND (? IS NULL OR r.recorded_at >= ?)`;
// Proposed: the failure text column drives the plan; the filters are optional, as today's.
const FAILED = `r.failure_id IS NOT NULL AND r.outcome = 'fail'
  AND (? IS NULL OR r.worktree_id = ?) AND (? IS NULL OR r.recorded_at >= ?)`;
// Proposed, with the plan named (as `KEYS_SINCE` does): without `ANALYZE` statistics SQLite
// does not choose `results_by_failure` for `IS NOT NULL` by itself.
const SELECT_IDX = SELECT.replace("FROM results r", "FROM results r INDEXED BY results_by_failure");
const BY_FILE = `r.check_id IN (SELECT id FROM checks WHERE test_path = ? OR test_path LIKE ? ESCAPE '\\')`;
const NAME = `(CASE WHEN c2.project = '' THEN '' ELSE '[' || c2.project || '] ' END) || c2.test_path ||
  (CASE c2.kind WHEN 'test' THEN ' > ' || c2.full_name WHEN 'file' THEN ' (file-level)' ELSE ' (global setup)' END)`;
const BY_CHECK = `r.check_id IN (SELECT c2.id FROM checks c2 WHERE instr(${NAME}, ?) > 0)`;

const like = (path) => `${path.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}/%`;
const cases = [
  ["today: list, this worktree", `${SELECT} WHERE ${TODAY} ORDER BY r.recorded_at DESC, r.rowid DESC LIMIT 20`, [WT, WT, null, null]],
  ["today: list, every worktree", `${SELECT} WHERE ${TODAY} ORDER BY r.recorded_at DESC, r.rowid DESC LIMIT 20`, [null, null, null, null]],
  ["today: count, this worktree", `SELECT COUNT(*) n FROM results r WHERE ${TODAY}`, [WT, WT, null, null]],
  ["today: count, every worktree", `SELECT COUNT(*) n FROM results r WHERE ${TODAY}`, [null, null, null, null]],
  ["failed: list, every worktree", `${SELECT} WHERE ${FAILED} ORDER BY r.recorded_at DESC, r.rowid DESC LIMIT 20`, [null, null, null, null]],
  ["failed: count, every worktree", `SELECT COUNT(*) n FROM results r WHERE ${FAILED}`, [null, null, null, null]],
  ["failed: list, this worktree", `${SELECT} WHERE ${FAILED} ORDER BY r.recorded_at DESC, r.rowid DESC LIMIT 20`, [WT, WT, null, null]],
  ["failed+file: list, every worktree", `${SELECT} WHERE ${FAILED} AND ${BY_FILE} ORDER BY r.recorded_at DESC, r.rowid DESC LIMIT 100`, [null, null, null, null, FILE, like(FILE)]],
  ["failed+file: count, every worktree", `SELECT COUNT(*) n FROM results r WHERE ${FAILED} AND ${BY_FILE}`, [null, null, null, null, FILE, like(FILE)]],
  ["failed+dir: list, every worktree", `${SELECT} WHERE ${FAILED} AND ${BY_FILE} ORDER BY r.recorded_at DESC, r.rowid DESC LIMIT 100`, [null, null, null, null, "packages/web", like("packages/web")]],
  ["failed+check: list, every worktree", `${SELECT} WHERE ${FAILED} AND ${BY_CHECK} ORDER BY r.recorded_at DESC, r.rowid DESC LIMIT 100`, [null, null, null, null, CHECK]],
  ["failed+check: count, every worktree", `SELECT COUNT(*) n FROM results r WHERE ${FAILED} AND ${BY_CHECK}`, [null, null, null, null, CHECK]],
  ["failed: list all, every worktree (--limit 1000)", `${SELECT} WHERE ${FAILED} ORDER BY r.recorded_at DESC, r.rowid DESC LIMIT 1000`, [null, null, null, null]],
  ["indexed: list, every worktree", `${SELECT_IDX} WHERE ${FAILED} ORDER BY r.recorded_at DESC, r.rowid DESC LIMIT 20`, [null, null, null, null]],
  ["indexed: count, every worktree", `SELECT COUNT(*) n FROM results r INDEXED BY results_by_failure WHERE ${FAILED}`, [null, null, null, null]],
  ["indexed: list, this worktree", `${SELECT_IDX} WHERE ${FAILED} ORDER BY r.recorded_at DESC, r.rowid DESC LIMIT 20`, [WT, WT, null, null]],
  ["indexed: count, this worktree", `SELECT COUNT(*) n FROM results r INDEXED BY results_by_failure WHERE ${FAILED}`, [WT, WT, null, null]],
  ["indexed+file: list, every worktree", `${SELECT_IDX} WHERE ${FAILED} AND ${BY_FILE} ORDER BY r.recorded_at DESC, r.rowid DESC LIMIT 100`, [null, null, null, null, FILE, like(FILE)]],
  ["indexed+dir: list, every worktree", `${SELECT_IDX} WHERE ${FAILED} AND ${BY_FILE} ORDER BY r.recorded_at DESC, r.rowid DESC LIMIT 100`, [null, null, null, null, "packages/web", like("packages/web")]],
  ["indexed+dir: count, every worktree", `SELECT COUNT(*) n FROM results r INDEXED BY results_by_failure WHERE ${FAILED} AND ${BY_FILE}`, [null, null, null, null, "packages/web", like("packages/web")]],
  ["indexed+check: list, every worktree", `${SELECT_IDX} WHERE ${FAILED} AND ${BY_CHECK} ORDER BY r.recorded_at DESC, r.rowid DESC LIMIT 100`, [null, null, null, null, CHECK]],
  ["indexed: list all, every worktree (--limit 1000)", `${SELECT_IDX} WHERE ${FAILED} ORDER BY r.recorded_at DESC, r.rowid DESC LIMIT 1000`, [null, null, null, null]],
  ["file without failure_id: list, every worktree", `${SELECT} WHERE ${TODAY} AND ${BY_FILE} ORDER BY r.recorded_at DESC, r.rowid DESC LIMIT 100`, [null, null, null, null, FILE, like(FILE)]],
];

console.log(`store ${store}; ${new Date().toISOString()}; runs ${RUNS}; file ${FILE}; check part "${CHECK}"`);
for (const [name, sql, params] of cases) {
  const statement = db.prepare(sql);
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((p) => p.detail);
  const times = [];
  let rows = 0;
  const load = loadavg()[0];
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    const out = statement.all(...params);
    times.push(performance.now() - t);
    rows = out.length === 1 && "n" in out[0] ? out[0].n : out.length;
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  console.log(`\n== ${name}: ${rows} rows; median ${median.toFixed(1)} ms, min ${times[0].toFixed(1)}, max ${times.at(-1).toFixed(1)}; load ${load.toFixed(2)}`);
  for (const step of plan) console.log(`   plan: ${step}`);
}
