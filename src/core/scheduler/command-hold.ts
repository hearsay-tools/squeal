import { harnessGone, pidNamespace, readProcStat } from "../delivery/harness-process.js";
import { isBusy } from "../store/connection.js";
import type { EpochMs, WorktreeId } from "../types/common.js";
import type { Store } from "../types/store.js";
import type { HarnessProcess } from "../types/store-records.js";
import {
  type CommandHoldEntry,
  type EndedCommandHold,
  pruneCommandHolds,
  readCommandHolds,
} from "./hold-rows.js";
import type { WakeSlot, Wakes } from "./wakes.js";

/*
 * Row 011-74 (spec 011 C9 as amended 2026-10-21, "Holds", *Hold command*;
 * `tasks/011-61/design.md` R3): `squeal hold -- <command>` holds the
 * worktree's validation for the life of the command. Its entries live in
 * the `commandHold` row of `meta`, so they outlive any one process. The daemon
 * reads them at its start, at each heartbeat and at each `hold` or `resume`
 * request, and at the earliest `until`; each read removes, with one note,
 * the entries whose processes are both gone or whose `until` passed.
 */

/** `squeal hold`'s bound when `--max` does not set one. */
export const COMMAND_HOLD_MAX_MS = 3 * 60 * 60 * 1000;

/** Process `pid` as a harness process is recorded (C8); `null` without `/proc` or once it is gone. */
export function processIdentity(pid: number): HarnessProcess | null {
  const namespace = pidNamespace();
  if (namespace === null) return null;
  try {
    const stat = readProcStat(pid);
    return stat === null ? null : { pid, startTime: stat.startTime, pidNamespace: namespace };
  } catch {
    return null;
  }
}

/**
 * Whether `entry`'s holder is gone: every process it recorded is surely gone
 * (`harnessGone`: missing, reused or a zombie). One in another PID namespace,
 * or none recorded (no `/proc`), is never judged; only `until` ends it.
 */
export function holderGone(entry: CommandHoldEntry, namespace: string | null): boolean {
  const recorded = [entry.wrapper, entry.child].filter((p): p is HarnessProcess => p !== null);
  return recorded.length > 0 && recorded.every((p) => harnessGone(p, namespace));
}

/** `entry` as status and the notes name it: its command and the pid of its command, else its wrapper's. */
export function holdName(entry: CommandHoldEntry): string {
  const pid = (entry.child ?? entry.wrapper)?.pid;
  return `\`${entry.command}\`${pid === undefined ? "" : ` (pid ${pid})`}`;
}

/** `ms` in the largest unit that holds it whole: `3 h`, `90 m`, `2 s`. */
export function boundText(ms: number): string {
  if (ms >= 3_600_000 && ms % 3_600_000 === 0) return `${ms / 3_600_000} h`;
  if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000} m`;
  return `${Math.round(ms / 1_000)} s`;
}

/** The note of one entry a read removed; `last` when no hold is left, of either cause. */
export function endedNote({ entry, reason }: EndedCommandHold, last: boolean): string {
  const why =
    reason === "until"
      ? `passed its ${boundText(entry.until - entry.since)} bound`
      : "ended: its command is gone";
  return `the hold for ${holdName(entry)} ${why}${last ? "; validating again" : ""}`;
}

/** What one read of the command-hold row decides (row 011-355). */
export interface HoldDecision {
  /** The entries that end now, each with its cause, in the row's order. */
  readonly ended: readonly EndedCommandHold[];
  /** The entries that stay. */
  readonly left: readonly CommandHoldEntry[];
  /** The earliest `until` of `left`: the next read; `null` without an entry left. */
  readonly wakeAt: EpochMs | null;
  /**
   * What the owners do: `prune` removes `ended` with their notes in one
   * transaction; while `left` holds, the scheduler cancels its held tiers and
   * closes its idle slow lanes (`hold`); once none holds, it pumps if the
   * previous read held (`free`).
   */
  readonly prune: boolean;
  readonly next: "hold" | "free";
}

/** Why `entry` ends at `at`: its `until` passed, or its holder is `gone`; `null` while it holds. */
export function holdEnd(
  entry: CommandHoldEntry,
  at: EpochMs,
  gone: (entry: CommandHoldEntry) => boolean,
): EndedCommandHold["reason"] | null {
  return entry.until <= at ? "until" : gone(entry) ? "gone" : null;
}

/**
 * Row 011-355: which of `entries` end at `at`, which stay with the next
 * read at their earliest `until`, and what to do. Pure over its arguments;
 * `gone` is asked only of an entry whose `until` is still ahead.
 */
export function decideHolds(
  entries: readonly CommandHoldEntry[],
  at: EpochMs,
  gone: (entry: CommandHoldEntry) => boolean,
): HoldDecision {
  const ended: EndedCommandHold[] = [];
  const left: CommandHoldEntry[] = [];
  for (const entry of entries) {
    const reason = holdEnd(entry, at, gone);
    if (reason === null) left.push(entry);
    else ended.push({ entry, reason });
  }
  return holdDecision(ended, left);
}

/** The decision of `ended` and `left`: the wake at the earliest `until` left, and what to do. */
function holdDecision(
  ended: readonly EndedCommandHold[],
  left: readonly CommandHoldEntry[],
): HoldDecision {
  const wakeAt = left.length === 0 ? null : (Math.min(...left.map((e) => e.until)) as EpochMs);
  return { ended, left, wakeAt, prune: ended.length > 0, next: left.length > 0 ? "hold" : "free" };
}

/** The notes of `ended`, one each; the last says "validating again" when no hold is left, of either cause. */
export function endedNotes(ended: readonly EndedCommandHold[], last: boolean): string[] {
  return ended.map((one, i) => endedNote(one, last && i === ended.length - 1));
}

export interface CommandHoldOptions {
  readonly store: Store;
  readonly worktreeId: WorktreeId;
  readonly now: () => EpochMs;
  /** Persists `message` through `store`: an end note's write nests in its removal's transaction. */
  readonly note: (message: string) => void;
  /** The merge hold holds: a removal leaves the worktree on hold. */
  readonly merging: () => boolean;
  /** The earliest `until` came: the scheduler reads the row again. */
  readonly due: () => void;
  /** Whether an entry's holder is gone; default `holderGone` in this process's PID namespace. */
  readonly gone?: (entry: CommandHoldEntry) => boolean;
  /** The scheduler's wake loop (row 011-352). */
  readonly wakes: Wakes;
}

/** The command holds of one worktree, as the daemon last read them. */
export class CommandHold {
  #entries: readonly CommandHoldEntry[] = [];
  #failed: string | null = null;
  /** The wake at the earliest `until` (row 011-352). */
  readonly #wake: WakeSlot;
  #closed = false;

  constructor(private readonly options: CommandHoldOptions) {
    this.#wake = options.wakes.slot("command-hold", () => this.options.due());
  }

  get holding(): boolean {
    return this.#entries.length > 0;
  }

  get entries(): readonly CommandHoldEntry[] {
    return this.#entries;
  }

  /**
   * Reads the row again and removes each entry whose holder is gone or whose
   * `until` passed, with one note each; returns whether an entry holds. Only
   * a removal writes, and its notes go in its transaction: `note` persists
   * through `store`, so a reader sees an ended entry or its note, never
   * neither (row 011-231). A busy store leaves the hold as it was until the
   * next check; any other failure too, with one note until a read succeeds.
   */
  check(): boolean {
    if (this.#closed) return this.holding;
    const { store, worktreeId, now, note } = this.options;
    const at = now();
    const namespace = this.options.gone === undefined ? pidNamespace() : null;
    const gone = this.options.gone ?? ((entry: CommandHoldEntry) => holderGone(entry, namespace));
    let read: HoldDecision;
    try {
      read = decideHolds(readCommandHolds(store, worktreeId), at, gone);
      if (read.prune) {
        // The removal reads the row again in its transaction and decides by the same rule.
        read = store.transaction(() => {
          const pruned = pruneCommandHolds(store, worktreeId, (entry) => holdEnd(entry, at, gone));
          const last = pruned.left.length === 0 && !this.options.merging();
          for (const text of endedNotes(pruned.ended, last)) note(text);
          return holdDecision(pruned.ended, pruned.left);
        });
      }
      this.#failed = null;
    } catch (error) {
      if (isBusy(error)) return this.holding;
      const message = String(error);
      if (this.#failed !== message) note(`squeal: could not read the command holds: ${message}`);
      this.#failed = message;
      return this.holding;
    }
    this.#entries = read.left;
    this.#arm(read.wakeAt);
    return this.holding;
  }

  close(): void {
    this.#closed = true;
    this.#wake.clear();
  }

  /**
   * The wake at the read's earliest `until`, none without an entry; the loop
   * clamps a far one and reads again. `until` is stored calendar time, which
   * other processes compare: the wake is the delay to it (row 011-369).
   */
  #arm(wakeAt: EpochMs | null): void {
    if (wakeAt === null || this.#closed) this.#wake.clear();
    else this.#wake.after(wakeAt - this.options.now());
  }
}
