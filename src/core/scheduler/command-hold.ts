import { harnessGone, pidNamespace, readProcStat } from "../delivery/harness-process.js";
import type { EpochMs, HarnessProcess, Store, WorktreeId } from "../types/index.js";
import { type CommandHoldEntry, type EndedCommandHold, pruneCommandHolds } from "./hold-rows.js";

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

export interface CommandHoldOptions {
  readonly store: Store;
  readonly worktreeId: WorktreeId;
  readonly now: () => EpochMs;
  readonly note: (message: string) => void;
  /** The merge hold holds: a removal leaves the worktree on hold. */
  readonly merging: () => boolean;
  /** The earliest `until` came: the scheduler reads the row again. */
  readonly due: () => void;
  /** Whether an entry's holder is gone; default `holderGone` in this process's PID namespace. */
  readonly gone?: (entry: CommandHoldEntry) => boolean;
}

/** The command holds of one worktree, as the daemon last read them. */
export class CommandHold {
  #entries: readonly CommandHoldEntry[] = [];
  #failed: string | null = null;
  #timer: NodeJS.Timeout | null = null;
  #closed = false;

  constructor(private readonly options: CommandHoldOptions) {}

  get holding(): boolean {
    return this.#entries.length > 0;
  }

  get entries(): readonly CommandHoldEntry[] {
    return this.#entries;
  }

  /**
   * Reads the row again and removes each entry whose holder is gone or whose
   * `until` passed, with one note each; returns whether an entry holds. A
   * store that fails leaves the hold as it was, with one note until a read
   * succeeds.
   */
  check(): boolean {
    if (this.#closed) return this.holding;
    const { store, worktreeId, now, note } = this.options;
    const at = now();
    const namespace = this.options.gone === undefined ? pidNamespace() : null;
    const gone = this.options.gone ?? ((entry: CommandHoldEntry) => holderGone(entry, namespace));
    let read: ReturnType<typeof pruneCommandHolds>;
    try {
      read = pruneCommandHolds(store, worktreeId, (entry) =>
        entry.until <= at ? "until" : gone(entry) ? "gone" : null,
      );
      this.#failed = null;
    } catch (error) {
      const message = String(error);
      if (this.#failed !== message) note(`squeal: could not read the command holds: ${message}`);
      this.#failed = message;
      return this.holding;
    }
    const last = read.left.length === 0 && !this.options.merging();
    for (const [i, ended] of read.ended.entries())
      note(endedNote(ended, last && i === read.ended.length - 1));
    this.#entries = read.left;
    this.#arm();
    return this.holding;
  }

  close(): void {
    this.#closed = true;
    this.#disarm();
  }

  /** One timer at the earliest `until`, none without an entry; unref'd, it never holds the process. */
  #arm(): void {
    this.#disarm();
    if (this.#entries.length === 0 || this.#closed) return;
    const until = Math.min(...this.#entries.map((e) => e.until));
    // A bound past a 32-bit timer's range fires early and reads again, which re-arms.
    const ms = Math.min(Math.max(0, until - this.options.now()), 2 ** 31 - 1);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.options.due();
    }, ms);
    this.#timer.unref();
  }

  #disarm(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }
}
