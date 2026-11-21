import { type CommitRemoval, pathState } from "../checkout/commit-identity.js";
import {
  claimCommitWorktree,
  readCommitWorktree,
  removeCommitWorktree,
} from "../checkout/commit-worktree.js";
import type { CodePass } from "../code/pass/index.js";
import type { AbsolutePath, EpochMs } from "../types/common.js";
import type { DaemonExitReason } from "../types/daemon.js";
import type { Policy } from "../types/policy.js";
import type { WatcherBackend } from "../types/watcher.js";

/*
 * Spec 023 D7.2 (row 023-39): a daemon in a commit worktree. It serves
 * `run-group-paths` requests and `--wait` as every daemon does, and takes
 * permits from the per-user pool as every daemon does (D7.5). It differs in
 * five rules:
 *
 * - its start is lookup-only, whatever `baseline.onStart` says;
 * - it starts no lint pass and no complexity count;
 * - it watches no edits: nobody edits a commit worktree;
 * - it exits 10 minutes after its last activity and at most 3 hours after
 *   its start;
 * - its exit removes its worktree (023-38's `removeCommitWorktree`).
 *
 * The rest of the policy stays as `squeal.config.json` says. `complexity.
 * enabled` false would turn coverage off (`coverageOn`), and the coverage
 * options are part of Vitest's environment key: the commit daemon's results
 * would then land at keys that D2's keyer and the user's daemons never read
 * (D7.1: "Keys there equal D2's by construction").
 */

/** D7.2: a commit daemon exits this long after its last activity. */
export const COMMIT_IDLE_EXIT_MS = 10 * 60_000;
/** D7.2: a commit daemon exits this long after its start, at most. */
export const COMMIT_MAX_LIFE_MS = 3 * 60 * 60_000;

/**
 * The commit worktree functions the daemon uses (row 023-38,
 * `src/core/checkout/commit-worktree.ts`); tests pass their own.
 */
export interface CommitWorktrees {
  /** The commit worktree's marker when `root` is the tree of one, else `null`. */
  read(root: AbsolutePath): unknown;
  /** Records this daemon's pid and start in the marker; the sweep reads it. */
  claim(root: AbsolutePath): void;
  /**
   * Removes the worktree and its folder: ends what still runs under it (D6),
   * then the tree. Called by the daemon that owns it, from its live process,
   * before it releases its daemon lock. Already gone: nothing to do. `note`
   * takes the report: the processes it ended and an error it caught (review
   * wave-22 S1). It says what is left of the tree (review wave-22 N3);
   * without an answer, the daemon reads the tree itself.
   */
  remove(root: AbsolutePath, note: (text: string) => void): Promise<CommitRemoval | undefined>;
}

/** 023-38's functions: the marker decides, the owning daemon claims and removes its worktree. */
export const COMMIT_WORKTREES: CommitWorktrees = {
  read: readCommitWorktree,
  claim: claimCommitWorktree,
  remove: (root, note) => removeCommitWorktree(root, { note }),
};

/** No commit worktrees: no marker is read and nothing is removed. */
export const NO_COMMIT_WORKTREES: CommitWorktrees = {
  read: () => null,
  claim: () => {},
  remove: async () => undefined,
};

/** How a commit daemon lives and ends. */
export interface CommitMode {
  readonly worktrees: CommitWorktrees;
  readonly idleMs: number;
  readonly maxLifeMs: number;
}

export interface CommitModeOptions {
  /** Explicit: `true` is commit mode, `false` never; absent, the worktree's marker decides. */
  readonly commitMode?: boolean;
  readonly commitWorktrees?: CommitWorktrees;
  /** For tests: the idle period and the cap. Default `COMMIT_IDLE_EXIT_MS`, `COMMIT_MAX_LIFE_MS`. */
  readonly commitTimes?: { readonly idleMs?: number; readonly maxLifeMs?: number };
}

/** The daemon at `root` runs in commit mode: an explicit option, or else the marker. */
export function commitModeOf(options: CommitModeOptions, root: AbsolutePath): CommitMode | null {
  const worktrees = options.commitWorktrees ?? COMMIT_WORKTREES;
  const on = options.commitMode ?? worktrees.read(root) !== null;
  if (!on) return null;
  return {
    worktrees,
    idleMs: options.commitTimes?.idleMs ?? COMMIT_IDLE_EXIT_MS,
    maxLifeMs: options.commitTimes?.maxLifeMs ?? COMMIT_MAX_LIFE_MS,
  };
}

/** The policy a commit daemon runs: the file's, with a lookup-only start. */
export function commitPolicy(policy: Policy): Policy {
  return policy.baseline.onStart === "lookup-only"
    ? policy
    : { ...policy, baseline: { ...policy.baseline, onStart: "lookup-only" } };
}

/** A watcher that reports nothing: a commit worktree has no edits to watch. */
export const NO_WATCH: WatcherBackend = {
  name: "chokidar",
  watch: async () => ({ update: async () => {}, close: async () => {} }),
};

/** A code pass that counts nothing: a commit daemon counts no complexity. */
export const NO_CODE_PASS: CodePass = {
  nudge: () => {},
  soon: () => {},
  idle: async () => {},
  close: async () => {},
};

/**
 * The change feed's timings in commit mode: its interval pass would only
 * stat a tree nobody edits. `status --wait` and `run --all` still ask for
 * their own pass (`DaemonLoop.reconcile`).
 */
export const COMMIT_FEED_TIMINGS = { reconcileIntervalMs: COMMIT_MAX_LIFE_MS } as const;

/** Every exit removes the worktree but a step-down's, whose successor serves the same root. */
export function removesAtExit(reason: DaemonExitReason): boolean {
  return reason !== "superseded";
}

/**
 * The exit text after the removal at `root` (review wave-22 S1): the
 * worktree is named removed only when it is gone; otherwise the sweep
 * removes it once this daemon is dead (D7.2). Review wave-22 N3: a tree
 * Squeal could not read is neither; `undefined` reads the tree by `lstat`.
 */
export function removalText(
  text: string,
  root: AbsolutePath,
  outcome: CommitRemoval | undefined,
): string {
  switch (outcome ?? pathState(root)) {
    case "removed":
      return `${text}; the commit worktree is removed`;
    case "kept":
      return `${text}; the commit worktree is not removed (${root}): the sweep removes it later`;
    case "unknown":
      return `${text}; the commit worktree may still be there (${root}): Squeal could not read it`;
  }
}

/** What the lifecycle check reads of a commit daemon's work. */
export interface CommitWork {
  /** Test files queued, a tier's files waiting for a pool permit included. */
  readonly queued: number;
  /** Tiers running, in any lane. */
  readonly running: number;
}

export interface CommitLife {
  readonly mode: CommitMode;
  /** When the daemon started: the cap counts from here. */
  readonly startedAt: EpochMs;
  /** `null` before the scheduler started and while the daemon stops. */
  readonly work: () => CommitWork | null;
}

/**
 * One lifecycle check of a commit daemon at `at` (D7.2), after its request
 * progress was read. A queued or running file is activity: a tier refused by
 * the per-user pool leaves its files queued (`tier-start.ts`, "a refusal
 * holds the lane's files"), so a queue waiting for a permit keeps the daemon
 * (research `run-wait-model.md`, open question 4). A waiting `--wait` call
 * reads the store and is invisible here; it waits only while its files are
 * queued or running, which is activity. Returns the exit, or `null`.
 */
export function commitCheck(
  life: CommitLife,
  at: EpochMs,
  lastActive: () => EpochMs,
  active: (at: EpochMs) => void,
): { readonly reason: DaemonExitReason; readonly text: string } | null {
  const { mode } = life;
  if (at - life.startedAt >= mode.maxLifeMs) {
    return { reason: "lifetime-cap", text: capText(mode.maxLifeMs) };
  }
  const work = life.work();
  if (work !== null && (work.queued > 0 || work.running > 0)) {
    active(at);
    return null;
  }
  if (at - lastActive() < mode.idleMs) return null;
  return { reason: "idle", text: idleText(mode.idleMs) };
}

function capText(maxLifeMs: number): string {
  return (
    `daemon stopped: this commit worktree's daemon reached its limit of ${minutes(maxLifeMs)} ` +
    "after its start; its results stay in the store"
  );
}

function idleText(idleMs: number): string {
  return (
    `daemon stopped: this commit worktree's daemon had no request and no queued or running ` +
    `file for ${minutes(idleMs)}; its results stay in the store`
  );
}

function minutes(ms: number): string {
  return ms >= 3_600_000 && ms % 3_600_000 === 0
    ? `${ms / 3_600_000} h`
    : `${Number((ms / 60_000).toFixed(1))} min`;
}
