import { existsSync } from "node:fs";
import { dropGoneHarnesses, expireConsumers, lastDeparture } from "../delivery/index.js";
import { storePaths } from "../store/index.js";
import type {
  AbsolutePath,
  DaemonExitReason,
  EpochMs,
  Policy,
  Store,
  WorktreeId,
} from "../types/index.js";

/** How often the daemon does its periodic work. Every field has a default. */
export interface DaemonTimings {
  /** Heartbeat into `worktrees` (D10). Status reports the daemon down after two missed ones. */
  readonly heartbeatMs: number;
  /**
   * Root, worktree entry and idle checks. Default: a tenth of the idle
   * period, between 50 ms and 5 s.
   */
  readonly checkMs: number;
  /**
   * Consumer expiry (D10: 12 hours without a delivery or a call; 10 minutes
   * once the idle waiter is gone, task 001-47).
   */
  readonly expireMs: number;
  /** Store pruning (D8), first after `firstPruneMs`. */
  readonly pruneMs: number;
  readonly firstPruneMs: number;
  /** How often the daemon counts its worktree's consumers. Default 250 ms. */
  readonly presenceMs: number;
  /**
   * How long a daemon that had a consumer runs with none before it exits, so
   * `/clear` and `/resume` keep it (lessons, defect 24). Default 3 s.
   */
  readonly departureGraceMs: number;
}

/**
 * When the daemon last knew a consumer of its worktree registered, from its
 * own count or a departure stamped since `since`; `null` while it never had
 * one. Kept by the daemon, so a policy reload that restarts the timers does
 * not forget it.
 */
export interface Presence {
  /** When the daemon started: a departure before it was another daemon's. */
  readonly since: EpochMs;
  lastPresentAt: EpochMs | null;
}

export interface TimerContext {
  readonly root: AbsolutePath;
  readonly worktreeId: WorktreeId;
  /** The git common dir: its store's `locks/` holds the waiter locks the expiry pass reads. */
  readonly commonDir: AbsolutePath;
  readonly store: Store;
  readonly policy: Policy;
  readonly now: () => EpochMs;
  /** `<common-dir>/worktrees/<name>` of a linked worktree; `null` for the main one. */
  readonly linkedDir: AbsolutePath | null;
  readonly timings: Partial<DaemonTimings>;
  readonly heartbeatMs: number;
  readonly presence: Presence;
  /** Last nudge, request or registered consumer. */
  readonly lastActive: () => EpochMs;
  readonly active: (at: EpochMs) => void;
  readonly note: (text: string) => void;
  readonly log: (line: string) => void;
  readonly shutdown: (reason: DaemonExitReason, text: string) => void;
}

/**
 * Starts the heartbeat, the lifecycle checks and pruning. Returns a function
 * that stops them.
 *
 * Spec 001 D10: "The daemon exits when its root is deleted, when
 * `<common-dir>/worktrees/<name>` disappears, [...] or after a configurable
 * idle period with no registered consumers (default 60 minutes). A consumer
 * that has not been delivered to or heard from for 12 hours is expired".
 *
 * Lessons, defect 24, the human's rule: the idle period is for a daemon that
 * never had a consumer (`squeal start`). One that had a consumer exits once
 * was registered for `departureGraceMs`, measured from the last count that
 * saw one or the last departure stamped, whichever is later, so the exit
 * comes at most the grace after the last consumer left.
 * The shutdown lets a tier in flight finish and store its results (D5). Each
 * heartbeat first drops the consumers whose recorded harness process is gone.
 */
export function startTimers(context: TimerContext): () => void {
  const { store, worktreeId, now, timings } = context;
  const idleMs = context.policy.daemon.idleExitMinutes * 60_000;
  const checkMs = timings.checkMs ?? Math.min(5_000, Math.max(50, idleMs / 10));
  const expireMs = timings.expireMs ?? 60_000;
  const pruneMs = timings.pruneMs ?? 60 * 60_000;
  const presenceMs = timings.presenceMs ?? 250;
  const graceMs = timings.departureGraceMs ?? 3_000;
  const { presence } = context;
  const { locksDir } = storePaths(context.commonDir);
  let lastExpire = Number.NEGATIVE_INFINITY;
  const attempt = (what: string, fn: () => void) => {
    try {
      fn();
    } catch (error) {
      context.log(`${what} failed: ${String(error)}`);
    }
  };

  const check = () => {
    if (!existsSync(context.root)) {
      context.shutdown("root-removed", `daemon stopped: worktree root ${context.root} was deleted`);
      return;
    }
    if (context.linkedDir !== null && !existsSync(context.linkedDir)) {
      context.shutdown(
        "worktree-removed",
        `daemon stopped: worktree entry ${context.linkedDir} was removed`,
      );
      return;
    }
    const at = now();
    if (at - lastExpire >= expireMs) {
      lastExpire = at;
      attempt("consumer expiry", () => expireConsumers(store, at, { locksDir }));
    }
    attempt("idle check", () => {
      if (presence.lastPresentAt !== null || !countPresence(at)) return;
      if (at - context.lastActive() >= idleMs) {
        context.shutdown(
          "idle",
          `daemon stopped: idle for ${duration(idleMs)} with no registered consumers`,
        );
      }
    });
  };
  /** Counts the worktree's consumers; true when there is none. */
  const countPresence = (at: EpochMs): boolean => {
    if (store.consumers.list(worktreeId).length > 0) {
      presence.lastPresentAt = at;
      context.active(at);
      return false;
    }
    const left = lastDeparture(store, worktreeId);
    if (left !== null && left >= presence.since) {
      presence.lastPresentAt = Math.max(presence.lastPresentAt ?? left, left);
    }
    return true;
  };
  const departure = () =>
    attempt("departure check", () => {
      const at = now();
      if (!countPresence(at) || presence.lastPresentAt === null) return;
      if (at - presence.lastPresentAt >= graceMs) {
        context.shutdown(
          "sessions-gone",
          `daemon stopped: no session registered for ${duration(graceMs)} after its last one ended`,
        );
      }
    });
  const heartbeat = () => {
    attempt("heartbeat", () => store.worktrees.heartbeat(worktreeId, now()));
    attempt("harness check", () => dropGoneHarnesses(store, worktreeId, now(), { locksDir }));
  };
  const prune = () =>
    attempt("prune", () => {
      store.prune({
        now: now(),
        retentionDays: context.policy.store.retentionDays,
        maxSizeMb: context.policy.store.maxSizeMb,
      });
    });

  const timers = [
    setInterval(heartbeat, context.heartbeatMs),
    setInterval(check, checkMs),
    setInterval(departure, presenceMs),
    setInterval(prune, pruneMs),
  ];
  const first = setTimeout(prune, timings.firstPruneMs ?? 60_000);
  // The socket server keeps the process alive; timers alone never should.
  for (const timer of [...timers, first]) timer.unref();
  return () => {
    for (const timer of timers) clearInterval(timer);
    clearTimeout(first);
  };
}

/**
 * The one note of a daemon that steps down for a newer hook (lessons, defect
 * 26). The shutdown lets a tier in flight finish and store its results; the
 * next hook finds no daemon and starts one from its own, current CLI.
 */
export function stepDownNote(own: string, hook: string): string {
  return `daemon stopped: hooks at Squeal ${hook} are newer than this daemon (${own}); the next hook starts a current one`;
}

/** `1.8 s`, `60 min`. */
export function duration(ms: number): string {
  return ms < 60_000
    ? `${Number((ms / 1000).toFixed(1))} s`
    : `${Number((ms / 60_000).toFixed(1))} min`;
}
