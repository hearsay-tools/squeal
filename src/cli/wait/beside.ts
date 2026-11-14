import { withStatusStore } from "../../core/status/open.js";
import type { AbsolutePath } from "../../core/types/common.js";
import type { Store } from "../../core/types/store.js";
import { readBound } from "./presence.js";
import { unavailableText } from "./reads.js";

/*
 * Row 011-334 (review 0.1.474 N1): the reads beside the run waits (`run.ts`
 * `filesText`, `joinedCheckpoint`, `owedText`; `group-pending.ts`) read the
 * worktree's store with the run waits' busy-store rule (row 011-327): one
 * read through `withStatusStore`, a busy store tried again within a bound;
 * a store still not read gives why, for a line in place of the part, never
 * a "database is locked" stack.
 */

/** A read beside a run wait: its value, or why the store was not read (`unavailableText`). */
export type Beside<T> = { readonly read: T } | { readonly unread: string };

/**
 * `read` in one read transaction of the worktree's store at `root`. A busy
 * store is tried again for at most `busyTimeoutMs`, as `withStatusStore`
 * bounds it; a store busy past it, or that does not open, is `unread`.
 */
export function readBeside<T>(
  root: AbsolutePath,
  busyTimeoutMs: number,
  read: (store: Store) => T,
): Beside<T> {
  const result = withStatusStore(root, { busyTimeoutMs }, ({ store }) => ({ read: read(store) }));
  return "available" in result ? { unread: unavailableText(result) } : result;
}

/**
 * The busy bound of a read beside a run wait with `deadline` (epoch ms;
 * `Infinity` without `--wait` or for a bare `--wait`), as `readBound` bounds
 * a wait's read: what is left, at least 50 ms, at most the status busy
 * timeout; past the deadline, the full timeout.
 */
export function besideBound(deadline: number, now: () => number = Date.now): number {
  return readBound(deadline, now).busyTimeoutMs;
}

/** A part not read, in place of the part: `<what> was not read (<why>)`. */
export function notReadText(what: string, unread: string): string {
  return `${what} was not read (${unread})`;
}
