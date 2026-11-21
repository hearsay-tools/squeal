import { shellWord } from "../core/text.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { SideQueue } from "./status-at-queue.js";
import type { SideState } from "./status-at-report.js";

/*
 * Spec 023 D7.3 (row 023-40, research `run-wait-model.md` Q7): what a
 * `status --at --run` (or `--wait`) call queued in the two daemons and
 * what stands when its wait ends, for the report. While work runs, the
 * last line says where it goes on and how to wait for it:
 * `N still running at <commit> (its worktree), M in the working tree; their
 * runs go on in the daemons. squeal status --at <c> --wait 100000 waits for
 * them; squeal ps shows them.`
 */

/** `--run`'s default wait, and the wait the Q7 line names: under a 120 s tool limit (T6). */
export const RUN_WAIT_MS = 100_000;

/** One side's part. */
export interface QueuedSide {
  /** The files this call queued in the daemon (with `--wait` alone: joined there). */
  readonly files: number;
  /** Whether a daemon was reached: `false` when its start failed, and `problem` says why. */
  readonly reached: boolean;
  /** Of those, the ones with a pass or a fail now. */
  readonly known: number;
  /** Of those, the ones still queued or running. */
  readonly running: number;
  /** R3: each failed setup, `<group>: <failure>`, with the files it left not run. */
  readonly setupFailed: readonly { readonly setup: string; readonly files: number }[];
  /** Why the daemon gave no answer for some files; `null` when none. */
  readonly problem: string | null;
  /** Review wave-23 B1: not queued because the call's wait ended first (waiting for a place, starting). */
  readonly late: boolean;
}

/** D7.3: the call's part of the report, `run` in JSON. */
export interface QueuedRun {
  /** `queue`: `--run` queued the files; `join`: `--wait` alone joined what was queued. */
  readonly mode: "queue" | "join";
  /** The wait's bound in ms; `null` for a bare `--wait`, until done. */
  readonly waitMs: number | null;
  /** From the call's start to the wait's end. */
  readonly usedMs: number;
  /** The commit daemon's side, with its worktree when one was reached. */
  readonly commit: QueuedSide & { readonly tree: string | null };
  /** R8: files with no result at the commit the change did not select, which were not queued. */
  readonly notSelected: number;
  /** The working tree's side, in this worktree's daemon. */
  readonly now: QueuedSide;
  /** Q7: the call that waits for what still runs; `null` when nothing does. */
  readonly again: string | null;
  /** Review wave-23 B1: the call that queues what the wait's end left not queued; `null` when none. */
  readonly retry: string | null;
}

/** One side's counts, from its queue and its states after the wait. */
export function queuedSide(queue: SideQueue, state: (ref: TestFileRef) => SideState): QueuedSide {
  const states = queue.files.map(state);
  const setups = new Map<string, number>();
  for (const s of states)
    if (s.state === "not run" && s.reason === "setup")
      setups.set(s.setup ?? "no text", (setups.get(s.setup ?? "no text") ?? 0) + 1);
  return {
    files: queue.files.length,
    reached: queue.root !== null,
    known: states.filter((s) => s.state === "pass" || s.state === "fail").length,
    running: states.filter((s) => s.state === "no result" && s.pending !== undefined).length,
    setupFailed: [...setups].map(([setup, files]) => ({ setup, files })),
    problem: queue.problems.length === 0 ? null : queue.problems.join("; "),
    late: queue.late === true,
  };
}

/** Q7's call: the same commit and paths, `--wait` for the default bound. */
export function waitAgain(given: string, paths: readonly string[]): string {
  return [
    "squeal status --at",
    shellWord(given),
    ...paths.map(shellWord),
    "--wait",
    String(RUN_WAIT_MS),
  ].join(" ");
}

/** Review wave-23 B1: the call that queues them again, the same commit and paths. */
export function runAgain(given: string, paths: readonly string[]): string {
  return ["squeal status --at", shellWord(given), ...paths.map(shellWord), "--run"].join(" ");
}

/** `; <retry> queues them again` after a side the wait's end left not queued. */
const retryText = (side: QueuedSide, retry: string | null) =>
  side.late && retry !== null ? `; ${retry} queues them again` : "";

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** The report's lines for the call's part, ending with Q7's line while work runs. */
export function queuedLines(run: QueuedRun, at: string): string[] {
  const lines: string[] = [];
  const { commit, now } = run;
  const verb = run.mode === "queue" ? "queued" : "joined";
  const where = commit.tree === null ? "" : ` (its worktree ${commit.tree})`;
  if (run.mode === "queue" && commit.files === 0)
    lines.push(`--run: no file with no result at ${at} that the change selects to run`);
  else if (commit.files > 0 && !commit.reached)
    lines.push(
      `--run: ${commit.files} test files with no result at ${at} not queued: ${commit.problem ?? "no commit daemon"}${retryText(commit, run.retry)}`,
    );
  else if (commit.files > 0)
    lines.push(
      `--run: ${verb} ${commit.files} test files with no result at ${at} in its commit daemon${where}; ${commit.known} have a result now (${seconds(run.usedMs)})`,
    );
  if (run.notSelected > 0)
    lines.push(
      `${run.notSelected} more with no result at ${at} not selected by the change did not run; \`--all-missing\` runs ${run.notSelected === 1 ? "it" : "them"}`,
    );
  lines.push(...sideLines(commit, ""));
  if (now.files > 0 && !now.reached)
    lines.push(
      `--run, now: ${now.files} test files the change selects with no result in the working tree not queued: ${now.problem ?? "no daemon"}${retryText(now, run.retry)}`,
    );
  else if (now.files > 0)
    lines.push(
      `--run, now: ${verb} ${now.files} test files the change selects with no result in the working tree in this worktree's daemon; ${now.known} have a result now`,
    );
  else if (run.mode === "queue")
    lines.push("--run, now: every test file the change selects has a result in the working tree");
  lines.push(...sideLines(now, "now: "));
  if (run.mode === "join" && commit.files + now.files === 0)
    lines.push(
      `--wait: nothing is queued or running for these files at ${at} or in the working tree`,
    );
  if (commit.running + now.running > 0 && run.again !== null)
    lines.push(
      `${commit.running} still running at ${at} (its worktree), ${now.running} in the working tree; their runs go on in the daemons. ${run.again} waits for them; squeal ps shows them.`,
    );
  return lines;
}

/** R3's setup lines, then what the daemon did not answer. */
function sideLines(side: QueuedSide, prefix: string): string[] {
  if (!side.reached) return [];
  const lines = side.setupFailed.map(
    (f) => `${prefix}${f.files} not run: the batch's setup failed (${f.setup})`,
  );
  const setup = side.setupFailed.reduce((n, f) => n + f.files, 0);
  const without = side.files - side.known - side.running - setup;
  if (side.problem !== null && without > 0)
    lines.push(`${prefix}${without} without a result: ${side.problem}`);
  return lines;
}
