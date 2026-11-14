import type { StatusHold } from "../../core/types/standing.js";

/*
 * Row 011-331 (`research/waits.md`, "status-waits-join"): the status waits
 * by name, each one row beside the run waits' (`RUN_WAITS`, `table.ts`),
 * decided by the same chain walk (`decide.ts`). A row is the wait's chain of
 * conditions in the order the wait checked them before the move; a cell is
 * a difference between two waits, each named where it stands. The reads
 * stay each wait's own (`status.ts`, `named.ts`, `snapshot.ts`): a read
 * fills the record, and the chain asks for the hold only when it reaches it.
 */

/**
 * A status wait by name (GLOSSARY "Status wait"): `edit`, `status --wait`
 * and the file wait of `run --slow --wait`; `named`, `status <path> --wait`;
 * `snapshot`, `status <path>`.
 */
export type StatusWaitName = "edit" | "named" | "snapshot";

/** How often a status wait reads the store, as a run wait does (C6 as amended, task 011-42). */
export const STATUS_POLL_MS = 1_000;

/**
 * The settle time, a cell of the status waits that the run waits do not
 * have (row 011-327, decision 4): the shortest `edit` or `named` wait that
 * may end without a daemon, which a daemon a hook just spawned needs to
 * record its heartbeat, and the shortest that may decide when no daemon can
 * sync; the longest the `snapshot` waits for its sync. A daemon that syncs
 * decides sooner (lessons, defect 30).
 */
export const SETTLE_MS = 750;

/** A field of a status read record (`StatusRecord`). */
export type StatusField =
  | "store"
  | "first"
  | "late"
  | "settled"
  | "daemon"
  | "news"
  | "quiet"
  | "decided"
  | "hold";

/** A condition on a status read record; `STATUS_FIELD_OF` names the field it reads. */
export type StatusCondition =
  | "store unread"
  | "first read"
  | "late"
  | "settled"
  | "daemon down"
  | "news"
  | "quiet"
  | "decided settled"
  | "decided focused"
  | "decided unmatched"
  | "decided slow"
  | "held";

/** The field each condition reads. */
export const STATUS_FIELD_OF: Readonly<Record<StatusCondition, StatusField>> = {
  "store unread": "store",
  "first read": "first",
  late: "late",
  settled: "settled",
  "daemon down": "daemon",
  news: "news",
  quiet: "quiet",
  "decided settled": "decided",
  "decided focused": "decided",
  "decided unmatched": "decided",
  "decided slow": "decided",
  held: "hold",
};

/** How a read decided a named selection; `null`, not yet. */
export type Decided = "settled" | "focused" | "unmatched" | "slow";

/**
 * What one read of a status wait found. A field is absent until the
 * decision asked for it; a read fills every field but the hold, as before
 * the move, and the hold only when the chain reaches it.
 */
export interface StatusRecord {
  /** Whether the read read the store; `unread`, `withStatusStore` said why not. */
  readonly store?: "read" | "unread";
  /** No read decided yet (`edit`: none took the start view; `named`: none went on). */
  readonly first?: boolean;
  /** The read is the deadline's (`final`). */
  readonly late?: boolean;
  /** The settle time passed, or the read is the deadline's. */
  readonly settled?: boolean;
  /** The daemon check, by the row's `daemon` cell. */
  readonly daemon?: "alive" | "lapsed" | "down";
  /** `edit`: the transitions of the checks it holds for since the start. */
  readonly news?: number;
  /** `edit`: nothing it holds for pending at a revision that holds the daemon's pass. */
  readonly quiet?: boolean;
  /** `named`, `snapshot`: how the read decided the selection. */
  readonly decided?: Decided | null;
  /** A file it holds for queued while the worktree is on hold (row 011-73); `null`: none. */
  readonly hold?: StatusHold | null;
}

/**
 * Why `status --wait` ended (spec 001 D7): `quiet`, nothing pending at the
 * current revision, or none of the edit's test files; `news`, a check, or
 * a check of the edit's test files, changed notably since the wait started;
 * `no-daemon`, no daemon is validating, so nothing pending would ever finish
 * and quiet would say nothing about the files (review wave 4.5, S2);
 * `on-hold`, a file it holds for is queued while the worktree is on hold, so
 * nothing runs it until the hold ends (row 011-73, C6 as amended
 * 2026-10-21); `timeout`, none of these within the given time.
 */
export type StatusWaitOutcome = "quiet" | "news" | "no-daemon" | "on-hold" | "timeout";

/**
 * Spec 005 D2's path form: `settled`, no selected file it holds for pending;
 * `unmatched`, no path selects a file; `slow`, every selected file runs only
 * on a pause (task 004-78), so there is nothing to hold for; `on-hold`, a
 * file it holds for is queued while the worktree is on hold (row 011-73,
 * C6 as amended 2026-10-21); `focused`, every file named by its own path
 * with `--check` has its focused answer (row 011-146, C15 as amended
 * 2026-10-23). Row 011-63 (gh-59): a path that selects nothing beside one
 * that selects a file is named beside the other outcomes
 * (`selection.unmatched`).
 */
export type NamedWaitOutcome =
  | "settled"
  | "focused"
  | "unmatched"
  | "slow"
  | "no-daemon"
  | "on-hold"
  | "timeout";

/** Each status wait's closed set of outcomes; `unavailable`, the store was not read. */
export interface StatusOutcomeOf {
  readonly edit: StatusWaitOutcome | "unavailable";
  readonly named: NamedWaitOutcome | "unavailable";
  readonly snapshot: Exclude<NamedWaitOutcome, "focused"> | "unavailable";
}

export type StatusOutcome = StatusOutcomeOf[StatusWaitName];

/** One link of a chain: when every condition holds, the wait ends with `then`; `go on` ends the chain. */
export interface StatusRule {
  readonly when: readonly StatusCondition[];
  readonly then: StatusOutcome | "go on";
}

/** A status wait's row. */
export interface StatusRow {
  /**
   * The daemon check: daemon presence's wait view (`watchDaemon`), which
   * waits through a lapsed heartbeat and a handoff; or, the snapshot's,
   * the raw heartbeat (`daemonLiveness`), alive or not.
   */
  readonly daemon: "wait view" | "heartbeat";
  /**
   * A daemon that cannot sync (lessons, defect 30): a read may decide once
   * the settle time passed; or, the snapshot's, never, so it has no verdict
   * (review of cand/0.1.233, B1). `passReached` reads it.
   */
  readonly unsupported: "after settle" | "never";
  /** The chain: the first rule whose conditions all hold ends the wait; with none, it goes on. */
  readonly rules: readonly StatusRule[];
}

const rule = (when: readonly StatusCondition[], then: StatusRule["then"]): StatusRule => ({
  when,
  then,
});

/**
 * A read that did not read the store (`withStatusStore`'s unavailable),
 * the `edit` and `named` waits: the first one, or the deadline's, ends the
 * wait as `unavailable` (exit 1); one between them is skipped. A run wait
 * reads a busy store again and ends on any other failure (`STORE`,
 * `table.ts`), with exit 3.
 */
const SKIP_STORE: readonly StatusRule[] = [
  rule(["store unread", "first read"], "unavailable"),
  rule(["store unread", "late"], "unavailable"),
  rule(["store unread"], "go on"),
];

/** The status waits' rows. */
export const STATUS_WAITS: Readonly<Record<StatusWaitName, StatusRow>> = {
  // `status --wait`: news > no daemon > quiet > on hold > timeout.
  edit: {
    daemon: "wait view",
    unsupported: "after settle",
    rules: [
      ...SKIP_STORE,
      rule(["news"], "news"),
      rule(["settled", "daemon down"], "no-daemon"),
      rule(["quiet"], "quiet"),
      rule(["held"], "on-hold"),
      rule(["late"], "timeout"),
    ],
  },
  // `status <path> --wait`: no daemon > decided > on hold > timeout.
  named: {
    daemon: "wait view",
    unsupported: "after settle",
    rules: [
      ...SKIP_STORE,
      rule(["settled", "daemon down"], "no-daemon"),
      rule(["decided settled"], "settled"),
      rule(["decided focused"], "focused"),
      rule(["decided unmatched"], "unmatched"),
      rule(["decided slow"], "slow"),
      rule(["held"], "on-hold"),
      rule(["late"], "timeout"),
    ],
  },
  // `status <path>`: as named at its one read, which is its last; no settle time before no
  // daemon, as it read after the settle time or the sync; it requests nothing, so it never
  // decides `focused` (C6).
  snapshot: {
    daemon: "heartbeat",
    unsupported: "never",
    rules: [
      rule(["store unread"], "unavailable"),
      rule(["daemon down"], "no-daemon"),
      rule(["decided settled"], "settled"),
      rule(["decided unmatched"], "unmatched"),
      rule(["decided slow"], "slow"),
      rule(["held"], "on-hold"),
      rule([], "timeout"),
    ],
  },
};
