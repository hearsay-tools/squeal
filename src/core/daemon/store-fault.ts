import { isCorruption, markStore, readStoreMark, type StoreMark } from "../store/open.js";
import type { AbsolutePath, EpochMs } from "../types/common.js";
import { faultFound, type StoreFile, sameFile, storeFileOf } from "./store-file.js";

export interface StoreFaultContext {
  readonly commonDir: AbsolutePath;
  /** The file the daemon's connection holds; a mark goes beside it only while it is the one at the path. */
  readonly storeFile: StoreFile | null;
  readonly now: () => EpochMs;
  readonly log: (line: string) => void;
  /** Stops the daemon as `store-unusable`; its shutdown persists `text` as a note. */
  readonly stop: (text: string) => void;
}

/**
 * Row 011-391: the one place that classifies an error a daemon's store
 * read or write threw. On corruption (`isCorruption`) it marks the store
 * (`markStore`, found by `daemon`) and stops the daemon as `store-unusable`
 * with a note that says so, once; it returns true, and the caller logs
 * nothing more.
 * Every other daemon on the store stops at its next heartbeat
 * (`storeCondemned`), and the next start moves the store aside, as after a
 * failed full check (row 011-226).
 *
 * No mark is written over one already there, nor beside a file that is not
 * the one this daemon opened: a start moved that one aside, and this
 * daemon's heartbeat stops it.
 */
export function storeFaults(context: StoreFaultContext): (error: unknown) => boolean {
  let seen = false;
  return (error) => {
    if (!isCorruption(error)) return false;
    if (seen) return true;
    seen = true;
    const mark: StoreMark = { at: context.now(), problem: String(error), found: "daemon" };
    try {
      if (readStoreMark(context.commonDir) === null && ownFile(context)) {
        markStore(context.commonDir, mark);
      }
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

function ownFile(context: StoreFaultContext): boolean {
  if (context.storeFile === null) return false;
  const now = storeFileOf(context.commonDir);
  return now !== null && sameFile(now, context.storeFile);
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
