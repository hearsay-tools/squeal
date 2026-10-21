// THROWAWAY timing (011-75 landing note). Times `store.failures`' statements as R1 ships them
// (`FAILURE_STATEMENTS`), beside today's `results.ts` SQL, on a read-only copy of cezar's store;
// then `readFailures` end to end (open, read, map) on the copy laid out as a fake repository.
// Median of RUNS, with the one-minute load beside each.
// Usage, from the repository root, with HOME and XDG_* under the scratch directory:
//   REPO=<dir whose .git/squeal/store.sqlite is the copy> WT=<worktree id> FILE=<test path>
//   DIR=<directory> CHECK=<name part> RUNS=7 tsx docs/specifications/011-core/tasks/011-75/timings.ts
import { loadavg } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { formatCheck } from "../../../../../src/core/state/index.js";
import { failurePaths, readFailures } from "../../../../../src/core/status/failures.js";
import { CHECK_COLUMNS, checkFrom } from "../../../../../src/core/store/codec.js";
import { FAILURE_STATEMENTS, type Statement } from "../../../../../src/core/store/repos/failures.js";
import type { FailureSelection } from "../../../../../src/core/types/index.js";

const REPO = process.env.REPO ?? "/tmp/t75/repo";
const STORE = join(REPO, ".git", "squeal", "store.sqlite");
const RUNS = Number(process.env.RUNS ?? 7);
const WT = process.env.WT ?? "b7555ac0d0f19f40";
const FILE = process.env.FILE ?? "packages/cezar/src/core/harness-parity.test.ts";
const DIR = process.env.DIR ?? "packages/web";
const CHECK = process.env.CHECK ?? "autosave";

const db = new DatabaseSync(STORE, { readOnly: true });

// Today's queries, `src/core/store/repos/results.ts` at 5216be24c (`listFailures`, `countFailures`).
const TODAY_WHERE = `r.outcome = 'fail' AND (? IS NULL OR r.worktree_id = ?) AND (? IS NULL OR r.recorded_at >= ?)`;
const today = {
  list: (wt: string | null, limit: number): Statement => ({
    sql: `SELECT r.*, ${CHECK_COLUMNS}, f.summary, f.errors FROM results r
      JOIN checks c ON c.id = r.check_id LEFT JOIN failure_texts f ON f.id = r.failure_id
      WHERE ${TODAY_WHERE} ORDER BY r.recorded_at DESC, r.rowid DESC LIMIT ?`,
    params: [wt, wt, null, null, limit],
  }),
  count: (wt: string | null): Statement => ({
    sql: `SELECT COUNT(*) AS n FROM results r WHERE ${TODAY_WHERE}`,
    params: [wt, wt, null, null],
  }),
};

function median(fn: () => number): { n: number; median: number; min: number; max: number } {
  const times: number[] = [];
  let n = 0;
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    n = fn();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  return { n, median: times[Math.floor(times.length / 2)] ?? 0, min: times[0] ?? 0, max: times.at(-1) ?? 0 };
}

function report(name: string, fn: () => number): void {
  const load = loadavg()[0] ?? 0;
  const r = median(fn);
  console.log(
    `${name}: ${r.n} rows; median ${r.median.toFixed(1)} ms, min ${r.min.toFixed(1)}, max ${r.max.toFixed(1)}; load ${load.toFixed(2)}`,
  );
}

/** Rows a statement returns, or its count; prepared once, as a CLI process does per statement. */
function rows({ sql, params }: Statement): () => number {
  const statement = db.prepare(sql);
  return () => {
    const out = statement.all(...(params as SQLInputValue[]));
    const first = out[0] as { n?: number } | undefined;
    return out.length === 1 && first?.n !== undefined ? first.n : out.length;
  };
}

/** `--check`: the failing checks, matched by printed name in JS, then list and count by them, in one read. */
function byCheck(base: FailureSelection, limit: number): () => number {
  return () => {
    db.exec("BEGIN");
    try {
      const failing = db
        .prepare(FAILURE_STATEMENTS.failingChecks(base).sql)
        .all(...(FAILURE_STATEMENTS.failingChecks(base).params as SQLInputValue[]))
        .map((row) => checkFrom(row));
      const selection = { ...base, checks: failing.filter((c) => formatCheck(c).includes(CHECK)) };
      const list = FAILURE_STATEMENTS.list(selection, limit);
      const count = FAILURE_STATEMENTS.count(selection);
      const listed = db.prepare(list.sql).all(...(list.params as SQLInputValue[])).length;
      db.prepare(count.sql).all(...(count.params as SQLInputValue[]));
      return listed;
    } finally {
      db.exec("COMMIT");
    }
  };
}

const every: FailureSelection = { worktreeId: null, since: null, paths: [], checks: null };
const own: FailureSelection = { ...every, worktreeId: WT };
console.log(
  `store ${STORE}; ${new Date().toISOString()}; runs ${RUNS}; worktree ${WT}; file ${FILE}; dir ${DIR}; check part "${CHECK}"`,
);
report("today: list 20, this worktree", rows(today.list(WT, 20)));
report("R1: list 20, this worktree", rows(FAILURE_STATEMENTS.list(own, 20)));
report("today: count, this worktree", rows(today.count(WT)));
report("R1: count, this worktree", rows(FAILURE_STATEMENTS.count(own)));
report("today: list 20, every worktree", rows(today.list(null, 20)));
report("R1: list 20, every worktree", rows(FAILURE_STATEMENTS.list(every, 20)));
report("today: count, every worktree", rows(today.count(null)));
report("R1: count, every worktree", rows(FAILURE_STATEMENTS.count(every)));
report("R1: one test file, list 20, every worktree", rows(FAILURE_STATEMENTS.list({ ...every, paths: [FILE] }, 20)));
report("R1: one test file, count, every worktree", rows(FAILURE_STATEMENTS.count({ ...every, paths: [FILE] })));
report("R1: a directory, list 100, every worktree", rows(FAILURE_STATEMENTS.list({ ...every, paths: [DIR] }, 100)));
report("R1: a directory, count, every worktree", rows(FAILURE_STATEMENTS.count({ ...every, paths: [DIR] })));
report("R1: failing checks, every worktree", rows(FAILURE_STATEMENTS.failingChecks(every)));
report(`R1: --check ${CHECK}, list 100 and count, every worktree, one read`, byCheck(every, 100));
report("today: list 1,000, every worktree", rows(today.list(null, 1000)));
report("R1: list 1,000, every worktree", rows(FAILURE_STATEMENTS.list(every, 1000)));
db.close();

// End to end: `readFailures` opens the copy as the CLI does, reads in one transaction and maps the rows.
const paths = (given: string[]) => {
  const out = failurePaths(REPO, given);
  if ("outside" in out) throw new Error(`outside: ${out.outside}`);
  return out.paths;
};
const read = (options: Parameters<typeof readFailures>[1]) => () => {
  const r = readFailures(REPO, options);
  if (!r.available) throw new Error(r.message);
  return r.failures.length;
};
report("readFailures: every worktree, 20", read({ allWorktrees: true }));
report("readFailures: one test file, every worktree", read({ allWorktrees: true, paths: paths([FILE]) }));
report("readFailures: a directory, 100, every worktree", read({ allWorktrees: true, paths: paths([DIR]), limit: 100 }));
report(`readFailures: --check ${CHECK}, every worktree`, read({ allWorktrees: true, checks: [CHECK] }));
report("readFailures: 1,000, every worktree", read({ allWorktrees: true, limit: 1000 }));
