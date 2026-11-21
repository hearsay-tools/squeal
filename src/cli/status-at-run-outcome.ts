import { type KeyedFile, resultsAt, withStores } from "../core/commit/at-keys-checkout.js";
import { type Changed, changedText } from "../core/commit/at-keys-walk.js";
import { compare } from "../core/fs/compare.js";
import { testFileId } from "../core/keys/reverse-index.js";
import type { AbsolutePath, CommitSha, WorktreeId } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { GateFileRun } from "./code-gate-files.js";
import { type Origin, type SideState, stateOf } from "./status-at-report.js";
import { MAYBE_STORED } from "./status-at-report-files.js";
import type { RunAnswer } from "./status-at-run-child.js";

/*
 * Spec 023 D3, D4.7 (row 023-07, review wave-7 B2 and B7): each file's
 * state after `--run`. The gate answers by path, and runs a path under
 * every project that lists it, so a project's own outcome is read from the
 * shared store at that project's key, where the gate kept it: that also
 * proves it was stored. A file the gate did not store (coverage off at
 * the commit) takes the gate's outcome for its path only when no other
 * project's outcome for that path could be mistaken for it.
 */

export interface OutcomeInput {
  readonly commonDir: AbsolutePath;
  readonly commit: string;
  readonly own: WorktreeId;
  /** The files that ran. */
  readonly run: readonly KeyedFile[];
  /**
   * Files with no result the selection did not choose that share a path
   * with one that ran: the gate ran them too, and they read as run only
   * when the store holds their result.
   */
  readonly siblings: readonly KeyedFile[];
  readonly answer: RunAnswer;
  /**
   * Row 023-07 ("Whole-checkout check"): the first path the install
   * changed; with one, the run stored nothing, and each outcome is shown
   * as not the commit's.
   */
  readonly changed: Changed | null;
  /**
   * Row 023-11 (D5.3, D5.4): `false` for a forced run that stores nothing
   * (a proof side under a condition, or repeated): a result the store
   * holds at the key is an earlier run's, so only the gate's answer is read.
   */
  readonly stored?: boolean;
  /**
   * Review wave-13 B2: for a child that gave no answer, why a completed file
   * the keeper had not decided on is not stored; absent for an answer, whose
   * keeper decided every file.
   */
  readonly undecided?: string;
  /**
   * Row 023-18 (D2): coverage is on in the checkout's policy (default
   * `true`); with it off the gate keeps nothing, and that is the reason given.
   */
  readonly coverage?: boolean;
}

/** Each run file's state, by `testFileId`. */
export async function outcomesOf(input: OutcomeInput): Promise<Map<string, SideState>> {
  const { answer, commit } = input;
  const states = new Map<string, SideState>();
  if ("error" in answer) return unanswered(input, answer);
  const { changed } = input;
  if (changed !== null || input.stored === false) {
    for (const file of input.run) {
      if (!("key" in file.at)) continue;
      const runs = answer.result.runs.filter((r) => runOf(r, file.ref));
      const state = fromGate(file.at.key, runs, commit);
      states.set(testFileId(file.ref), changed === null ? state : notTheCommits(state, changed));
    }
    return states;
  }
  const chosen = new Set(input.run.map((f) => testFileId(f.ref)));
  // Review wave-11 B1: a file's outcome is read only at the key the gate kept this run's result
  // at, never at a key computed after the run, which a test that wrote its inputs can move.
  const kept = new Map(
    (answer.result.kept ?? []).map((k) => [
      testFileId({ project: k.project, path: k.path }),
      k.key,
    ]),
  );
  await withStores(input.commonDir, async (main) => {
    for (const file of [...input.run, ...input.siblings]) {
      if (!("key" in file.at)) continue;
      const id = testFileId(file.ref);
      const at = kept.get(id);
      const records = main === null || at === undefined ? [] : resultsAt(main, file.ref, at);
      if (at !== undefined && records.length > 0) {
        states.set(id, asRun(stateOf(at, records, input.own), commit, true));
      } else if (chosen.has(id)) {
        const runs = answer.result.runs.filter((r) => runOf(r, file.ref));
        const why =
          at === undefined
            ? notKeptWhy(answer.result.notKept, file.ref, input.coverage !== false, input.undecided)
            : "its kept result could not be read back";
        states.set(id, fromGate(file.at.key, runs, commit, why));
      }
    }
  });
  return states;
}

/**
 * Row 023-19 (P3), review wave-13 B2 (the human, 2026-11-19, "A: repair
 * once more"): the files of a child that gave no answer, stopped at the
 * budget or ended otherwise. What it completed is read from its own
 * completion record, as it kept it while it ran: each run's outcome per
 * path, and per project and path the key the keeper wrote it at, or why
 * it did not (coverage off included). The record is read as an answer
 * is, so a kept file is read at its own kept key and nothing else: never
 * the store's newest key, which a concurrent run in a linked worktree may
 * have written. A completed file the keeper had not decided yet reads its
 * outcome, not stored. A file with no outcome in the record reads `not run
 * (budget)` after a stop, else not determined with the child's error.
 */
async function unanswered(
  input: OutcomeInput,
  answer: Extract<RunAnswer, { readonly error: string }>,
): Promise<Map<string, SideState>> {
  const missing: SideState =
    answer.stopped === true
      ? { state: "not run", reason: "budget" }
      : { state: "not determined", reason: `run: ${answer.error}` };
  const { record } = answer;
  const states =
    record === undefined
      ? new Map<string, SideState>()
      : await outcomesOf({
          ...input,
          answer: { result: { ...record, timedOut: true, budgetSeconds: 0 } },
          undecided: maybeStored(answer.stopped === true),
        });
  for (const file of input.run) {
    const id = testFileId(file.ref);
    const state = states.get(id);
    const ran = record?.runs.some((r) => runOf(r, file.ref)) === true;
    if (state === undefined || !ran) states.set(id, missing);
  }
  return states;
}

/** A run's outcome in a checkout the install changed: shown, not the commit's, not stored. */
function notTheCommits(state: SideState, changed: Changed): SideState {
  if (state.state !== "pass" && state.state !== "fail") return state;
  const reason = changedText(changed);
  const failed = state.state === "fail" ? { failed: state.failed } : {};
  return { state: "not comparable", reason, ran: state.state, ...failed };
}

/** A stored state, its origin this command's run. */
function asRun(state: SideState, commit: string, stored: boolean): SideState {
  const origin: Origin = { kind: "run", worktreeId: null, commit, stored };
  return state.state === "pass" || state.state === "fail" ? { ...state, origin } : state;
}

/**
 * Row 023-19 (the third look, the human's "A: key per project"): whether
 * `run` is `ref`'s: its path, and its project when it names one. A
 * completion record's runs name it, so each project reads its own outcome;
 * an answer's runs do not, so a path's projects must agree (`fromGate`).
 */
function runOf(
  run: { readonly path: string; readonly project?: string },
  ref: TestFileRef,
): boolean {
  return run.path === ref.path && (run.project === undefined || run.project === ref.project);
}

/**
 * Row 023-19 (the third look, accepted limit): the reason for a completed
 * file that a child with no answer recorded before its keep decision. A stop
 * while the record was being rewritten after a keep that landed leaves the
 * record before it, so the result may be in the store.
 */
export function maybeStored(stopped: boolean): string {
  const lead = stopped
    ? "the run was stopped at the budget before its record said whether the gate kept it"
    : "the run ended before its record said whether the gate kept it";
  return `${lead}; ${MAYBE_STORED}`;
}

/**
 * Row 023-18 (D2): why a run file of a storing run is not in the store: the
 * keeper's own reason for its path (row 023-19: and project, when the
 * reason names one), else coverage off, else no reason told.
 */
export function notKeptWhy(
  notKept:
    | readonly { readonly project?: string; readonly path: string; readonly reason: string }[]
    | undefined,
  ref: TestFileRef,
  coverage: boolean,
  undecided?: string,
): string {
  const reason = notKept?.find((n) => runOf(n, ref))?.reason;
  if (reason !== undefined) return `the gate did not keep it: ${reason}`;
  if (coverage && undecided !== undefined) return undecided;
  return coverage
    ? "the gate did not keep it and gave no reason"
    : "the gate keeps a result only with coverage on";
}

/**
 * The gate's outcome for a path no result was stored for. Its runs under
 * the path's projects must agree, or nothing tells which one is this
 * project's. `why` says why it is not stored, when the run stored. Row
 * 023-34 (T4): the working tree's side reads it too, `commit` `null`.
 */
export function fromGate(
  key: string,
  runs: readonly GateFileRun[],
  commit: CommitSha,
  why?: string,
): SideState {
  const [first] = runs;
  if (first === undefined) return { state: "not determined", reason: "the run gave it no outcome" };
  const shape = (r: GateFileRun) =>
    JSON.stringify([
      r.outcome,
      r.reason ?? null,
      [...new Set(r.failed.map((f) => f.test))].sort(compare),
    ]);
  if (runs.some((r) => shape(r) !== shape(first))) {
    const reason = `its ${runs.length} projects ended differently, and no result was stored to tell them apart`;
    return { state: "not determined", reason };
  }
  const origin: Origin = {
    kind: "run",
    worktreeId: null,
    commit,
    stored: false,
    ...(why === undefined ? {} : { notStored: why }),
  };
  if (first.outcome === "passed") return { state: "pass", key, origin };
  if (first.outcome === "failed") {
    const failed = [...new Set(first.failed.map((f) => f.test))].sort(compare);
    return { state: "fail", key, origin, failed };
  }
  return { state: "not run", reason: first.reason === "prepare" ? "prepare" : "budget" };
}
