import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPolicy } from "../core/daemon/policy.js";
import { NARROW_NOT_SUPPORTED } from "../core/daemon/run-group.js";
import { testFileId } from "../core/keys/reverse-index.js";
import { groupView } from "../core/scheduler/slow.js";
import type { AbsolutePath, RelativePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import { storedDurations } from "./code-gate-durations.js";
import { daemonSocket } from "./daemon-access.js";
import { takenRequest } from "./run-group.js";
import type { SideState } from "./status-at-report.js";
import type { NowRunUse } from "./status-at-report-run.js";
import { estimateOf } from "./status-at-run-batches.js";
import { type RunAnswer, runInChild } from "./status-at-run-child.js";
import { setupCounts } from "./status-at-run-fit.js";
import { runBatches } from "./status-at-run-loop.js";
import { askWithin, socketBound } from "./wait/socket.js";
import { runWait } from "./wait/wait.js";

/*
 * Row 023-29 (lessons round 4, R1; spec 023 D4.10): `--run` fills the
 * working tree's side too. In round 4, `--at <commit> --run` ran only the
 * commit's files, so on an empty store no session could compare. After
 * the commit side, the files the change selects (`nowFiles`) that have no
 * result in the working tree run there, in the rest of the one budget,
 * as the daemon runs them: through the worktree's daemon when one serves
 * it (`run-group-paths` per group, then the group wait), else the same
 * gate in a child in the worktree, in batches (`runBatches`). Their
 * results are ordinary worktree results, read back as the current side.
 */

/** The working tree's part of the run. */
export interface NowRunInput {
  readonly root: AbsolutePath;
  readonly commonDir: AbsolutePath;
  /** The files to run: the change selects them and they have no result now. */
  readonly files: readonly TestFileRef[];
  /** A daemon serves this worktree: it runs them. */
  readonly daemon: boolean;
  /** `performance.now()` at which the one budget ends. */
  readonly endMs: number;
  readonly timeoutSeconds: number;
  readonly env: NodeJS.ProcessEnv;
  readonly relaunch: readonly string[] | undefined;
  readonly forward: (text: string) => void;
  readonly batchFiles?: number;
  /** Tests: the daemon's side, else the real one (`daemonPorts`). */
  readonly ports?: DaemonPorts;
}

/** What the run left, before the current side is read again. */
export interface NowRunEnd {
  readonly how: NowRunUse["how"];
  readonly gateMs: number | null;
  /** The files not run, each with its state (not run, for the budget or a setup). */
  readonly states: ReadonlyMap<string, SideState>;
  /** Why the daemon or a child gave no answer for some files; `null` when none. */
  readonly problem: string | null;
  /** D17.1's estimate of the files left, in seconds, for the rerun's fit. */
  readonly leftEstimate: number | null;
}

/** The files of `refs` the change selects (R1) that have no result now. */
export function nowFiles(
  refs: readonly TestFileRef[],
  state: (ref: TestFileRef) => SideState,
  selects: { readonly ids: ReadonlySet<string> | null; readonly paths: ReadonlySet<string> },
): TestFileRef[] {
  return refs.filter((ref) => {
    if (state(ref).state !== "no result") return false;
    return selects.ids === null || selects.ids.has(testFileId(ref)) || selects.paths.has(ref.path);
  });
}

/** R1: the files run in the working tree, through the daemon or the gate. */
export async function runNow(input: NowRunInput): Promise<NowRunEnd> {
  if (input.files.length === 0) {
    const how = input.daemon ? "daemon" : "gate";
    return { how, gateMs: null, states: new Map(), problem: null, leftEstimate: null };
  }
  if (input.daemon) {
    const ports = input.ports ?? daemonPorts(input.root);
    const end = await throughDaemon(input, ports);
    if (end !== null) return end;
  }
  return throughGate(input);
}

/** The daemon's side of R1, injectable for tests. */
export interface DaemonPorts {
  /** Asks the daemon to run `paths` of `group` now; `null` when no daemon answers, else an error text or `true`. */
  ask(
    group: string,
    paths: readonly RelativePath[],
    deadline: number,
  ): Promise<true | string | null>;
  /** Waits until none of `files` is pending or the deadline; why it ended early, `null` when it ended. */
  wait(files: readonly TestFileRef[], deadline: number): Promise<string | null>;
}

/** The real daemon: `run-group-paths` and the group wait, as `squeal run <group> <path>... --wait`. */
export function daemonPorts(root: AbsolutePath): DaemonPorts {
  let socket: AbsolutePath | null = null;
  const socketOf = async (deadline: number): Promise<AbsolutePath> => {
    socket ??= await daemonSocket(root, socketBound(deadline));
    return socket;
  };
  return {
    async ask(group, paths, deadline) {
      const socketPath = await socketOf(deadline);
      const request = { type: "run-group-paths", group, paths } as const;
      const first = await askWithin(socketPath, request, deadline);
      if (first === null) return null;
      if ("unanswered" in first) return `the daemon did not answer${first.unanswered}`;
      const taken = await takenRequest(socketPath, first, deadline, group, NARROW_NOT_SUPPORTED);
      if (typeof taken === "string") return taken;
      return "pending" in taken ? "the daemon had not taken the request by the deadline" : true;
    },
    async wait(files, deadline) {
      const socketPath = await socketOf(deadline);
      const files_ = { kind: "list", files } as const;
      const outcome = await runWait({ wait: "group", root, socketPath, deadline, files: files_ });
      if (outcome.kind === "ended") return null;
      if (outcome.kind === "deadline") return "the budget ended; their runs go on in the daemon";
      if (outcome.kind === "on-hold") return "the worktree is on hold";
      if (outcome.kind === "stopped") return "the daemon stopped";
      return outcome.unavailable;
    },
  };
}

/** Through the daemon, one request per group; `null` when no daemon answers (the gate runs them). */
async function throughDaemon(input: NowRunInput, ports: DaemonPorts): Promise<NowRunEnd | null> {
  const started = performance.now();
  const deadline = Date.now() + Math.max(0, input.endMs - performance.now());
  const view = groupView(readPolicy(input.root));
  const byGroup = new Map<string, RelativePath[]>();
  for (const ref of input.files) {
    const name = view.of(ref).name;
    const paths = byGroup.get(name) ?? [];
    if (!paths.includes(ref.path)) paths.push(ref.path);
    byGroup.set(name, paths);
  }
  const problems: string[] = [];
  let answered = false;
  for (const [group, paths] of byGroup) {
    const asked = await ports.ask(group, paths, deadline).catch((e: unknown) => String(e));
    if (asked === null) continue;
    answered = true;
    if (asked !== true) problems.push(`group ${group}: ${asked}`);
  }
  if (!answered) return null;
  const waited = await ports.wait(input.files, deadline).catch((e: unknown) => String(e));
  if (waited !== null) problems.push(waited);
  return {
    how: "daemon",
    gateMs: Math.round(performance.now() - started),
    states: new Map(),
    problem: problems.length === 0 ? null : problems.join("; "),
    leftEstimate: null,
  };
}

/** With no daemon: the gate in a child in the worktree, in batches, storing as the gate does. */
async function throughGate(input: NowRunInput): Promise<NowRunEnd> {
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

/** The report's part for the working tree, once the current side was read again. */
export function nowUse(
  input: Pick<NowRunInput, "files">,
  end: NowRunEnd,
  after: (ref: TestFileRef) => SideState,
): NowRunUse {
  const ran = input.files.filter((ref) => {
    const s = after(ref).state;
    return s === "pass" || s === "fail";
  }).length;
  const notRun = [...end.states.values()].filter(
    (s) => s.state === "not run" && s.reason === "budget",
  ).length;
  return {
    how: end.how,
    selected: input.files.length,
    ran,
    notRun,
    gateMs: end.gateMs,
    setupFailed: setupCounts(end.states.values()),
    problem: end.problem,
  };
}
