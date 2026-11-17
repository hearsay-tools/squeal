import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { AbsolutePath, EpochMs } from "../types/common.js";
import { storePaths } from "./paths.js";

/**
 * What found a fault (row 011-391): a start's open, the full check, a
 * daemon's read or write while it ran, or a hook's.
 */
export type FaultFinder = "start" | "full-check" | "daemon" | "hook";

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

const MARK_FINDERS: readonly FaultFinder[] = ["full-check", "daemon", "hook"];

/**
 * Row 011-226: marks the store as damaged (a failed full check; row 011-391,
 * a read or write that hit damage). Every daemon on the file it names exits
 * at its next heartbeat, and the next checked open moves that file aside.
 */
export function markStore(commonDir: AbsolutePath, mark: StoreMark): void {
  writeFileSync(markPath(storePaths(commonDir).database), JSON.stringify(mark));
}

/** The mark beside the store that names the file at its path now; `null` with none. */
export function readStoreMark(commonDir: AbsolutePath): StoreMark | null {
  return currentMark(storePaths(commonDir).database);
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
    // A mark cut short still marks the store.
  }
  return { at: 0, problem: "the full integrity check failed" };
}

function fileOf(value: unknown): MarkedFile | null {
  const { dev, ino } = (value ?? {}) as Partial<Record<keyof MarkedFile, unknown>>;
  return typeof dev === "number" && typeof ino === "number" ? { dev, ino } : null;
}
