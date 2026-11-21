import { setTimeout as sleep } from "node:timers/promises";
import { environmentFingerprint } from "../core/checkout/commit-places.js";
import { ensureCommitWorktree, readCommitWorktree } from "../core/checkout/commit-worktree.js";
import { cacheCheckoutsRoot, gitCheckoutsDir } from "../core/checkout/location.js";
import { cacheRepositoryDirs, listCheckouts } from "../core/checkout/sweep.js";
import { probeDaemon } from "../core/daemon/ensure.js";
import { resolveCommonDir } from "../core/fs/git-layout.js";
import { NARROW_NOT_SUPPORTED } from "../core/daemon/run-group.js";
import type { AbsolutePath, RelativePath } from "../core/types/common.js";
import { DAEMON_SOCKET_TIMEOUT_MS, type RunGroupPathsRequest } from "../core/types/daemon.js";
import type { TestFileRef } from "../core/types/keys.js";
import { daemonSocket } from "./daemon-access.js";
import type { CliIo } from "./main.js";
import { takenRequest } from "./run-group.js";
import { startCommand } from "./start.js";
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

/** How long the call waits for a started commit daemon to claim its worktree. */
export const CLAIM_WAIT_MS = 60_000;
const CLAIM_POLL_MS = 200;
/** A request is asked at least this long, so it is recorded even after the wait's deadline. */
const RECORD_WAIT_MS = 10_000;

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

export interface AtDaemons {
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

/** Starts a daemon in `root`; `null` once one serves it, else why not. */
export type StartDaemon = (root: AbsolutePath) => Promise<string | null>;

/** The real daemons; `start` is `squeal start`'s, quiet, unless a test gives its own. */
export function realDaemons(start: StartDaemon = quietStart): AtDaemons {
  const sockets = new Map<string, AbsolutePath>();
  const socketOf = async (root: AbsolutePath, deadline: number) => {
    const known = sockets.get(root);
    if (known !== undefined) return known;
    const socket = await daemonSocket(root, socketBound(deadline));
    sockets.set(root, socket);
    return socket;
  };
  const serve = async (root: AbsolutePath) => {
    const probe = await probeDaemon(root, DAEMON_SOCKET_TIMEOUT_MS);
    return probe.state === "alive" ? null : start(root);
  };
  return {
    async commit(input) {
      let tree: AbsolutePath;
      try {
        ({ tree } = await ensureCommitWorktree({
          root: input.root,
          commit: input.commit,
          environment: input.environment,
          note: input.note,
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          ...(input.cacheRoot === undefined ? {} : { cacheRoot: input.cacheRoot }),
          ...(input.placeWaitMs === undefined ? {} : { placeWaitMs: input.placeWaitMs }),
        }));
      } catch (error) {
        return { problem: `the commit worktree could not be made: ${messageOf(error)}` };
      }
      const started = await serve(tree);
      if (started !== null) return { problem: `the commit daemon did not start: ${started}` };
      const claimed = await claimedWithin(tree, CLAIM_WAIT_MS);
      if (!claimed)
        return { problem: `the commit daemon did not claim ${tree} in ${CLAIM_WAIT_MS / 1000} s` };
      return tree;
    },
    find: findCommitWorktree,
    worktree: serve,
    async ask(root, group, paths, deadline, call) {
      const bound = Math.max(deadline, Date.now() + RECORD_WAIT_MS);
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

/** Whether the commit daemon claimed `tree` within `ms` (row 023-38's marker). */
export async function claimedWithin(tree: AbsolutePath, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  for (;;) {
    if (readCommitWorktree(tree)?.daemon !== undefined) return true;
    if (Date.now() >= until) return false;
    await sleep(CLAIM_POLL_MS);
  }
}

/** `squeal start <root>`, its status output dropped; its error lines are the answer. */
async function quietStart(root: AbsolutePath): Promise<string | null> {
  const errors: string[] = [];
  const io: CliIo = { stdout: () => undefined, stderr: (text) => errors.push(text) };
  const code = await startCommand([root], io);
  if (code === 0) return null;
  const text = errors.join("").trim().replace(/\s+/g, " ");
  return text === "" ? `squeal start exited ${code}` : text;
}

function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).trim().replace(/^squeal: /, "");
}
