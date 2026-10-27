import { randomUUID } from "node:crypto";
import { linkSync, readFileSync, renameSync, rmSync } from "node:fs";
import { createExclusive } from "../adapter/layout.js";
import { lockFile } from "./paths.js";

/*
 * Row 002-34 (spec 002 D8): one updater per data directory. The lock is a
 * file created whole and exclusively, naming its owner. A competing updater
 * gets `busy` at once or after a bounded wait, never an unbounded one. A
 * lock whose owner is dead, whose record is unreadable, or which is older
 * than any update can take is broken: renamed aside, checked to be the one
 * judged stale, then removed.
 */

/** Past this a live owner's lock is stale too, as when its pid was reused. */
export const STALE_LOCK_MS = 10 * 60_000;
const POLL_MS = 100;

interface LockRecord {
  readonly schema: 1;
  readonly pid: number;
  readonly startedAt: number;
  readonly token: string;
}

export interface UpdateLock {
  /** Removes the lock while it is still this owner's. */
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

/** Takes the updater lock of `data`, waiting at most `waitMs` for its owner. */
export async function acquireLock(data: string, options: LockOptions = {}): Promise<LockAttempt> {
  const now = options.now ?? Date.now;
  const until = Date.now() + (options.waitMs ?? 0);
  for (;;) {
    const attempt = tryLock(data, now);
    if ("lock" in attempt || Date.now() >= until) return attempt;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

function tryLock(data: string, now: () => number): LockAttempt {
  const path = lockFile(data);
  const record: LockRecord = { schema: 1, pid: process.pid, startedAt: now(), token: randomUUID() };
  const text = `${JSON.stringify(record)}\n`;
  let held: { text: string; record: LockRecord | null } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (createExclusive(path, text)) return { lock: { release: () => release(path, text) } };
    held = read(path);
    if (held === null) continue;
    const owner = held.record;
    if (owner !== null && alive(owner.pid) && now() - owner.startedAt < STALE_LOCK_MS) {
      return { busy: { pid: owner.pid, startedAt: owner.startedAt } };
    }
    breakLock(path, held.text);
  }
  return { busy: { pid: held?.record?.pid ?? 0, startedAt: held?.record?.startedAt ?? 0 } };
}

function read(path: string): { text: string; record: LockRecord | null } | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  try {
    const value = JSON.parse(text) as Partial<LockRecord>;
    return value.schema === 1 &&
      Number.isInteger(value.pid) &&
      (value.pid ?? 0) > 0 &&
      typeof value.startedAt === "number" &&
      typeof value.token === "string"
      ? { text, record: value as LockRecord }
      : { text, record: null };
  } catch {
    return { text, record: null };
  }
}

/**
 * Removes the stale lock whose content is `stale`. Another updater may have
 * broken it and taken a fresh one between the read and the rename: that
 * lock is put back, unless a third took the place meanwhile.
 */
function breakLock(path: string, stale: string): void {
  const aside = `${path}.${process.pid}.${randomUUID()}.stale`;
  try {
    renameSync(path, aside);
  } catch {
    return;
  }
  try {
    if (readFileSync(aside, "utf8") !== stale) linkSync(aside, path);
  } catch {
    // A third updater holds the lock now; the displaced one finds out at release.
  } finally {
    rmSync(aside, { force: true });
  }
}

function release(path: string, text: string): void {
  try {
    if (readFileSync(path, "utf8") === text) rmSync(path, { force: true });
  } catch {
    // Broken as stale by another updater, or gone.
  }
}

/** Whether `pid` runs; one this user may not signal runs too. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
