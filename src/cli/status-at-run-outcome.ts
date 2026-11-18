import { type KeyedFile, resultsAt, withStores } from "../core/commit/at-keys-checkout.js";
import { type Changed, changedText } from "../core/commit/at-keys-walk.js";
import { compare } from "../core/fs/compare.js";
import { testFileId } from "../core/keys/reverse-index.js";
import type { AbsolutePath, WorktreeId } from "../core/types/common.js";
import type { GateFileRun } from "./code-gate-files.js";
import { type Origin, type SideState, stateOf } from "./status-at-report.js";
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
   * Row 023-18 (D2): coverage is on in the checkout's policy (default
   * `true`); with it off the gate keeps nothing, and that is the reason given.
   */
  readonly coverage?: boolean;
}

/** Each run file's state, by `testFileId`. */
export async function outcomesOf(input: OutcomeInput): Promise<Map<string, SideState>> {
  const { answer, commit } = input;
  const states = new Map<string, SideState>();
  if ("error" in answer) {
    // Row 023-19 (P3): a child the parent stopped at its hard stop ran out of budget.
    if (answer.stopped === true) return stoppedOutcomes(input);
    const reason = `run: ${answer.error}`;
    for (const file of input.run)
      states.set(testFileId(file.ref), { state: "not determined", reason });
    return states;
  }
  const { changed } = input;
  if (changed !== null || input.stored === false) {
    for (const file of input.run) {
      if (!("key" in file.at)) continue;
      const runs = answer.result.runs.filter((r) => r.path === file.ref.path);
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
      const { path } = file.ref;
      const id = testFileId(file.ref);
      const at = kept.get(id);
      const records = main === null || at === undefined ? [] : resultsAt(main, file.ref, at);
      if (at !== undefined && records.length > 0) {
        states.set(id, asRun(stateOf(at, records, input.own), commit, true));
      } else if (chosen.has(id)) {
        const runs = answer.result.runs.filter((r) => r.path === path);
        const why =
          at === undefined
            ? notKeptWhy(answer.result.notKept, path, input.coverage !== false)
            : "its kept result could not be read back";
        states.set(id, fromGate(file.at.key, runs, commit, why));
      }
    }
  });
  return states;
}

/**
 * Row 023-19 (P3): the files of a run the parent stopped at the budget,
 * with no answer. The gate keeps each run's files as the run ends, so what
 * completed may be in the store: a file is read at the key keyed before
 * the run, which held no result when it was chosen, so a result there now
 * is this run's. Else it reads `not run (budget)`. A run that stores
 * nothing (a changed checkout, a forced proof side) reads nothing.
 */
async function stoppedOutcomes(input: OutcomeInput): Promise<Map<string, SideState>> {
  const states = new Map<string, SideState>();
  const budget: SideState = { state: "not run", reason: "budget" };
  const reads = input.changed === null && input.stored !== false;
  await withStores(input.commonDir, async (main) => {
    for (const file of input.run) {
      const id = testFileId(file.ref);
      const { at } = file;
      const records =
        reads && main !== null && "key" in at ? resultsAt(main, file.ref, at.key) : [];
      if (records.length > 0 && "key" in at)
        states.set(id, asRun(stateOf(at.key, records, input.own), input.commit, true));
      else states.set(id, budget);
    }
  });
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
 * Row 023-18 (D2): why a run file of a storing run is not in the store: the
 * keeper's own reason for its path, else coverage off, else no reason told.
 */
export function notKeptWhy(
  notKept: readonly { readonly path: string; readonly reason: string }[] | undefined,
  path: string,
  coverage: boolean,
): string {
  const reason = notKept?.find((n) => n.path === path)?.reason;
  if (reason !== undefined) return `the gate did not keep it: ${reason}`;
  return coverage
    ? "the gate did not keep it and gave no reason"
    : "the gate keeps a result only with coverage on";
}

/**
 * The gate's outcome for a path no result was stored for. Its runs under
 * the path's projects must agree, or nothing tells which one is this
 * project's. `why` says why it is not stored, when the run stored.
 */
function fromGate(
  key: string,
  runs: readonly GateFileRun[],
  commit: string,
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
