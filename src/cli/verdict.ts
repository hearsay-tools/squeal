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
import type { SyncState } from "./status-sync.js";

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
  if (classReason(verdict) !== null) return 3;
  return failureCount(verdict.failures) > 0 ? 1 : 0;
}

/**
 * Row 011-206 (gh-88, gh-84, gh-83; 011 C15): a selection's result word,
 * which its exit code says as 0, 1 or 3 (`resultCode`).
 */
export type SelectionWord = "pass" | "fail" | "none";

/**
 * Row 011-206: why a selection has no verdict, the one gate or class that
 * holds it, from this closed list. `no-daemon`, no daemon validates the
 * worktree; `lapsed`, a wait's last read found the heartbeat lapsed or a
 * handoff under way; `on-hold`, a selected file queued while the worktree is
 * on hold; `paused`, every selected file is slow and waits for a pause or
 * `run --slow`; `focused`, a `--check` answer with no failed check, not the
 * file's verdict; `unsynced`, the daemon's pass over the edits made before
 * the read is not stored at the results' revision; `unlisted`, the runner
 * has not listed the revision's test files; `pending`, a selected file, or
 * a focused run, is still pending; `not-current`, a selected file is stale
 * or unknown; `not-run`, a named path is a test file Squeal does not run;
 * `unmatched`, a path selects no test file.
 */
export type NoVerdictReason =
  | "no-daemon"
  | "lapsed"
  | "on-hold"
  | "paused"
  | "focused"
  | "unsynced"
  | "unlisted"
  | "pending"
  | "not-current"
  | "not-run"
  | "unmatched";

export type SelectionResult =
  | { readonly result: "pass" | "fail" }
  | { readonly result: "none"; readonly reason: NoVerdictReason };

/** What `selectionResult` reads of a named wait's or snapshot's last read. */
export interface SelectionRead {
  readonly outcome:
    | "settled"
    | "focused"
    | "unmatched"
    | "slow"
    | "no-daemon"
    | "on-hold"
    | "timeout";
  readonly verdict: FileVerdict;
  /** Where the daemon's pass stood at the read. */
  readonly sync: SyncState;
  /** `status <path>...` without `--wait`, whose sync the daemon could not answer gives none. */
  readonly snapshot?: boolean;
  /** A wait's last read found the heartbeat lapsed or a handoff under way. */
  readonly lapsed?: boolean;
  /** With `focused`: a selected check failed. */
  readonly focusFailed?: boolean;
  /** How many paths select nothing, and how many name a test file Squeal does not run. */
  readonly unmatched: number;
  readonly notRun: number;
}

/**
 * Row 011-206 (011 C15): the selection's result word and, without a
 * verdict, the one reason, which the exit code, the JSON and the verdict
 * line all read. The daemon's state first, as it explains the rest, then
 * the gates of the read, then the files' classes; a path that selects
 * nothing or names a test file Squeal does not run leaves no clean verdict,
 * but a known failure among the other files is still `fail` (row 011-63).
 */
export function selectionResult(read: SelectionRead): SelectionResult {
  const none = (reason: NoVerdictReason) => ({ result: "none", reason }) as const;
  if (read.outcome === "no-daemon") return none("no-daemon");
  if (read.lapsed === true) return none("lapsed");
  if (read.outcome === "on-hold") return none("on-hold");
  if (read.outcome === "slow") return none("paused");
  if (read.outcome === "focused")
    return read.focusFailed === true ? { result: "fail" } : none("focused");
  if (read.outcome === "unmatched") return none(read.notRun > 0 ? "not-run" : "unmatched");
  if (read.outcome === "timeout" && unsynced(read.sync, read.verdict.revision, read.snapshot)) {
    return none("unsynced");
  }
  const held = classReason(read.verdict);
  if (held !== null) return none(held);
  // Every file current at a timeout: what is left is a focused run (row 011-146).
  if (read.outcome === "timeout") return none("pending");
  if (failureCount(read.verdict.failures) > 0) return { result: "fail" };
  if (read.notRun > 0) return none("not-run");
  if (read.unmatched > 0) return none("unmatched");
  return { result: "pass" };
}

/** Spec 005 D1's exit code for a result word. */
export function resultCode(result: SelectionResult): 0 | 1 | 3 {
  return result.result === "pass" ? 0 : result.result === "fail" ? 1 : 3;
}

/**
 * Review wave-1, B1: the read came before the daemon's pass over the edits
 * made before it, so a result may predate them; a snapshot's sync the daemon
 * could not answer counts (review of cand/0.1.233, B1), a wait's falls back
 * to its settle time.
 */
export function unsynced(sync: SyncState, revision: number, snapshot = false): boolean {
  if (sync.state === "pending") return true;
  if (sync.state === "unsupported") return snapshot;
  return sync.revision > revision;
}

/** The class that leaves `verdict`'s files without one, by D1's order; `null` when every file is current. */
function classReason(verdict: FileVerdict): "unlisted" | "pending" | "not-current" | null {
  if (verdict.unlisted) return "unlisted";
  if (verdict.byClass.pending > 0) return "pending";
  return verdict.byClass.current < verdict.testFiles ? "not-current" : null;
}

/** Why `verdictCode` is `3`, as the clause after "has no verdict: "; `null` when it is not. */
export function noVerdictText(verdict: FileVerdict): string | null {
  const { byClass, revision } = verdict;
  const reason = classReason(verdict);
  if (reason === "unlisted") {
    return `the runner has not listed the test files of revision ${revision} yet`;
  }
  if (reason === "pending") {
    return `${plural(byClass.pending, "test file")} still pending at revision ${revision}`;
  }
  if (reason === null) return null;
  const missing = byClass.unknown + byClass.stale;
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
  const [hold] = readHolds(store, worktree, worktreeLiveness(worktree, now), now);
  if (hold === undefined) return null;
  // The rows only while on hold: a poll reads what decides it (C6 as amended, task 011-42).
  const rows = typeof keys === "function" ? keys() : keys;
  return rows.some((row) => row.pending === "queued") ? hold : null;
}
