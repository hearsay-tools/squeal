import { testFileId } from "../core/keys/index.js";
import { readHeader, testFileKeyOf } from "../core/state/index.js";
import { type CheckCounts, checkPartsText } from "../core/status/index.js";
import { plural } from "../core/text.js";
import type {
  KnownState,
  RevisionNumber,
  Store,
  TestFileRef,
  Validity,
  WorktreeId,
} from "../core/types/index.js";

/** A test file as the verdict counts it: `current` only when every check it has is. */
type FileClass = Exclude<Validity, "current"> | "current";

/**
 * What the store says of a set of test files at the worktree's current
 * revision (spec 005 D1): how many have a current result, how many do not
 * and why, and the known failures among them.
 */
export interface FileVerdict {
  readonly revision: RevisionNumber;
  readonly testFiles: number;
  readonly byClass: Readonly<Record<FileClass, number>>;
  /** The runner has not listed the revision's test files yet (`runnerPartPending`). */
  readonly unlisted: boolean;
  readonly failures: CheckCounts;
}

/**
 * Reads the verdict on `files`, or on every test file the worktree lists when
 * `null`. A named file the worktree does not list counts as `unknown`. A
 * file is `pending` while queued or running or any check is, else `unknown`
 * while unkeyed, without checks or with an unknown check, else `stale` with
 * a stale check, else `current`.
 */
export function readVerdict(
  store: Store,
  worktreeId: WorktreeId,
  files: readonly TestFileRef[] | null = null,
): FileVerdict {
  const states = store.knownStates.list(worktreeId);
  const keys = store.testFileKeys.list(worktreeId);
  const header = readHeader(store, worktreeId, states, keys);
  const checks = new Map<string, KnownState[]>();
  for (const state of states) {
    const id = testFileKeyOf(state.check);
    checks.set(id, [...(checks.get(id) ?? []), state]);
  }
  const rows = new Map(keys.map((row) => [testFileId(row.testFile), row]));
  const ids = files === null ? [...rows.keys()] : [...new Set(files.map(testFileId))];
  const byClass: Record<FileClass, number> = { current: 0, pending: 0, stale: 0, unknown: 0 };
  const failures = { tests: 0, testFiles: 0 };
  for (const id of ids) {
    const row = rows.get(id);
    const own = checks.get(id) ?? [];
    const has = (validity: Validity) => own.some((s) => s.validity === validity);
    const queued = row !== undefined && row.key !== null && row.pending !== null;
    const unkeyed = row === undefined || row.key === null;
    byClass[
      queued || has("pending")
        ? "pending"
        : unkeyed || own.length === 0 || has("unknown")
          ? "unknown"
          : has("stale")
            ? "stale"
            : "current"
    ]++;
    for (const state of own) {
      if (state.outcome === "fail") failures[state.check.kind === "test" ? "tests" : "testFiles"]++;
    }
  }
  // Task 001-382: a failed global setup is no test file's, and counts for the project's files.
  const projects = new Set(ids.map((id) => rows.get(id)?.testFile.project));
  const setups = states.filter(
    (s) =>
      s.check.kind === "setup" &&
      s.outcome === "fail" &&
      (files === null || projects.has(s.check.project)),
  ).length;
  return {
    revision: header.revision,
    testFiles: ids.length,
    byClass,
    unlisted: header.runnerPartPending === true || header.awaitingInstall === true,
    failures: setups > 0 ? { ...failures, setups } : failures,
  };
}

/**
 * Spec 005 D1: `0` when every file has a current result and none fails, `1`
 * with known failures among current results, `3` when Squeal cannot say.
 */
export function verdictCode(verdict: FileVerdict): 0 | 1 | 3 {
  if (verdict.unlisted || verdict.byClass.current < verdict.testFiles) return 3;
  return failureCount(verdict.failures) > 0 ? 1 : 0;
}

/** Why `verdictCode` is `3`, as the clause after "has no verdict: "; `null` when it is not. */
export function noVerdictText(verdict: FileVerdict): string | null {
  const { byClass, revision } = verdict;
  if (verdict.unlisted) {
    return `the runner has not listed the test files of revision ${revision} yet`;
  }
  if (byClass.pending > 0) {
    return `${plural(byClass.pending, "test file")} still pending at revision ${revision}`;
  }
  const missing = byClass.unknown + byClass.stale;
  if (missing === 0) return null;
  const parts = [
    ...(byClass.unknown > 0 ? [`${byClass.unknown} unknown`] : []),
    ...(byClass.stale > 0 ? [`${byClass.stale} stale`] : []),
  ];
  return `${plural(missing, "test file")} without a current result at revision ${revision} (${parts.join(", ")})`;
}

/**
 * `no known failures`, or `3 known failures: 2 tests, 1 test file that did
 * not load`: tests and file-level checks named apart (spec 005 D1), a part
 * left out when it is zero.
 */
export function failuresText(failures: CheckCounts): string {
  const total = failureCount(failures);
  if (total === 0) return "no known failures";
  return `${plural(total, "known failure")}: ${checkPartsText(failures, "that did not load")}`;
}

function failureCount(failures: CheckCounts): number {
  return failures.tests + failures.testFiles + (failures.setups ?? 0);
}
