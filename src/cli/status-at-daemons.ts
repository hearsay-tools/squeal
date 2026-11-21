import { environmentFingerprint } from "../core/checkout/commit-places.js";
import {
  COMMIT_INSTALL_TIMEOUT_MS,
  ensureCommitWorktree,
  PLACE_WAIT_MS,
  readCommitWorktree,
} from "../core/checkout/commit-worktree.js";
import { type InstallResult, installCheckout } from "../core/checkout/install.js";
import { cacheCheckoutsRoot, gitCheckoutsDir } from "../core/checkout/location.js";
import { cacheRepositoryDirs, listCheckouts } from "../core/checkout/sweep.js";
import { probeDaemon } from "../core/daemon/ensure.js";
import { NARROW_NOT_SUPPORTED } from "../core/daemon/run-group.js";
import { resolveCommonDir } from "../core/fs/git-layout.js";
import type { AbsolutePath, RelativePath } from "../core/types/common.js";
import { DAEMON_SOCKET_TIMEOUT_MS, type RunGroupPathsRequest } from "../core/types/daemon.js";
import type { TestFileRef } from "../core/types/keys.js";
import { daemonSocket } from "./daemon-access.js";
import { takenRequest } from "./run-group.js";
import {
  claimWait,
  lockHolder,
  quietStart,
  type StartCommit,
  spawnCommitDaemon,
  worktreeStops,
} from "./status-at-start.js";
import { joinRequestAt, type RecordedJoins, recordedAt } from "./status-at-join.js";
import { askWithin, socketBound } from "./wait/socket.js";
import { runWait } from "./wait/wait.js";

/*
 * Spec 023 D7.3 (row 023-40): the two daemons a `status --at --run` call
 * talks to. The commit side: the commit worktree (`ensureCommitWorktree`,
 * row 023-38) and its daemon, started in the tree as `squeal start` starts
 * one, and this process kept alive until the daemon claimed the worktree
 * (023-38 notes: before the claim the creator owns it, and a sweep in that
 * gap would remove it). The working tree's side: the user's worktree
 * daemon, started as `squeal start` does when none runs. To both: one
 * narrow `run-group-paths` request per group, and the wait of `run <group>
 * --wait`. Tests pass their own (`AtDaemons`).
 */

/** The install's bound: the call's time left, at most D4.3's. */
export interface InstallBound {
  readonly timeoutMs: number;
  readonly started: (group: number) => void;
}

export interface CommitDaemonInput {
  /** The user's worktree: git resolves the commit there. */
  readonly root: AbsolutePath;
  readonly commit: string;
  /** The allow-listed variables the commit worktree's fingerprint covers (D7.1). */
  readonly environment: Readonly<Record<string, string>>;
  /** `daemon.maxCommitDaemons`; absent: the memory-derived default (D7.4). */
  readonly limit?: number;
  /** The checkouts' cache root; `cacheCheckoutsRoot()` by default. */
  readonly cacheRoot?: AbsolutePath;
  /** Tests: how long a new commit waits for a place under the ceiling (10 min by default). */
  readonly placeWaitMs?: number;
  /** Tests: the commit worktree's install; a frozen install by default (D4.3). */
  readonly install?: (tree: AbsolutePath, bound: InstallBound) => Promise<InstallResult>;
  /**
   * Review wave-23 B1: epoch ms when the call's wait ends; absent or
   * `Infinity` for a bare `--wait`. The place wait, the install and the
   * claim end by it (the claim `CLAIM_GRACE_MS` later at most).
   */
  readonly deadline?: number;
  /** One line to stderr: the "waiting for a place" note, and removal notes. */
  readonly note: (text: string) => void;
}

/** One call's daemon requests, as their daemons see them (rows 023-34, 023-36). */
export interface NarrowCall {
  /** The call's own id: the `at` run's key in the daemon. */
  readonly owner: string;
  /** The call named its files: they lead the queue. */
  readonly lead: boolean;
}

/** What a request did: taken, recorded and not taken yet, or why not. */
export type Asked = "taken" | "pending" | { readonly problem: string };

/** Review wave-23 B2: `RecordedJoins`, so `--wait` alone joins requests recorded and not taken yet. */
export interface AtDaemons extends RecordedJoins {
  /** D7.1 to D7.3: the commit worktree at `commit`, its daemon serving it; its tree, or why not. */
  commit(input: CommitDaemonInput): Promise<AbsolutePath | { readonly problem: string }>;
  /** `--wait` without `--run`: the commit worktree at the resolved `commit` that serves this environment; `null`: none. */
  find(input: CommitDaemonInput): AbsolutePath | null;
  /** The worktree's own daemon, started when none runs; `null`, or why none serves. */
  worktree(root: AbsolutePath): Promise<string | null>;
  /** One narrow request of `paths` of `group` to the daemon of `root`. */
  ask(
    root: AbsolutePath,
    group: string,
    paths: readonly RelativePath[],
    deadline: number,
    call: NarrowCall,
  ): Promise<Asked>;
  /** Until none of `files` is pending in the daemon of `root`, or `deadline`; why it ended early. */
  wait(root: AbsolutePath, files: readonly TestFileRef[], deadline: number): Promise<string | null>;
}

/** How the real daemons start; tests give their own. */
export interface DaemonStarts {
  /** The commit daemon's: `spawnCommitDaemon` by default. */
  readonly start?: StartCommit;
  /** The working tree's: `squeal start`'s, quiet (`quietStart`), by default. */
  readonly startWorktree?: (root: AbsolutePath) => Promise<string | null>;
  /** Where a start's warnings go. */
  readonly note?: (text: string) => void;
}

/** The real daemons, started as `starts` says. */
export function realDaemons(starts: DaemonStarts = {}): AtDaemons {
  const start = starts.start ?? spawnCommitDaemon;
  const note = starts.note ?? (() => undefined);
  const startWorktree = starts.startWorktree ?? ((root: AbsolutePath) => quietStart(root, note));
  const sockets = new Map<string, AbsolutePath>();
  const socketOf = async (root: AbsolutePath, deadline: number) => {
    const known = sockets.get(root);
    if (known !== undefined) return known;
    const socket = await daemonSocket(root, socketBound(deadline));
    sockets.set(root, socket);
    return socket;
  };
  const alive = async (root: AbsolutePath) =>
    (await probeDaemon(root, DAEMON_SOCKET_TIMEOUT_MS)).state === "alive";
  return {
    async commit(input) {
      const deadline = input.deadline ?? Number.POSITIVE_INFINITY;
      let tree: AbsolutePath;
      try {
        ({ tree } = await ensureCommitWorktree(withinCall(input, deadline)));
      } catch (error) {
        return { problem: notMade(messageOf(error), deadline) };
      }
      const started = (await alive(tree)) ? lockHolder(tree) : await start(tree);
      if (typeof started === "string")
        return { problem: `the commit daemon did not start: ${started}` };
      const claimed = await claimWait(tree, started, deadline);
      return claimed === null ? tree : { problem: claimed };
    },
    find: findCommitWorktree,
    async worktree(root) {
      if (await alive(root)) return null;
      // Review wave-23 S1: the user's stop and command holds stay; nothing is started over them.
      const stopped = await worktreeStops(root);
      if (stopped !== null) return stopped;
      const failed = await startWorktree(root);
      return failed === null ? null : `this worktree's daemon did not start: ${failed}`;
    },
    async ask(root, group, paths, bound, call) {
      // Review wave-23 B1: `bound` is the call's, shared by every request; none gets its own.
      const socketPath = await socketOf(root, bound);
      // Row 023-36 (T3): `at`, so the daemon stops the groups these runs start.
      const request: RunGroupPathsRequest = {
        type: "run-group-paths",
        group,
        paths,
        at: true,
        owner: call.owner,
        ...(call.lead ? { lead: true } : {}),
      };
      const first = await askWithin(socketPath, request, bound);
      if (first === null) return { problem: "no daemon answered" };
      if ("unanswered" in first) return { problem: `the daemon did not answer${first.unanswered}` };
      const taken = await takenRequest(socketPath, first, bound, group, NARROW_NOT_SUPPORTED);
      if (typeof taken === "string") return { problem: taken };
      return "pending" in taken ? "pending" : "taken";
    },
    async wait(root, files, deadline) {
      const socketPath = await socketOf(root, deadline);
      const list = { kind: "list", files } as const;
      const outcome = await runWait({ wait: "group", root, socketPath, deadline, files: list });
      if (outcome.kind === "ended" || outcome.kind === "deadline") return null;
      if (outcome.kind === "on-hold") return "the worktree is on hold";
      if (outcome.kind === "stopped") return "the daemon stopped";
      return outcome.unavailable;
    },
    // Review wave-23 B2: `--wait` alone joins requests recorded and not taken yet; it starts nothing.
    recorded: async (root) => recordedAt(await socketOf(root, Date.now())),
    joinRequest: async (root, request, deadline) =>
      joinRequestAt(await socketOf(root, deadline), request, deadline),
  };
}

/** D7.1: the commit worktree of this repository at `input.commit` (resolved) for this environment. */
export function findCommitWorktree(input: CommitDaemonInput): AbsolutePath | null {
  const commonDir = resolveCommonDir(input.root);
  if (commonDir === null) return null;
  const fingerprint = environmentFingerprint(input.environment);
  const cacheRoot = input.cacheRoot ?? cacheCheckoutsRoot();
  const found = listCheckouts([...cacheRepositoryDirs(cacheRoot), gitCheckoutsDir(commonDir)]).find(
    (c) =>
      c.marker?.fingerprint === fingerprint &&
      c.marker.commit === input.commit &&
      c.marker.commonDir === commonDir &&
      readCommitWorktree(c.tree) !== null,
  );
  return found?.tree ?? null;
}

/**
 * Review wave-23 B1: `ensureCommitWorktree`'s options within the call's
 * wait. A place not free by `deadline` is given up with no worktree made;
 * the install's bound is the time left (at most D4.3's), and an install it
 * cuts fails, which removes the worktree (`installOnce`), so none is left
 * without its creator.
 */
function withinCall(input: CommitDaemonInput, deadline: number) {
  const left = () => Math.max(0, deadline - Date.now());
  const install = (tree: AbsolutePath, started: (group: number) => void) => {
    const bound = { timeoutMs: Math.min(COMMIT_INSTALL_TIMEOUT_MS, left()), started };
    return input.install === undefined ? installCheckout(tree, bound) : input.install(tree, bound);
  };
  return {
    root: input.root,
    commit: input.commit,
    environment: input.environment,
    note: input.note,
    placeWaitMs: Math.min(input.placeWaitMs ?? PLACE_WAIT_MS, left()),
    install,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.cacheRoot === undefined ? {} : { cacheRoot: input.cacheRoot }),
  };
}

/** Why no commit worktree serves: with the call's wait over, while it waited for what. */
function notMade(message: string, deadline: number): string {
  if (Date.now() < deadline) return `the commit worktree could not be made: ${message}`;
  const place = /^(waiting for a place: [^;]*?)(?:; one frees[^;]*)?; gave up after \d+ s$/.exec(
    message,
  );
  if (place !== null)
    return `the call's wait ended before a commit worktree was free (${place[1]})`;
  return `the call's wait ended while its commit worktree was made: ${message} (starting)`;
}

function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).trim().replace(/^squeal: /, "");
}
