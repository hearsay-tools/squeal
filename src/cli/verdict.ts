import { worktreeLiveness } from "../core/delivery/index.js";
import { testFileId } from "../core/keys/index.js";
import { type FileClass, fileClassOf, readHeader, testFileKeyOf } from "../core/state/index.js";
import {
  type CheckCounts,
  checkPartsText,
  readHolds,
  unknownFileText,
} from "../core/status/index.js";
import { plural } from "../core/text.js";
import type {
  EpochMs,
  KnownState,
  RevisionNumber,
  StatusHold,
  StatusResult,
  Store,
  TestFileKeyRecord,
  TestFileRef,
  WorktreeId,
} from "../core/types/index.js";

/* Row 011-26: the class moved to `src/core/state`, where `readHeader` counts by it. */
export { type FileClass, fileClassOf } from "../core/state/index.js";

/**
 * How a set of test files stands at the worktree's current revision: how
 * many have a current result and how many do not and why, which is what
 * decides whether a wait on them ends (task 011-42).
 */
export interface FileClasses {
  readonly revision: RevisionNumber;
  readonly testFiles: number;
  readonly byClass: Readonly<Record<FileClass, number>>;
  /** The runner has not listed the revision's test files yet (`runnerPartPending`). */
  readonly unlisted: boolean;
}

/** What the store says of a set of test files (spec 005 D1): their classes and the known failures among them. */
export interface FileVerdict extends FileClasses {
  readonly failures: CheckCounts;
}

/**
 * The classes of `files`, or of every test file the worktree lists when
 * `null`, read from their own states and rows only: a wait's poll reads
 * this, never every state of the worktree for a few files (task 011-42).
 */
export function readClasses(
  store: Store,
  worktreeId: WorktreeId,
  files: readonly TestFileRef[] | null = null,
): FileClasses {
  const only = files ?? undefined;
  const states = store.knownStates.list(worktreeId, only);
  return tally(store, worktreeId, files, states, store.testFileKeys.list(worktreeId, only)).classes;
}

/**
 * Reads the verdict on `files`, or on every test file the worktree lists when
 * `null`, each file classed by `fileClassOf`. It reads every state: a failed
 * global setup is no test file's and counts for its project's files (task
 * 001-382), and no read lists a worktree's setup checks apart.
 */
export function readVerdict(
  store: Store,
  worktreeId: WorktreeId,
  files: readonly TestFileRef[] | null = null,
): FileVerdict {
  const states = store.knownStates.list(worktreeId);
  const keys = store.testFileKeys.list(worktreeId, files ?? undefined);
  const { classes, ids, rows, checks } = tally(store, worktreeId, files, states, keys);
  const failures = { tests: 0, testFiles: 0 };
  for (const id of ids) {
    for (const state of checks.get(id) ?? []) {
      if (state.outcome === "fail") failures[state.check.kind === "test" ? "tests" : "testFiles"]++;
    }
  }
  const projects = new Set(ids.map((id) => rows.get(id)?.testFile.project));
  const setups = states.filter(
    (s) =>
      s.check.kind === "setup" &&
      s.outcome === "fail" &&
      (files === null || projects.has(s.check.project)),
  ).length;
  return { ...classes, failures: setups > 0 ? { ...failures, setups } : failures };
}

/** `files`' classes from `states` and `keys`, which hold at least theirs, grouped in one pass. */
function tally(
  store: Store,
  worktreeId: WorktreeId,
  files: readonly TestFileRef[] | null,
  states: readonly KnownState[],
  keys: readonly TestFileKeyRecord[],
) {
  const header = readHeader(store, worktreeId, states, keys);
  const checks = new Map<string, KnownState[]>();
  for (const state of states) {
    const id = testFileKeyOf(state.check);
    const own = checks.get(id);
    if (own === undefined) checks.set(id, [state]);
    else own.push(state);
  }
  const rows = new Map(keys.map((row) => [testFileId(row.testFile), row]));
  const ids = files === null ? [...rows.keys()] : [...new Set(files.map(testFileId))];
  const byClass: Record<FileClass, number> = { current: 0, pending: 0, stale: 0, unknown: 0 };
  for (const id of ids) byClass[fileClassOf(rows.get(id), checks.get(id) ?? [])]++;
  const classes: FileClasses = {
    revision: header.revision,
    testFiles: ids.length,
    byClass,
    unlisted: header.runnerPartPending === true || header.awaitingInstall === true,
  };
  return { classes, ids, rows, checks };
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

/**
 * Task 001-403: after a verdict line that has none, the test file without a
 * result and why, or the first of several, which status then lists; empty
 * when status names none.
 */
export function gapText(status: StatusResult): string {
  const listed = status.available ? status.unknownTestFiles : undefined;
  const [first] = listed?.files ?? [];
  if (listed === undefined || first === undefined) return "";
  if (listed.total === 1) return `. Without a result: ${unknownFileText(first)}`;
  return `. Without a result: ${listed.total} test files, listed below; the first: ${unknownFileText(first)}`;
}

/**
 * Row 011-73 (spec 011 C6 as amended 2026-10-21): the hold a wait returns
 * with, the worktree's first, when one of `keys`, the rows of the files the
 * wait holds for, is queued; `null` otherwise. No tier starts while on hold,
 * so only the hold's end advances a queued file, and a wait would only spend
 * its deadline. A file running in a tier begun before the hold is waited for.
 * `keys` is read only while the worktree is on hold.
 */
export function holdOfWait(
  store: Store,
  worktreeId: WorktreeId,
  keys: readonly TestFileKeyRecord[] | (() => readonly TestFileKeyRecord[]),
  now: EpochMs,
): StatusHold | null {
  const worktree = store.worktrees.get(worktreeId);
  const [hold] = readHolds(store, worktree, worktreeLiveness(worktree, now));
  if (hold === undefined) return null;
  // The rows only while on hold: a poll reads what decides it (C6 as amended, task 011-42).
  const rows = typeof keys === "function" ? keys() : keys;
  return rows.some((row) => row.pending === "queued") ? hold : null;
}
