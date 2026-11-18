import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AbsolutePath, EpochMs } from "../types/common.js";
import { rollback } from "./connection.js";
import { storePaths } from "./paths.js";

/**
 * What found a fault (row 011-391): a start's open, the full check, a
 * daemon's read or write while it ran, or a hook's. `unknown` (row 011-392
 * d): a mark cut short, whose finder could not be read.
 */
export type FaultFinder = "start" | "full-check" | "daemon" | "hook" | "unknown";

/** A store file, by device and inode. */
export interface MarkedFile {
  readonly dev: number;
  readonly ino: number;
}

/** What a found fault left beside the store: when, what, what found it, and in which file. */
export interface StoreMark {
  readonly at: EpochMs;
  readonly problem: string;
  /** Absent in a mark written before row 011-391: the full check wrote it. */
  readonly found?: FaultFinder;
  /**
   * The file its writer opened and found damaged (row 011-391, review of
   * cand/0.1.545). A mark beside another file condemns nothing: a start
   * moved the damaged one aside after its writer opened it. Absent in a mark
   * written before: it names the file at the path.
   */
  readonly file?: MarkedFile;
}

/**
 * The finders a parsed mark keeps. Review 0.1.559 S1: a mark that says `unknown` reads as a mark
 * cut short does, never as the full check's; a mark with no finder, or another, stays the full
 * check's (written before row 011-391).
 */
const MARK_FINDERS: readonly FaultFinder[] = ["full-check", "daemon", "hook", "unknown"];

/** The mark beside the store that names the file at its path now; `null` with none. */
export function readStoreMark(commonDir: AbsolutePath): StoreMark | null {
  return currentMark(storePaths(commonDir).database);
}

/** The lock a move-aside holds (`recover` in `open.ts`); a mark is written under it too. */
export const RECOVERY_LOCK = "store-recovery.sqlite";

/**
 * What `markUnder` did: wrote the mark; kept a mark that names the file
 * already there; wrote nothing because another file is at the path (a start
 * moved `file` aside); or wrote nothing because the lock stayed held.
 */
export type MarkOutcome = "marked" | "kept" | "replaced" | "busy";

/**
 * Row 011-391 (review of cand/0.1.545, B1): marks `file`, under the lock a
 * move-aside holds (`RECOVERY_LOCK`, `BEGIN EXCLUSIVE`), waiting for it at
 * most `waitMs`. Under the lock it checks that `file` is still the one at
 * the path and that no mark names it, then writes the mark naming it: a
 * move-aside never runs between the check and the write. The first mark is
 * kept. Throws when the lock or the mark cannot be written.
 */
export function markUnder(
  commonDir: AbsolutePath,
  file: MarkedFile,
  mark: Omit<StoreMark, "file">,
  waitMs: number,
): MarkOutcome {
  const paths = storePaths(commonDir);
  mkdirSync(paths.locksDir, { recursive: true });
  const lock = new DatabaseSync(join(paths.locksDir, RECOVERY_LOCK));
  try {
    lock.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.round(waitMs))}`);
    try {
      lock.exec("BEGIN EXCLUSIVE");
    } catch (error) {
      if ([5, 6].includes(((error as { errcode?: number }).errcode ?? 0) & 0xff)) return "busy";
      throw error;
    }
    const at = statSync(paths.database, { throwIfNoEntry: false });
    if (at === undefined || at.dev !== file.dev || at.ino !== file.ino) return "replaced";
    dropStaleMark(paths.database);
    if (currentMark(paths.database) !== null) return "kept";
    const named = { ...mark, file: { dev: file.dev, ino: file.ino } };
    writeFileSync(markPath(paths.database), JSON.stringify(named), { flag: "wx" });
    return "marked";
  } finally {
    rollback(lock);
    lock.close();
  }
}

export function markPath(database: string): string {
  return `${database}.check-failed`;
}

/** The mark beside `database`, unless it names another file than the one at the path. */
export function currentMark(database: string): StoreMark | null {
  const mark = readMark(markPath(database));
  return mark === null || names(mark, database) ? mark : null;
}

/**
 * Removes a mark that names another file than the one at `database`: the
 * fault was in a store a start has moved aside. It is renamed away before it
 * is read again, so a mark written meanwhile for the file at the path is put
 * back, unless yet another mark took its place.
 */
export function dropStaleMark(database: string): void {
  const path = markPath(database);
  const mark = readMark(path);
  if (mark === null || names(mark, database)) return;
  const aside = `${path}.stale-${randomUUID()}`;
  try {
    renameSync(path, aside);
  } catch {
    return;
  }
  const moved = readMark(aside);
  if (moved !== null && names(moved, database) && !existsSync(path)) renameSync(aside, path);
  else rmSync(aside, { force: true });
}

function names(mark: StoreMark, database: string): boolean {
  if (mark.file === undefined) return true;
  const stat = statSync(database, { throwIfNoEntry: false });
  return stat !== undefined && stat.dev === mark.file.dev && stat.ino === mark.file.ino;
}

function readMark(path: string): StoreMark | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    const { at, problem, found, file } = JSON.parse(text) as Partial<
      Record<keyof StoreMark, unknown>
    >;
    if (typeof at === "number" && typeof problem === "string") {
      const finder = MARK_FINDERS.find((known) => known === found);
      const named = fileOf(file);
      return {
        at,
        problem,
        ...(finder === undefined ? {} : { found: finder }),
        ...(named === null ? {} : { file: named }),
      };
    }
  } catch {
    // A mark cut short still marks the store; what found its fault is unknown (row 011-392 d).
  }
  return { at: 0, problem: "the mark beside the store could not be read", found: "unknown" };
}

function fileOf(value: unknown): MarkedFile | null {
  const { dev, ino } = (value ?? {}) as Partial<Record<keyof MarkedFile, unknown>>;
  return typeof dev === "number" && typeof ino === "number" ? { dev, ino } : null;
}
