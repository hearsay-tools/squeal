import { readPolicy } from "../core/daemon/policy.js";
import { NARROW_NOT_SUPPORTED } from "../core/daemon/run-group.js";
import { testFileId } from "../core/keys/reverse-index.js";
import { groupView } from "../core/scheduler/slow.js";
import type { AbsolutePath, RelativePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import { daemonSocket } from "./daemon-access.js";
import { takenRequest } from "./run-group.js";
import type { SideState } from "./status-at-report.js";
import type { NowRunUse } from "./status-at-report-run.js";
import { setupCounts } from "./status-at-run-fit.js";
import { throughGate } from "./status-at-run-now-gate.js";
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
  /**
   * Row 023-34 (T4): the `testFileId`s the commit side ran and did not
   * keep. They run through the gate, never the daemon, so this run's
   * outcome is known when the gate does not keep them here either.
   */
  readonly alone?: ReadonlySet<string>;
  /** T4: a file's key in the working tree, `null` for none; with it, unkept outcomes are read. */
  readonly keyOf?: (ref: TestFileRef) => string | null;
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

/**
 * R1: the files run in the working tree, through the daemon or the gate.
 * T4: the commit side's unkept files (`alone`) go through the gate first.
 */
export async function runNow(input: NowRunInput): Promise<NowRunEnd> {
  if (input.files.length === 0) {
    const how = input.daemon ? "daemon" : "gate";
    return { how, gateMs: null, states: new Map(), problem: null, leftEstimate: null };
  }
  if (!input.daemon) return throughGate(input);
  const alone = input.alone ?? new Set<string>();
  const gated = input.files.filter((ref) => alone.has(testFileId(ref)));
  const rest = input.files.filter((ref) => !alone.has(testFileId(ref)));
  const first = gated.length === 0 ? null : await throughGate({ ...input, files: gated });
  if (rest.length === 0 && first !== null) return first;
  const ports = input.ports ?? daemonPorts(input.root);
  const end =
    (await throughDaemon({ ...input, files: rest }, ports)) ??
    (await throughGate({ ...input, files: rest }));
  return first === null ? end : mergedEnd(first, end, rest);
}

/**
 * Two passes as one: the later pass's files (`list`) take its states, the
 * times add up; the later pass's way names the whole.
 */
export function mergedEnd(
  earlier: NowRunEnd | null,
  later: NowRunEnd,
  list: readonly TestFileRef[],
): NowRunEnd {
  if (earlier === null) return later;
  const again = new Set(list.map(testFileId));
  const states = new Map([...earlier.states].filter(([id]) => !again.has(id)));
  for (const [id, state] of later.states) states.set(id, state);
  const times = [earlier.gateMs, later.gateMs].filter((ms): ms is number => ms !== null);
  return {
    how: later.how,
    gateMs: times.length === 0 ? null : times.reduce((a, b) => a + b, 0),
    states,
    problem: earlier.problem ?? later.problem,
    leftEstimate: later.leftEstimate,
  };
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
