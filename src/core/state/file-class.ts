import { testFileId } from "../keys/reverse-index.js";
import type { CheckId } from "../types/check.js";
import type { TestFileRef } from "../types/keys.js";
import type {
  KnownOutcome,
  KnownState,
  PendingPhase,
  ResultOrigin,
  Validity,
} from "../types/state.js";
import type { ValidityCounts } from "../types/status.js";
import type { TestFileKeyRecord } from "../types/store-records.js";
import { testFileKeyOf, testFileOf } from "./derive.js";

/** A test file as the verdict counts it: `current` only when every check it has is. */
export type FileClass = Validity;

/*
 * Spec 025 D11 (row 025-11): what the header, status and a named wait read
 * of a worktree's known states, without a `KnownState` per check. Status
 * reads it from the store by SQL (`readWorktreeStates`); a caller that
 * holds the states makes it from them (`worktreeStatesOf`). One rule per
 * count reads it, so both give the same counts.
 */

/** Some of a test file's states, counted: by validity, by outcome, and whether one runs. */
export interface StatesTally {
  readonly count: number;
  readonly validity: Readonly<Record<Validity, number>>;
  readonly outcome: Readonly<Record<KnownOutcome, number>>;
  /** Whether a state's pending phase is `running`. */
  readonly running: boolean;
}

/** A test file's states, as the classes and lanes read them. */
export interface FileStates {
  readonly testFile: TestFileRef;
  /** Every state of the file, a global setup's at its path too, as `checksByFile` groups them. */
  readonly all: StatesTally;
  /** Its test and file checks' states: no global setup's. */
  readonly checks: StatesTally;
  /** The oldest and the newest `observedAt` of its current states; `null` with none. */
  readonly currentAt: number | null;
  readonly currentUpTo: number | null;
}

/** States counted alike: their check's kind, validity, outcome and, when current, origin. */
export interface StatesGroup {
  readonly kind: CheckId["kind"];
  readonly validity: Validity;
  readonly outcome: KnownOutcome;
  /** `null` when not current: no count reads a stale or pending state's origin. */
  readonly origin: ResultOrigin | null;
  readonly count: number;
}

/** A worktree's known states without a `KnownState` per check. */
export interface WorktreeStates {
  readonly groups: readonly StatesGroup[];
  /** Each test file with a state, by `testFileId`. */
  readonly files: ReadonlyMap<string, FileStates>;
  /**
   * The states that are not current, those that fail and every global
   * setup's, in `knownStates.list` order: the only ones a count reads one
   * by one (a pending check's phase, a failure, an unknown check's reason,
   * a project's setup).
   */
  readonly notable: readonly KnownState[];
}

/** Whether `state` is among `WorktreeStates.notable`. */
export function isNotable(state: KnownState): boolean {
  return state.validity !== "current" || state.outcome === "fail" || state.check.kind === "setup";
}

/** `states`, as the list `knownStates.list` reads, counted as `WorktreeStates`. */
export function worktreeStatesOf(states: readonly KnownState[]): WorktreeStates {
  const groups = new Map<string, { -readonly [K in keyof StatesGroup]: StatesGroup[K] }>();
  const own = new Map<string, KnownState[]>();
  for (const state of states) {
    const origin = state.validity === "current" ? state.origin : null;
    const id = JSON.stringify([state.check.kind, state.validity, state.outcome, origin]);
    const group = groups.get(id);
    if (group === undefined) {
      const { validity, outcome } = state;
      groups.set(id, { kind: state.check.kind, validity, outcome, origin, count: 1 });
    } else group.count++;
    const file = testFileKeyOf(state.check);
    const list = own.get(file);
    if (list === undefined) own.set(file, [state]);
    else list.push(state);
  }
  const files = new Map<string, FileStates>();
  for (const [id, list] of own) files.set(id, fileStatesOf(list));
  return { groups: [...groups.values()], files, notable: states.filter(isNotable) };
}

function fileStatesOf(own: readonly KnownState[]): FileStates {
  let currentAt: number | null = null;
  let currentUpTo: number | null = null;
  for (const s of own) {
    if (s.validity !== "current" || s.observedAt === null) continue;
    currentAt = currentAt === null ? s.observedAt : Math.min(currentAt, s.observedAt);
    currentUpTo = currentUpTo === null ? s.observedAt : Math.max(currentUpTo, s.observedAt);
  }
  return {
    testFile: testFileOf((own[0] as KnownState).check),
    all: tallyOf(own),
    checks: tallyOf(own.filter((s) => s.check.kind !== "setup")),
    currentAt,
    currentUpTo,
  };
}

const isRunning = (state: KnownState) => state.pendingPhase === "running";

/** `own` counted. */
export function tallyOf(own: readonly KnownState[]): StatesTally {
  const validity = { current: 0, pending: 0, stale: 0, unknown: 0 };
  const outcome = { pass: 0, fail: 0, skip: 0, unknown: 0 };
  for (const s of own) {
    validity[s.validity]++;
    outcome[s.outcome]++;
  }
  return { count: own.length, validity, outcome, running: own.some(isRunning) };
}

/** No state at all. */
export const NO_STATES: StatesTally = tallyOf([]);

/**
 * `row`'s class from its checks `own`: `pending` while queued or running or
 * any check is, else `unknown` while unkeyed, without checks or with an
 * unknown check, else `stale` with a stale check, else `current`. A file the
 * worktree does not list (`row` undefined) is `unknown`. A named wait's
 * verdict (`readVerdict`) and the header's `testFileCounts` both class by it
 * (row 011-26).
 */
export function fileClassOf(
  row: TestFileKeyRecord | undefined,
  own: readonly KnownState[],
): FileClass {
  return classOf(row, tallyOf(own));
}

/** `fileClassOf` from its checks' states counted (`StatesTally`); none when `undefined`. */
export function classOf(
  row: TestFileKeyRecord | undefined,
  own: StatesTally = NO_STATES,
): FileClass {
  const has = (validity: Validity) => own.validity[validity] > 0;
  const queued = row !== undefined && row.key !== null && row.pending !== null;
  const unkeyed = row === undefined || row.key === null;
  if (queued || has("pending")) return "pending";
  if (unkeyed || own.count === 0 || has("unknown")) return "unknown";
  return has("stale") ? "stale" : "current";
}

/** What `notCurrentText` counts, from one pass over a worktree's states and key rows. */
export interface NotCurrentCounts {
  readonly testFileCounts: ValidityCounts;
  readonly testFilesByPhase: Readonly<Record<PendingPhase, number>>;
  readonly testsByPhase: Readonly<Record<PendingPhase, number>>;
}

/**
 * Spec 011 C6 as amended 2026-10-20 (gh-45, row 011-26): every listed test
 * file by `fileClassOf`, and the pending files and pending tests by phase.
 * A pending check without a phase takes its file's, else is queued; a file
 * or check of a file an open run holds (`openFiles`, `testFileId`s) is
 * running, though a re-key queued it under its new key (C15), as status's
 * breakdown counts checks.
 */
export function countNotCurrent(
  states: readonly KnownState[],
  keys: readonly TestFileKeyRecord[],
  openFiles: ReadonlySet<string> = new Set(),
): NotCurrentCounts {
  return notCurrentOf(worktreeStatesOf(states), keys, openFiles);
}

/** `countNotCurrent` from the worktree's states counted (row 025-11). */
export function notCurrentOf(
  states: WorktreeStates,
  keys: readonly TestFileKeyRecord[],
  openFiles: ReadonlySet<string> = new Set(),
): NotCurrentCounts {
  const testFileCounts = { current: 0, pending: 0, stale: 0, unknown: 0 };
  const testFilesByPhase = { running: 0, queued: 0 };
  const testsByPhase = { running: 0, queued: 0 };
  for (const row of keys) {
    const id = testFileId(row.testFile);
    const own = states.files.get(id)?.checks;
    const fileClass = classOf(row, own);
    testFileCounts[fileClass]++;
    if (fileClass !== "pending") continue;
    const running = openFiles.has(id) || row.pending === "running" || own?.running === true;
    testFilesByPhase[running ? "running" : "queued"]++;
  }
  const filePhase = new Map(keys.map((row) => [testFileId(row.testFile), row.pending]));
  for (const state of states.notable) {
    if (state.check.kind !== "test" || state.validity !== "pending") continue;
    const id = testFileKeyOf(state.check);
    const phase = openFiles.has(id)
      ? "running"
      : (state.pendingPhase ?? filePhase.get(id) ?? "queued");
    testsByPhase[phase]++;
  }
  return { testFileCounts, testFilesByPhase, testsByPhase };
}
