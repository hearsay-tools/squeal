import { coverageOn } from "../core/code/coverage/runtime.js";
import { readPolicy } from "../core/daemon/policy.js";
import { testFileId } from "../core/keys/reverse-index.js";
import type { AbsolutePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { SideState } from "./status-at-report.js";
import { maybeStoredText } from "./status-at-report-files.js";
import type { RunAnswer } from "./status-at-run-child.js";
import { fromGate, notKeptWhy } from "./status-at-run-outcome.js";

/*
 * Row 023-34 (T4, lessons round 5; spec 023 D4.11): a selected file the
 * gate ran on both sides but did not keep (round 5: two lint files that
 * "read paths first seen during the run") had no result on either side
 * after the call, so it could never be compared. The commit side already
 * reads such a file from its run (`fromGate`, not stored). The working
 * tree's side runs it through the gate too, never through the daemon,
 * whose answer gives no outcome for a file it did not keep; this run's
 * outcome stands for the side when the store holds none. Nothing here
 * writes a result.
 */

/**
 * Whether `state` is a pass or a fail of this command's run that the store
 * does not hold; not one a stop left undecided, which may be stored.
 */
export function unkept(state: SideState | undefined): boolean {
  if (state === undefined || (state.state !== "pass" && state.state !== "fail")) return false;
  const { origin } = state;
  return origin.kind === "run" && origin.stored === false && !maybeStoredText(origin.notStored);
}

/**
 * The working tree's files a gate answer ended that the gate did not keep,
 * each with this run's outcome, by `testFileId`. `keyOf`: the file's key
 * in the working tree, `null` when it has none (it gets no state).
 */
export function unkeptNow(
  root: AbsolutePath,
  files: readonly TestFileRef[],
  answer: RunAnswer,
  keyOf: (ref: TestFileRef) => string | null,
): Map<string, SideState> {
  const states = new Map<string, SideState>();
  if ("error" in answer) return states;
  const { result } = answer;
  const kept = new Set((result.kept ?? []).map((k) => testFileId(k)));
  const coverage = coverageOn(readPolicy(root));
  for (const ref of files) {
    const key = keyOf(ref);
    if (key === null || kept.has(testFileId(ref))) continue;
    const runs = result.runs.filter((r) => r.path === ref.path);
    if (runs.length === 0 || runs.some((r) => r.outcome !== "passed" && r.outcome !== "failed"))
      continue;
    const why = notKeptWhy(result.notKept, ref, coverage);
    states.set(testFileId(ref), fromGate(key, runs, null, why));
  }
  return states;
}

/** `state`, or this run's unkept outcome (`ran`) when the store gives the side no result. */
export function withUnkept(
  state: (ref: TestFileRef) => SideState,
  ran: ReadonlyMap<string, SideState>,
): (ref: TestFileRef) => SideState {
  return (ref) => {
    const stored = state(ref);
    if (stored.state !== "no result") return stored;
    const own = ran.get(testFileId(ref));
    return unkept(own) && own !== undefined ? own : stored;
  };
}
