// THROWAWAY timing (011-154). What a start pays when none of its misses has a previous key: for
// every test file with stored checks, `newestResults` as `src/core/scheduler/bootstrap.ts` reads it
// (the checks of the file, the newest result of each, then the rows of the newest key), on a copy
// of squeal's store. Beside it, `byKey` alone, what a miss with a previous key already reads.
// Median of RUNS passes over all files, with the one-minute load beside each.
// Usage, from the repository root, on a copy (the store is opened read and write):
//   REPO=<dir whose .git/squeal/store.sqlite is the copy> RUNS=5 \
//     tsx docs/specifications/011-core/tasks/011-154/start-cost.ts
import { loadavg } from "node:os";
import { join } from "node:path";
import { durationOf } from "../../../../../src/core/scheduler/files.js";
import { connectionOf } from "../../../../../src/core/store/store.js";
import { isStoreOpenFailure, openStore } from "../../../../../src/core/store/index.js";
import type { ResultRecord, Store, TestFileRef } from "../../../../../src/core/types/index.js";

const REPO = process.env.REPO ?? "/tmp/t154/repo";
const RUNS = Number(process.env.RUNS ?? 5);

const opened = openStore(join(REPO, ".git"));
if (isStoreOpenFailure(opened)) throw new Error(`store: ${JSON.stringify(opened)}`);
const store: Store = opened;

// `newestResults` as d663048d8 shipped it in `bootstrap.ts`.
function newestResults(ref: TestFileRef): readonly ResultRecord[] {
  let newest: ResultRecord | null = null;
  for (const { check } of store.checks.listByTestFile(ref)) {
    const result = store.results.latestForCheck(check);
    if (
      result !== null &&
      (newest === null || result.provenance.recordedAt > newest.provenance.recordedAt)
    ) {
      newest = result;
    }
  }
  if (newest === null) return [];
  return store.results
    .byKey(newest.key, 0)
    .filter(({ check }) => check.project === ref.project && check.testPath === ref.path);
}

const refs = connectionOf(store)
  .all("SELECT DISTINCT project, test_path FROM checks ORDER BY project, test_path")
  .map((row) => ({ project: String(row.project), path: String(row.test_path) }));
const checks = refs.reduce((n, ref) => n + store.checks.listByTestFile(ref).length, 0);
const keys = refs.map((ref) => newestResults(ref)[0]?.key ?? null);
console.log(`files ${refs.length}, checks ${checks}, with a stored result ${keys.filter(Boolean).length}`);

function time(label: string, pass: () => number): void {
  const runs: { ms: number; load: number; known: number }[] = [];
  for (let i = 0; i < RUNS; i++) {
    const load = loadavg()[0] ?? 0;
    const started = performance.now();
    const known = pass();
    runs.push({ ms: performance.now() - started, load, known });
  }
  const sorted = runs.map((r) => r.ms).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const each = runs.map((r) => `${r.ms.toFixed(0)} ms at load ${r.load.toFixed(0)}`).join(", ");
  console.log(`${label}: median ${median.toFixed(0)} ms, ${((median * 1000) / refs.length).toFixed(0)} µs a file; ${each}; ${runs[0]?.known} durations`);
}

time("newestResults, every file", () =>
  refs.reduce((n, ref) => n + (durationOf(newestResults(ref)) === null ? 0 : 1), 0),
);
// The store read 011-154 ships: one statement a file. It must give every file the same duration.
const differ = refs.filter(
  (ref) => durationOf(newestResults(ref)) !== durationOf(store.results.newestForTestFile(ref)),
);
console.log(`files whose two durations differ: ${differ.length}`);
time("results.newestForTestFile, every file", () =>
  refs.reduce((n, ref) => n + (durationOf(store.results.newestForTestFile(ref)) === null ? 0 : 1), 0),
);
time("byKey of the newest key alone, every file", () =>
  keys.reduce((n, key) => n + (key !== null && store.results.byKey(key, 0).length > 0 ? 1 : 0), 0),
);
store.close();
