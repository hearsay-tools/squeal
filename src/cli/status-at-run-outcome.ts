import { type KeyedFile, withStores } from "../core/commit/at-keys-checkout.js";
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
}

/** Each run file's state, by `testFileId`. */
export async function outcomesOf(input: OutcomeInput): Promise<Map<string, SideState>> {
  const { answer, commit } = input;
  const states = new Map<string, SideState>();
  if ("error" in answer) {
    const reason = `run: ${answer.error}`;
    for (const file of input.run)
      states.set(testFileId(file.ref), { state: "not determined", reason });
    return states;
  }
  const chosen = new Set(input.run.map((f) => testFileId(f.ref)));
  await withStores(input.commonDir, async (main) => {
    for (const file of [...input.run, ...input.siblings]) {
      if (!("key" in file.at)) continue;
      const { key } = file.at;
      const { project, path } = file.ref;
      const records = (main?.results.byKey(key, 0) ?? []).filter(
        (r) => r.check.project === project && r.check.testPath === path,
      );
      const id = testFileId(file.ref);
      if (records.length > 0) {
        states.set(id, asRun(stateOf(key, records, input.own), commit, true));
      } else if (chosen.has(id)) {
        const runs = answer.result.runs.filter((r) => r.path === path);
        states.set(id, fromGate(key, runs, commit));
      }
    }
  });
  return states;
}

/** A stored state, its origin this command's run. */
function asRun(state: SideState, commit: string, stored: boolean): SideState {
  const origin: Origin = { kind: "run", worktreeId: null, commit, stored };
  return state.state === "pass" || state.state === "fail" ? { ...state, origin } : state;
}

/**
 * The gate's outcome for a path no result was stored for. Its runs under
 * the path's projects must agree, or nothing tells which one is this
 * project's.
 */
function fromGate(key: string, runs: readonly GateFileRun[], commit: string): SideState {
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
  const origin: Origin = { kind: "run", worktreeId: null, commit, stored: false };
  if (first.outcome === "passed") return { state: "pass", key, origin };
  if (first.outcome === "failed") {
    const failed = [...new Set(first.failed.map((f) => f.test))].sort(compare);
    return { state: "fail", key, origin, failed };
  }
  return { state: "not run", reason: first.reason === "prepare" ? "prepare" : "budget" };
}
