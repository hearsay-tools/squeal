import { type MarkOutcome, markUnder, type StoreMark } from "../store/mark.js";
import { isCorruption } from "../store/open.js";
import type { AbsolutePath, EpochMs } from "../types/common.js";
import { faultFound, type StoreFile, storeFileOf } from "./store-file.js";

/** How long a daemon's mark waits for the recovery lock: once, on its main thread. */
export const DAEMON_MARK_WAIT_MS = 1_000;

/** How long a hook's mark waits for it: only on the corruption path, inside the 2 s hook budget. */
export const HOOK_MARK_WAIT_MS = 200;

/**
 * Row 011-391: the one place a found fault is marked (`markUnder`). The mark
 * names `file`, the store file its finder opened (`StoreMark.file`), and is
 * written under the lock a move-aside holds, after a check that `file` is
 * still at the path and no mark names it (review of cand/0.1.545, B1). So a
 * start that moved that file aside and put a fresh store at the path never
 * finds the fresh one marked; and a mark that names another file, however
 * written, is ignored and removed by the next checked open. Nothing is
 * written without a file. Throws when the lock or the mark cannot be written.
 */
export function markFault(
  commonDir: AbsolutePath,
  file: StoreFile | null,
  mark: Omit<StoreMark, "file">,
  waitMs: number,
): MarkOutcome | null {
  return file === null ? null : markUnder(commonDir, file, mark, waitMs);
}

/** The problem a hook's mark names when the store did not open. */
export const OPEN_CORRUPT = "the store did not open: SQLite reports it corrupt or not a database";

/**
 * Row 011-391: a hook whose open, read or write of the main store met
 * corruption marks `file`, the file it opened (`markFault`, found by
 * `hook`). It never throws, and it waits only here, on the corruption
 * path, at most `HOOK_MARK_WAIT_MS` for the recovery lock: a store it cannot
 * mark (read-only, gone, the lock held) stays as it is, and the hook silent.
 */
export function markHookFault(
  commonDir: AbsolutePath,
  file: StoreFile | null,
  problem: string,
  now: () => EpochMs,
): void {
  try {
    markFault(commonDir, file, { at: now(), problem, found: "hook" }, HOOK_MARK_WAIT_MS);
  } catch {
    // Best effort: the store stays unmarked, and the hook silent.
  }
}

/** The store file at the path, or `null` when there is none or it cannot be read. */
export function storeFileOrNull(commonDir: AbsolutePath): StoreFile | null {
  try {
    return storeFileOf(commonDir);
  } catch {
    return null;
  }
}

export interface StoreFaultContext {
  readonly commonDir: AbsolutePath;
  /** The file the daemon's connection holds: the file its mark names. */
  readonly storeFile: StoreFile | null;
  readonly now: () => EpochMs;
  readonly log: (line: string) => void;
  /** Stops the daemon as `store-unusable`; its shutdown persists `text` as a note. */
  readonly stop: (text: string) => void;
}

/**
 * Row 011-391: the one place that classifies an error a daemon's store
 * read or write threw. On corruption (`isCorruption`) it marks the file the
 * daemon opened (`markFault`, found by `daemon`) and stops the daemon as
 * `store-unusable` with a note that says so, once; it returns true, and the
 * caller logs nothing more. Every other daemon on that file stops at its
 * next heartbeat (`storeCondemned`), and the next start moves it aside, as
 * after a failed full check (row 011-226).
 */
export function storeFaults(context: StoreFaultContext): (error: unknown) => boolean {
  let seen = false;
  return (error) => {
    if (!isCorruption(error)) return false;
    if (seen) return true;
    seen = true;
    const mark: StoreMark = { at: context.now(), problem: String(error), found: "daemon" };
    try {
      const outcome = markFault(context.commonDir, context.storeFile, mark, DAEMON_MARK_WAIT_MS);
      if (outcome === "busy")
        context.log("could not mark the store: the recovery lock stayed held");
    } catch (markError) {
      context.log(`could not mark the store: ${String(markError)}`);
    }
    context.stop(
      `daemon stopped: ${faultFound(mark)}; every daemon on this store stops at its next ` +
        "heartbeat, and the next start moves the store aside and starts a fresh one, so the " +
        "stored results are lost",
    );
    return true;
  };
}

/**
 * `call`, with each error it throws, or its promise rejects with, shown to
 * `seen` (`storeFaults`) before it goes on: for a request handler of the
 * main store, whose error stays the request's answer.
 */
export function watched<A extends unknown[], T>(
  seen: (error: unknown) => boolean,
  call: (...args: A) => T,
): (...args: A) => T {
  const shown = (error: unknown) => {
    seen(error);
    throw error;
  };
  return (...args) => {
    let result: T;
    try {
      result = call(...args);
    } catch (error) {
      return shown(error);
    }
    return result instanceof Promise ? (result.catch(shown) as T) : result;
  };
}
