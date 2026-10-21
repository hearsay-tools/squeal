import { existsSync } from "node:fs";
import {
  dropGoneHarnesses,
  dropLeft,
  expireConsumers,
  lastDeparture,
  markRest,
} from "../delivery/index.js";
import { type BusyWaits, storePaths } from "../store/index.js";
import { plural } from "../text.js";
import {
  type AbsolutePath,
  type DaemonExitReason,
  type EpochMs,
  nodeTestObservedMetaKey,
  nodeTestObservedPreloadsMetaKey,
  type Policy,
  type Store,
  type WorktreeId,
} from "../types/index.js";
import { recordDaemonUsed } from "./last-use.js";
import { SlicedWrites } from "./sliced-writes.js";

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
  /**
   * How often the daemon reads the shared node:test observed keys, so another
   * worktree's observation re-keys this one without an edit (task 003-26).
   * Default 5 s.
   */
  readonly observedMs: number;
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
  /**
   * The grace after the last consumer left ended with slow files pending, and
   * the daemon runs them before it exits (task 004-29); its note is written.
   * Cleared when a consumer is counted again.
   */
  draining?: boolean;
  /** What the drain started for, as its note named it (task 001-219). */
  drainingFor?: string;
}

/**
 * The node:test observed keys as the timer last had them taken; unset until
 * its first read. Kept by the daemon, so a policy reload that restarts the
 * timers still notices a change written since the last tick (task 003-42).
 */
export interface ObservedSeen {
  snapshot?: string | null;
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
  /**
   * When the daemon was last used (D10 as amended, task 001-415): its start,
   * a request or a wait; the timers add each edit and each check that finds
   * a tier queued or running. Kept by the daemon. Absent: no unused stop.
   */
  readonly lastUsed?: () => EpochMs;
  readonly used?: (at: EpochMs) => void;
  /**
   * The scheduler's revision, whether it is in use (`Scheduler.inUse`) and
   * the test files it has queued (`Scheduler.queued`, absent: none); `null`
   * before it starts.
   */
  readonly work?: () => {
    readonly revision: number;
    readonly inUse: boolean;
    readonly queued?: number;
  } | null;
  /**
   * A `nodeTest` project's observed keys changed since the last call that
   * returned true: queue a runner-only refinement. False while nothing takes
   * it (no scheduler yet, or its baseline still running: 004 review wave 2.5,
   * B3); the timer asks again at its next read.
   */
  readonly observedChanged?: () => boolean;
  /** Carried across restarts; a fresh one when absent. */
  readonly observedSeen?: ObservedSeen;
  /**
   * A slow file is queued or running (`Scheduler.slowPending`): the last
   * session's departure drains them before the exit (task 004-29). Absent or
   * false: the daemon exits at the grace.
   */
  readonly slowPending?: () => boolean;
  /**
   * What the worktree is owed (`Scheduler.owedWork`): an explicit checkpoint
   * or a new failure's re-run, drained as slow files are (task 001-219).
   * Absent or `null`: nothing.
   */
  readonly owedWork?: () => string | null;
  /**
   * The drain runs only its session's work (`Scheduler.pauseBacklog`, row
   * 011-93): `true` when it starts, `false` when a session registers during
   * it. Absent: the drain runs the whole queue.
   */
  readonly pauseBacklog?: (on: boolean) => void;
  /**
   * Spec 011 C9 (row 011-69): each check asks for the last-resort GC, which
   * runs once no tier ran for 60 s (`IdleGc.check`). Absent: none.
   */
  readonly idleGc?: () => void;
  readonly note: (text: string) => void;
  readonly log: (line: string) => void;
  /**
   * Task 001-422: the heartbeat's, expiry's and prune's writes wait
   * `BUSY_SLICE_MS` for a busy store and are retried soon; what waited goes
   * here. Absent: they wait the store's busy timeout, a failure only logged.
   */
  readonly busyWaits?: BusyWaits;
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
 *
 * Task 004-29, the human's rules (board row 001-162): when the grace ends
 * with slow files pending, the daemon drains them before it exits, for at
 * most `daemon.idleExitMinutes` after the departure, with one note when the
 * drain starts and one for the exit (drained, or the bound). The drain is no
 * activity for the idle period, and a consumer that registers during it
 * cancels the exit: the daemon serves on, its slow files still behind the
 * consumer's fast work (spec 004 D2).
 * Task 001-219: an explicit checkpoint left open and a new failure's re-run
 * queued are drained the same way, within the same bound; past it the
 * scheduler leaves them owed to the next daemon.
 * The shutdown lets a tier in flight finish and store its results (D5). Each
 * heartbeat first drops the consumers whose recorded harness process is gone.
 *
 * Task 001-415 (the human, 2026-10-15): a daemon whose worktree has a
 * consumer registered and that saw no edit, no wait, no request and no work
 * they caused queued or running (`Scheduler.inUse`; the backlog is no use,
 * row 011-92) for `daemon.unusedExitMinutes` stops, reason `idle`, with one
 * note naming the test files it leaves queued; a registered consumer is no
 * use, so a session that idles for hours, or a subagent whose SubagentStop
 * never ran, keeps no daemon.
 * It marks the rest first (`markRest`), so its consumers hear
 * nothing of it, and the next hook boundary starts it again. A drain keeps
 * its own bound.
 *
 * Task 003-26: with `nodeTest` projects, the shared observed keys are read
 * every `observedMs`, and a change asks for a runner-only refinement. What it
 * queues is not activity: the idle and departure exits never wait for it.
 *
 * Row 011-69 (spec 011 C9): each check also asks for the idle last-resort GC.
 */
export function startTimers(context: TimerContext): () => void {
  const { store, worktreeId, now, timings } = context;
  const idleMs = context.policy.daemon.idleExitMinutes * 60_000;
  const unusedMs = context.policy.daemon.unusedExitMinutes * 60_000;
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
  const retries = new SlicedWrites(context);

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
      retries.run("consumer expiry", [
        ["consumer expiry", () => expireConsumers(store, now(), { locksDir })],
      ]);
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
    attempt("unused check", () => unused(at));
    attempt("idle GC", () => context.idleGc?.());
  };
  /** The revision the last unused check saw: a new one is an edit. */
  let seenRevision: number | null = null;
  const unused = (at: EpochMs) => {
    if (context.lastUsed === undefined || presence.draining === true) return;
    const work = context.work?.() ?? null;
    if (work !== null && (work.inUse || work.revision !== seenRevision)) {
      seenRevision = work.revision;
      context.used?.(at);
      return;
    }
    if (at - context.lastUsed() < unusedMs) return;
    // With none registered, the departure grace or the idle period decides.
    const registered = store.consumers.list(worktreeId).length;
    if (registered === 0) return;
    markRest(store, worktreeId, at);
    context.shutdown("idle", unusedText(unusedMs, registered, work?.queued ?? 0));
  };
  /** Counts the worktree's consumers; true when there is none. */
  const countPresence = (at: EpochMs): boolean => {
    if (store.consumers.list(worktreeId).length > 0) {
      presence.lastPresentAt = at;
      if (presence.draining === true) context.pauseBacklog?.(false);
      presence.draining = false;
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
      const gone = at - presence.lastPresentAt;
      if (gone < graceMs) return;
      const pending = drainable(context);
      if (pending === null) {
        context.shutdown(
          "sessions-gone",
          presence.draining === true
            ? drainedText(presence.drainingFor ?? SLOW_FILES)
            : `daemon stopped: no session registered for ${duration(graceMs)} after its last one ended`,
        );
      } else if (gone >= idleMs) {
        context.shutdown("sessions-gone", boundText(pending, idleMs));
      } else if (presence.draining !== true) {
        presence.draining = true;
        presence.drainingFor = pending;
        context.pauseBacklog?.(true);
        const them = pending === SLOW_FILES ? "them" : "that work";
        context.note(
          `the last session ended with ${pending} pending; this daemon runs ${them} before it ` +
            `exits, for at most ${duration(idleMs)} (daemon.idleExitMinutes)`,
        );
      }
    });
  const heartbeat = () =>
    retries.run("the heartbeat", [
      ["heartbeat", () => beat(context, now())],
      ["harness check", () => dropGoneHarnesses(store, worktreeId, now(), { locksDir })],
      ["leaving check", () => dropLeft(store, worktreeId, now(), { locksDir })],
    ]);
  const observedKeys = context.policy.nodeTest.flatMap(({ name }) => [
    nodeTestObservedMetaKey(name),
    nodeTestObservedPreloadsMetaKey(name),
  ]);
  const readObserved = () => JSON.stringify(observedKeys.map((key) => store.meta.get(key)));
  const seen = context.observedSeen ?? {};
  if (seen.snapshot === undefined) {
    seen.snapshot = null;
    attempt("observed read", () => {
      seen.snapshot = readObserved();
    });
  }
  const observed = () =>
    attempt("observed check", () => {
      const read = readObserved();
      if (read !== seen.snapshot && context.observedChanged?.() === true) seen.snapshot = read;
    });
  const prune = () =>
    retries.run("pruning", [
      [
        "prune",
        () =>
          store.prune({
            now: now(),
            retentionDays: context.policy.store.retentionDays,
            maxSizeMb: context.policy.store.maxSizeMb,
          }),
      ],
    ]);

  const timers = [
    setInterval(heartbeat, context.heartbeatMs),
    setInterval(check, checkMs),
    setInterval(departure, presenceMs),
    setInterval(prune, pruneMs),
    ...(observedKeys.length > 0 && context.observedChanged
      ? [setInterval(observed, timings.observedMs ?? 5_000)]
      : []),
  ];
  const first = setTimeout(prune, timings.firstPruneMs ?? 60_000);
  // The socket server keeps the process alive; timers alone never should.
  for (const timer of [...timers, first]) timer.unref();
  return () => {
    for (const timer of timers) clearInterval(timer);
    clearTimeout(first);
    retries.stop();
  };
}

/**
 * The heartbeat at `at`, and with it the daemon's last use (spec 014 D9), in
 * one write. The use is recorded only while the worktree has a daemon record,
 * which the heartbeat moves: a row whose worktree a prune took would outlive
 * it.
 */
function beat(context: TimerContext, at: EpochMs): void {
  const { store, worktreeId } = context;
  store.transaction(() => {
    store.worktrees.heartbeat(worktreeId, at);
    if (context.lastUsed === undefined || !store.worktrees.get(worktreeId)?.daemon) return;
    recordDaemonUsed(store, worktreeId, {
      usedAt: context.lastUsed(),
      activeAt: context.lastActive(),
    });
  });
}

const SLOW_FILES = "slow files";

/** What the departure drains, as its notes name it; `null` with nothing pending. */
function drainable(context: TimerContext): string | null {
  const slow = context.slowPending?.() === true ? [SLOW_FILES] : [];
  const owed = context.owedWork?.() ?? null;
  const all = [...slow, ...(owed === null ? [] : [owed])];
  return all.length === 0 ? null : all.join(" and ");
}

function drainedText(drained: string): string {
  return drained === SLOW_FILES
    ? "daemon stopped: the slow files pending when its last session ended have run"
    : `daemon stopped: the work pending when its last session ended is done (${drained})`;
}

function boundText(pending: string, idleMs: number): string {
  const after = `${duration(idleMs)} after its last session ended (daemon.idleExitMinutes)`;
  return pending === SLOW_FILES
    ? `daemon stopped: slow files were still pending ${after}`
    : `daemon stopped: still pending ${after}: ${pending}; the next daemon resumes what is owed`;
}

function unusedText(unusedMs: number, registered: number, queued: number): string {
  const sessions = registered === 1 ? "1 session registered" : `${registered} sessions registered`;
  const left = queued === 0 ? "" : ` and ${plural(queued, "test file")} queued`;
  return (
    `daemon stopped: no edit, run, wait or request for ${duration(unusedMs)} ` +
    `(daemon.unusedExitMinutes), with ${sessions}${left}; the next hook starts it again`
  );
}

/**
 * The one note of a daemon that steps down for a newer hook (lessons, defect
 * 26). The step-down cancels its tiers in flight, as a stop does (row
 * 011-31); the asking hook's successor, waiting for the lock, starts from its
 * own CLI (task 001-130).
 */
export function stepDownNote(own: string, hook: string): string {
  return `daemon stopped: hooks at Squeal ${hook} are newer than this daemon (${own}); their daemon starts once this one exits`;
}

/** `1.8 s`, `60 min`. */
export function duration(ms: number): string {
  return ms < 60_000
    ? `${Number((ms / 1000).toFixed(1))} s`
    : `${Number((ms / 60_000).toFixed(1))} min`;
}
