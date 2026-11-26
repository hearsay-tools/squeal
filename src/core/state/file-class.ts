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
  /** Its pending states by check kind and stored phase. */
  readonly pending: Readonly<Record<CheckId["kind"], PhaseCounts>>;
}

/** Pending states by their stored phase; `none` when they store none. */
export type PhaseCounts = Readonly<Record<PendingPhase | "none", number>>;

/** No pending state of any kind. */
export const noPending = (): Record<CheckId["kind"], Record<PendingPhase | "none", number>> => ({
  test: { queued: 0, running: 0, none: 0 },
  file: { queued: 0, running: 0, none: 0 },
  setup: { queued: 0, running: 0, none: 0 },
});

/**
 * `pending` by phase as status counts a check's: running while an open run
 * holds its file (`held`, C15), else its stored phase, else its file's
 * (`filePhase`, its key row's), else queued.
 */
export function phasesOf(
  pending: PhaseCounts,
  held: boolean,
  filePhase: PendingPhase | null | undefined,
): Record<PendingPhase, number> {
  const all = pending.queued + pending.running + pending.none;
  if (held) return { queued: 0, running: all };
  const none = filePhase ?? "queued";
  return {
    queued: pending.queued + (none === "queued" ? pending.none : 0),
    running: pending.running + (none === "running" ? pending.none : 0),
  };
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
   * The states that fail, those that are unknown and every global setup's,
   * in `knownStates.list` order: the only ones a count reads one by one (a
   * failure, an unknown check's reason, a project's setup). On a worktree
   * whose checks pass, its global setups' alone, though all are pending.
   */
  readonly notable: readonly KnownState[];
}

/** Whether `state` is among `WorktreeStates.notable`. */
export function isNotable(state: KnownState): boolean {
  return state.outcome === "fail" || state.validity === "unknown" || state.check.kind === "setup";
}

/**
 * Row 025-18: the counts of each frozen list, which cannot change. One Stop
 * counts its kept states list (`keepStates`) for the decision's header and
 * again for the turn's end; on a store of 500 checks each count is about
 * 0.9 ms, and it grows with the checks.
 */
const counted = new WeakMap<readonly KnownState[], WorktreeStates>();

/**
 * `states`, as the list `knownStates.list` reads, counted as `WorktreeStates`.
 * A frozen list is counted once (`counted`).
 */
export function worktreeStatesOf(states: readonly KnownState[]): WorktreeStates {
  if (!Object.isFrozen(states)) return countStates(states);
  let counts = counted.get(states);
  if (counts === undefined) {
    counts = countStates(states);
    counted.set(states, counts);
  }
  return counts;
}

function countStates(states: readonly KnownState[]): WorktreeStates {
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
  const pending = noPending();
  for (const s of own) {
    if (s.validity === "pending") pending[s.check.kind][s.pendingPhase ?? "none"]++;
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
    pending,
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
  for (const [id, file] of states.files) {
    const phases = phasesOf(file.pending.test, openFiles.has(id), filePhase.get(id));
    testsByPhase.queued += phases.queued;
    testsByPhase.running += phases.running;
  }
  return { testFileCounts, testFilesByPhase, testsByPhase };
}
