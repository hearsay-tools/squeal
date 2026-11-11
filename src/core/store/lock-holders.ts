import { existsSync } from "node:fs";
import { basename } from "node:path";
import { createProcSource } from "../ps/proc.js";
import type { LockEntry, PsSource } from "../ps/source.js";

/**
 * Spec 021 D5: the processes that hold or wait for a store's write lock, named
 * without opening the database.
 *
 * Contract file for rows 021-07 and 021-10 (wave 1). Row 021-10 implements it
 * from `/proc/locks` (SQLite's unix VFS takes the WAL write lock as a POSIX
 * lock on byte 120 of the `-shm` file); row 021-07 names the holder in its
 * busy messages through `describeHolders`.
 */

/** One process that holds, or waits for, the write lock. */
export interface LockHolder {
  readonly pid: number;
  /** The process's command line, shortened for one message line. */
  readonly command: string;
  /** True for a process blocked waiting for the lock, false for the holder. */
  readonly waiting: boolean;
}

/** What `holdersFrom` reads: `/proc/locks`, a file's lock key and a command line. */
export type HolderSource = Pick<PsSource, "locks" | "fileKey" | "cmdline">;

/** `UNIX_SHM_BASE` of `os_unix.c`, (22 + 8) * 4: the byte of `-shm` that is the WAL write lock. */
const WRITE_LOCK_BYTE = 120;
/** A command longer than this is cut, so a busy message stays one line. */
const COMMAND_CHARS = 160;
/** What a holder whose command line cannot be read, or that has exited, is called. */
const NO_COMMAND = "command unknown";

/**
 * The holders and waiters of the write lock of the SQLite database at
 * `databasePath`, holders first. `undefined` where the platform has no source
 * for them (anything but Linux) or the source cannot be read. Never opens the
 * database and never throws.
 */
export function lockHolders(databasePath: string): readonly LockHolder[] | undefined {
  return process.platform === "linux" ? holdersFrom(createProcSource(), databasePath) : undefined;
}

/**
 * `lockHolders` over `source`. A database without a `-shm` file has no
 * holder: nobody has it open in WAL mode. One read of `/proc/locks` returns
 * a page at a time, so a lock that changes place between two pages can be
 * missed (014 `lessons.md` P9); a busy message then says the holder is not
 * known.
 */
export function holdersFrom(
  source: HolderSource,
  databasePath: string,
): readonly LockHolder[] | undefined {
  try {
    const shm = `${databasePath}-shm`;
    const key = source.fileKey(shm);
    if (key === null) return existsSync(shm) ? undefined : [];
    const locks = source.locks();
    if (locks === null) return undefined;
    const entries = onWriteLock(locks, key);
    const held = entries.filter((e) => !e.blocked && e.access === "write");
    const waiting = entries.filter((e) => e.blocked);
    return [...named(source, held, false), ...named(source, waiting, true)];
  } catch {
    // A source reads as absent rather than throw; this is the contract's guard if one does.
    return undefined;
  }
}

/**
 * The POSIX locks of process-owned ranges that cover the write-lock byte of
 * the file `key` names. The device part of the key is matched when any entry
 * has it, and only the inode when none does: on overlayfs and btrfs
 * subvolumes, `stat` and `/proc/locks` can give different devices.
 */
function onWriteLock(locks: readonly LockEntry[], key: string): readonly LockEntry[] {
  const inode = inodeOf(key);
  const onByte = locks.filter(
    (e) =>
      e.kind === "POSIX" &&
      e.pid !== null &&
      e.start !== undefined &&
      e.start <= WRITE_LOCK_BYTE &&
      (e.end === null || (e.end !== undefined && e.end >= WRITE_LOCK_BYTE)) &&
      inodeOf(e.file) === inode,
  );
  const exact = onByte.filter((e) => e.file === key);
  return exact.length > 0 ? exact : onByte;
}

function inodeOf(key: string): string {
  return key.slice(key.lastIndexOf(":") + 1);
}

function named(
  source: HolderSource,
  entries: readonly LockEntry[],
  waiting: boolean,
): readonly LockHolder[] {
  const holders: LockHolder[] = [];
  for (const { pid } of entries) {
    if (pid === null || holders.some((h) => h.pid === pid)) continue;
    const args = source.cmdline(pid);
    holders.push({ pid, command: args === null ? NO_COMMAND : shortCommand(args), waiting });
  }
  return holders;
}

/**
 * The arguments joined on one line, with the program and each script path
 * cut to its base name, every run of white space (line breaks of an inline
 * script included) read as one space, at most `COMMAND_CHARS` long. A daemon's first argument is its
 * process title (`squeal <project> daemon @<id>`), which is kept as it is.
 */
export function shortCommand(args: readonly string[]): string {
  const words = args.map((arg, at) =>
    arg.startsWith("/") && (at === 0 || /\.[cm]?[jt]s$/.test(arg)) ? basename(arg) : arg,
  );
  const line = words.join(" ").replace(/\s+/g, " ").trim();
  if (line === "") return NO_COMMAND;
  return line.length > COMMAND_CHARS ? `${line.slice(0, COMMAND_CHARS - 3)}...` : line;
}

/**
 * One clause naming the holder for a busy message, for example
 * `held by pid 4242 (squeal daemon /work/a)`, or `the holder is not known`
 * when `holders` is `undefined` or names no holder.
 */
export function describeHolders(holders: readonly LockHolder[] | undefined): string {
  const holder = holders?.find((entry) => !entry.waiting);
  return holder === undefined
    ? "the holder is not known"
    : `held by pid ${holder.pid} (${holder.command})`;
}
