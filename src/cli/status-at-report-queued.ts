import { testFileId } from "../core/keys/reverse-index.js";
import { shellWord } from "../core/text.js";
import type { TestFileRef } from "../core/types/keys.js";
import { type CallEstimate, estimateLine } from "./status-at-estimate.js";
import type { SideQueue } from "./status-at-queue.js";
import type { SideState } from "./status-at-report.js";
import { elsewhereText, failedThere, namedLine, restLine } from "./status-at-report-narrow.js";

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
  /**
   * R3: each failed setup, `<group>: <failure>`, with the files it left not
   * run; row 023-52 (V6): `elsewhere`, the same files on the other side,
   * still queued or running there, and with a result there.
   */
  readonly setupFailed: readonly {
    readonly setup: string;
    readonly files: number;
    readonly elsewhere?: { readonly running: number; readonly known: number };
  }[];
  /** Why the daemon gave no answer for some files; `null` when none. */
  readonly problem: string | null;
  /** Review wave-23 B1: not queued because the call's wait ended first (waiting for a place, starting). */
  readonly late: boolean;
  /**
   * Row 023-51 (V4): the daemon's other files still queued or running,
   * outside this call's (another call's, an edit's); absent when not read.
   */
  readonly rest?: number;
}

/** D7.3: the call's part of the report, `run` in JSON. */
export interface QueuedRun {
  /** `queue`: `--run` queued the files; `join`: `--wait` alone joined what was queued. */
  readonly mode: "queue" | "join";
  /** The wait's bound in ms; `null` for a bare `--wait`, until done. */
  readonly waitMs: number | null;
  /** From the call's start to the wait's end. */
  readonly usedMs: number;
  /**
   * The commit daemon's side, with its worktree when one was reached; row
   * 023-40c: `setup`, what the daemon still did when the wait ended (its
   * install, its start, the selection), `null` once its files are queued.
   */
  readonly commit: QueuedSide & {
    readonly tree: string | null;
    readonly setup?: "install" | "starting" | "selecting" | null;
  };
  /** R8: files with no result at the commit the change did not select, which were not queued. */
  readonly notSelected: number;
  /**
   * The working tree's side, in this worktree's daemon. Review
   * wave-23-third B1: `setup`, the daemon had not answered when the wait
   * ended (it starts or loads its configuration); absent from earlier reports.
   */
  readonly now: QueuedSide & { readonly setup?: boolean };
  /** Q7: the call that waits for what still runs; `null` when nothing does. */
  readonly again: string | null;
  /** Review wave-23 B1: the call that queues what the wait's end left not queued; `null` when none. */
  readonly retry: string | null;
  /** Row 023-51 (V4): the paths a narrowed call gave; its counts are of their files only. Absent without. */
  readonly paths?: readonly string[];
  /**
   * Row 023-58 (W1): with `--wait` alone, per side, the call's files with a
   * result on the other side and none here, none queued or running here,
   * and the call that queues them; absent when none.
   */
  readonly idle?: { readonly commit: number; readonly now: number; readonly command: string };
  /** Row 023-49 (V2): per side, the time what still runs takes; absent when nothing does. */
  readonly estimate?: CallEstimate;
  /** Row 023-49: with `estimate`, the call that narrows a wide one; `null` for a narrowed call. */
  readonly narrow?: string | null;
}

const isKnown = (s: SideState) => s.state === "pass" || s.state === "fail";
const isRunning = (s: SideState) => s.state === "no result" && s.pending !== undefined;

/**
 * One side's counts, from its queue and its states after the wait. With
 * `other`, the other side's states (row 023-52, V6): each failed setup
 * says what its files are there.
 */
export function queuedSide(
  queue: SideQueue,
  state: (ref: TestFileRef) => SideState,
  other?: (ref: TestFileRef) => SideState,
): QueuedSide {
  const states = queue.files.map((ref) => ({ ref, s: state(ref) }));
  const setups = new Map<string, TestFileRef[]>();
  for (const { ref, s } of states)
    if (s.state === "not run" && s.reason === "setup")
      setups.set(s.setup ?? "no text", [...(setups.get(s.setup ?? "no text") ?? []), ref]);
  const elsewhere = (refs: readonly TestFileRef[]) => {
    if (other === undefined) return {};
    const there = refs.map(other);
    return {
      elsewhere: { running: there.filter(isRunning).length, known: there.filter(isKnown).length },
    };
  };
  return {
    files: queue.files.length,
    reached: queue.root !== null,
    known: states.filter(({ s }) => isKnown(s)).length,
    running: states.filter(({ s }) => isRunning(s)).length,
    setupFailed: [...setups].map(([setup, refs]) => ({
      setup,
      files: refs.length,
      ...elsewhere(refs),
    })),
    problem: queue.problems.length === 0 ? null : queue.problems.join("; "),
    late: queue.late === true,
  };
}

/** Row 023-51 (V4): `queue` with only the files of `call` (a narrowed call's), every file without. */
export function narrowQueue(queue: SideQueue, call: readonly TestFileRef[] | null): SideQueue {
  if (call === null) return queue;
  const ids = new Set(call.map(testFileId));
  return { ...queue, files: queue.files.filter((ref) => ids.has(testFileId(ref))) };
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
  const { commit, now } = run;
  const named = namedLine(run, at);
  const lines = [...(named === null ? [] : [named]), ...commitLines(run, at), ...nowLines(run, at)];
  if (run.mode === "join" && commit.files + now.files === 0)
    lines.push(
      `--wait: nothing is queued or running for these files at ${at} or in the working tree`,
    );
  lines.push(...idleLines(run, at));
  const rest = restLine(run, at);
  if (rest !== null) lines.push(rest);
  const estimate = estimateLine(run.estimate, at, run.narrow ?? null);
  if (estimate !== null) lines.push(estimate);
  const setup = commit.setup ?? null;
  const nowSetup = now.setup === true;
  if ((setup !== null || nowSetup || commit.running + now.running > 0) && run.again !== null) {
    const failedHere = failedThere(now, "in the working tree");
    const failedAt = failedThere(commit, `at ${at}`);
    const there =
      setup === null
        ? `${commit.running} still running at ${at} (its worktree${failedHere === "" ? "" : `; ${failedHere}`})`
        : `still setting up at ${at} (${setup})`;
    const here = nowSetup
      ? "still setting up in the working tree (its daemon starts or loads its configuration)"
      : `${now.running} in the working tree${failedAt === "" ? "" : ` (${failedAt})`}`;
    lines.push(
      `${there}, ${here}; their runs go on in the daemons. ${run.again} waits for them; squeal ps shows them.`,
    );
  }
  return lines;
}

/** Review wave-23 S2: a join names its own flag, never `--run`, which it did not do. */
const flagOf = (run: QueuedRun) => (run.mode === "queue" ? "--run" : "--wait");
const verbOf = (run: QueuedRun) => (run.mode === "queue" ? "queued" : "joined");

/** The commit side's lines, R8's not-selected line among them. */
function commitLines(run: QueuedRun, at: string): string[] {
  const { commit } = run;
  const flag = flagOf(run);
  const lines: string[] = [];
  const where = commit.tree === null ? "" : ` (its worktree ${commit.tree})`;
  const setup = commit.setup ?? null;
  if (setup !== null && commit.reached)
    lines.push(
      `${flag}: still setting up at ${at} (${setup}) in its commit daemon${where}; it queues the files with no result there that the change selects, then runs them`,
    );
  else if (run.mode === "queue" && commit.files === 0 && commit.problem !== null)
    lines.push(`--run: nothing queued at ${at}: ${commit.problem}${retryText(commit, run.retry)}`);
  else if (run.mode === "queue" && commit.files === 0)
    lines.push(`--run: no file with no result at ${at} that the change selects to run`);
  else if (commit.files > 0 && !commit.reached)
    lines.push(
      `${flag}: ${commit.files} test files with no result at ${at} not queued: ${commit.problem ?? "no commit daemon"}${retryText(commit, run.retry)}`,
    );
  else if (commit.files > 0)
    lines.push(
      `${flag}: ${verbOf(run)} ${commit.files} test files with no result at ${at} in its commit daemon${where}; ${commit.known} have a result now (${seconds(run.usedMs)})`,
    );
  if (run.notSelected > 0)
    lines.push(
      `${run.notSelected} more with no result at ${at} not selected by the change did not run; \`--all-missing\` runs ${run.notSelected === 1 ? "it" : "them"}`,
    );
  return [...lines, ...sideLines(commit, "", `at ${at}`, "in the working tree", run.retry)];
}

/** The working tree's side's lines. */
function nowLines(run: QueuedRun, at: string): string[] {
  const { now } = run;
  const flag = flagOf(run);
  const lines: string[] = [];
  if (now.files > 0 && !now.reached)
    lines.push(
      `${flag}, now: ${now.files} test files the change selects with no result in the working tree not queued: ${now.problem ?? "no daemon"}${retryText(now, run.retry)}`,
    );
  else if (now.files > 0)
    lines.push(
      `${flag}, now: ${verbOf(run)} ${now.files} test files the change selects with no result in the working tree in this worktree's daemon; ${now.known} have a result now`,
    );
  else if (now.setup === true)
    lines.push(
      `${flag}, now: this worktree's daemon is still setting up (it starts or loads its configuration); nothing is known or queued in the working tree yet`,
    );
  else if (run.mode === "queue")
    lines.push("--run, now: every test file the change selects has a result in the working tree");
  return [...lines, ...sideLines(now, "now: ", "in the working tree", `at ${at}`, run.retry)];
}

/**
 * R3's setup lines, then what the daemon did not answer (row 023-58:
 * with the call that asks it again when the wait's end left it). Row 023-52 (V6):
 * each names the side it failed on (`here`) and what its files are on the
 * other side (`there`).
 */
function sideLines(
  side: QueuedSide,
  prefix: string,
  here: string,
  there: string,
  retry: string | null,
): string[] {
  if (!side.reached) return [];
  const lines = side.setupFailed.map(
    (f) =>
      `${prefix}${f.files} not run ${here}: the batch's setup failed (${f.setup})${elsewhereText(f, there)}`,
  );
  const setup = side.setupFailed.reduce((n, f) => n + f.files, 0);
  const without = side.files - side.known - side.running - setup;
  if (side.problem !== null && without > 0)
    // Row 023-58 (W1): a group the wait's end left not asked says how to ask it.
    lines.push(`${prefix}${without} without a result: ${side.problem}${retryText(side, retry)}`);
  return lines;
}

/**
 * Row 023-58 (W1): a join asks nothing, so the files one side has a result
 * for and the other side neither has nor runs say how to ask them.
 */
function idleLines(run: QueuedRun, at: string): string[] {
  const { idle } = run;
  if (idle === undefined) return [];
  const line = (n: number, there: string, here: string) =>
    `${n} test file${n === 1 ? "" : "s"} with a result ${there} ${n === 1 ? "has" : "have"} none ${here}, and none is queued or running there; \`${idle.command}\` queues ${n === 1 ? "it" : "them"}`;
  return [
    ...(idle.commit === 0 ? [] : [line(idle.commit, "in the working tree", `at ${at}`)]),
    ...(idle.now === 0 ? [] : [`now: ${line(idle.now, `at ${at}`, "in the working tree")}`]),
  ];
}
