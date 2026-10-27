import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { writeAtomic } from "../adapter/layout.js";
import { lockFile } from "./paths.js";

/*
 * Row 002-37 (spec 002 D8): one updater per data directory, protected by
 * an exclusive SQLite transaction. The OS releases it on process death.
 * The database path is permanent: never unlink or rename it, even after a
 * stale observation. The JSON record is only an owner hint for busy results;
 * its contents and age never decide exclusion or recovery.
 */

/** @deprecated Owner age no longer revokes a live lock. Kept for callers. */
export const STALE_LOCK_MS = 10 * 60_000;
const POLL_MS = 100;

export interface UpdateLock {
  /** Releases this connection's exclusion; safe to call more than once. */
  readonly release: () => void;
}

export type LockAttempt =
  | { readonly lock: UpdateLock }
  | { readonly busy: { readonly pid: number; readonly startedAt: number } };

export interface LockOptions {
  /** How long to wait for a live owner; 0 answers busy at once. */
  readonly waitMs?: number;
  readonly now?: () => number;
}

/** Polls at most `waitMs`; synchronous filesystem calls can exceed that budget. */
export async function acquireLock(data: string, options: LockOptions = {}): Promise<LockAttempt> {
  const now = options.now ?? Date.now;
  const until = performance.now() + (options.waitMs ?? 0);
  for (;;) {
    const attempt = tryLock(data, now);
    const remaining = until - performance.now();
    if ("lock" in attempt || remaining <= 0) return attempt;
    await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_MS, remaining)));
  }
}

function tryLock(data: string, now: () => number): LockAttempt {
  const path = lockFile(data);
  mkdirSync(dirname(path), { recursive: true });
  // A separate permanent file also avoids interpreting pre-repair JSON as SQLite.
  const db = new DatabaseSync(`${path}.sqlite`);
  try {
    db.exec("PRAGMA busy_timeout = 0");
    db.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    db.close();
    if (((error as { errcode?: number }).errcode ?? 0) % 256 !== 5) throw error;
    return { busy: ownerHint(path) };
  }
  try {
    writeAtomic(path, `${JSON.stringify({ schema: 1, pid: process.pid, startedAt: now() })}\n`);
  } catch (error) {
    db.close();
    throw error;
  }
  let released = false;
  return {
    lock: {
      release() {
        if (released) return;
        released = true;
        try {
          // Remove the hint while exclusion is still held, never a successor's.
          rmSync(path, { force: true });
        } finally {
          db.close();
        }
      },
    },
  };
}

/** Best effort only: the owner can release or die while this hint is read. */
function ownerHint(path: string): { pid: number; startedAt: number } {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as { pid?: number; startedAt?: number };
    if (
      Number.isInteger(value.pid) &&
      (value.pid ?? 0) > 0 &&
      typeof value.startedAt === "number" &&
      Number.isFinite(value.startedAt)
    ) {
      return { pid: value.pid as number, startedAt: value.startedAt };
    }
  } catch {
    // Missing, corrupt or stale metadata never permits a second owner.
  }
  return { pid: 0, startedAt: 0 };
}
