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

/**
 * The holders and waiters of the write lock of the SQLite database at
 * `databasePath`, holders first. `undefined` where the platform has no source
 * for them (anything but Linux) or the source cannot be read. Never opens the
 * database and never throws.
 */
export function lockHolders(databasePath: string): readonly LockHolder[] | undefined {
  return databasePath.length > 0 ? undefined : undefined;
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
