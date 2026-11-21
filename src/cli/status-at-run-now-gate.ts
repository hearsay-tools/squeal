import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPolicy } from "../core/daemon/policy.js";
import { testFileId } from "../core/keys/reverse-index.js";
import type { AbsolutePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import { storedDurations } from "./code-gate-durations.js";
import type { SideState } from "./status-at-report.js";
import { estimateOf } from "./status-at-run-batches.js";
import { type RunAnswer, runInChild } from "./status-at-run-child.js";
import { runBatches } from "./status-at-run-loop.js";
import type { NowRunEnd, NowRunInput } from "./status-at-run-now.js";
import { unkeptNow } from "./status-at-run-unkept.js";

/*
 * Row 023-29 (R1), moved here by row 023-34: the working tree's files run
 * through the same gate in a child in the worktree, in batches, storing as
 * the gate does, when no daemon serves it; row 023-34 (T4): and the
 * commit side's unkept files, whose outcome the gate's answer gives.
 */

/** The gate in a child in the worktree, in batches, storing as the gate does. */
export async function throughGate(input: NowRunInput): Promise<NowRunEnd> {
  const { root } = input;
  const folder = mkdtempSync(join(tmpdir(), "squeal-at-now-")) as AbsolutePath;
  const run = join(folder, "run") as AbsolutePath;
  mkdirSync(run);
  // The child's request, answer and record live here; the worktree is the tree it runs in.
  const place = { folder, tree: root, run, commit: "HEAD", commonDir: input.commonDir };
  const states = new Map<string, SideState>();
  const durations = storedDurations(root);
  const policy = readPolicy(root);
  let problem: string | null = null;
  try {
    const end = await runBatches({
      files: input.files,
      refOf: (ref) => ref,
      policy,
      timeoutSeconds: input.timeoutSeconds,
      ...(input.batchFiles === undefined ? {} : { batchFiles: input.batchFiles }),
      endMs: input.endMs,
      secondsOf: durations?.of ?? (() => null),
      run: (batch, budgetSeconds, stopAfterSeconds) =>
        runInChild({
          relaunch: input.relaunch,
          checkout: place,
          files: batch.paths,
          // Review wave-18 B3: the batch's own projects only.
          refs: batch.refs,
          budgetSeconds,
          stopAfterSeconds,
          store: true,
          env: input.env,
          forward: input.forward,
        }),
      readBack: async (files, answer) => {
        const read = readNow(files, answer);
        for (const [id, state] of read.states) states.set(id, state);
        // T4: what the gate ran and did not keep keeps this run's outcome.
        const { keyOf } = input;
        if (keyOf !== undefined)
          for (const [id, state] of unkeptNow(root, files, answer, keyOf)) states.set(id, state);
        problem ??= read.problem;
      },
      stateOf: (ref) => states.get(testFileId(ref)),
      setState: (ref, state) => states.set(testFileId(ref), state),
    });
    const left = input.files.filter((ref) => {
      const s = states.get(testFileId(ref));
      return s?.state === "not run" && s.reason === "budget";
    });
    // D17.1, as the commit side estimates its left files: one Vitest-wide run.
    const of = durations?.of ?? (() => null);
    const leftEstimate = estimateOf(
      left.map((ref) => ({ ref })),
      of,
    ).seconds;
    return { how: "gate", gateMs: end.gateMs, states, problem, leftEstimate };
  } finally {
    durations?.close();
    rmSync(folder, { recursive: true, force: true });
  }
}

/**
 * A batch's answer in the working tree: the files it did not run, by
 * `testFileId`. A file that ended needs no state here: the current side
 * is read again from the store after the run. Review wave-18 B2: a stop
 * is the budget; a gate that rejected at its setup is left to the batch
 * loop, which marks its files `not run (setup)` with their group and text;
 * a child that gave no answer otherwise is a problem of its own, counted
 * neither as budget nor as setup.
 */
function readNow(
  files: readonly TestFileRef[],
  answer: RunAnswer,
): { states: Map<string, SideState>; problem: string | null } {
  const states = new Map<string, SideState>();
  if ("error" in answer) {
    if (answer.stopped === true)
      for (const ref of files) states.set(testFileId(ref), { state: "not run", reason: "budget" });
    const setup = answer.setup !== undefined && answer.setup.length > 0;
    return { states, problem: answer.stopped === true || setup ? null : answer.error };
  }
  for (const ref of files) {
    const runs = answer.result.runs.filter((r) => r.path === ref.path);
    if (runs.length > 0 && runs.every((r) => r.outcome === "not-run")) {
      const prepare = runs.some((r) => r.reason === "prepare");
      states.set(testFileId(ref), { state: "not run", reason: prepare ? "prepare" : "budget" });
    }
  }
  return { states, problem: null };
}
