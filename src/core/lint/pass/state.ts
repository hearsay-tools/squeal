import {
  type Dirent,
  readdirSync,
  readFileSync,
  readlinkSync,
  type Stats,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { blobHash, type ObjectFormat } from "../../hash/blob.js";

/*
 * Wave 1.7 Q3: the state of a path the program walk's lookups read, as the
 * walk records it and as the pass reads it again before any lookup. A
 * folder's entries or a file's bytes decide; its stat tells quickly that
 * neither moved, unless it was too recent to tell a later change apart.
 */

/** A path's mtime and ctime, size and inode; `missing` when absent. */
export function pathState(path: string): string {
  const stat = statSync(path, { throwIfNoEntry: false });
  return stat === undefined ? "missing" : written(stat);
}

export function written(stat: Stats): string {
  return `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}:${stat.ino}`;
}

/** A folder's entries as names, kinds and link targets; `null` when `path` is no folder. */
export function folderEntries(path: string): string | null {
  let entries: Dirent[];
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    return null;
  }
  return entries
    .map((e) => {
      if (e.isSymbolicLink()) return `l ${e.name} ${linkOf(join(path, e.name))}`;
      return `${e.isDirectory() ? "d" : "f"} ${e.name}`;
    })
    .sort()
    .join("\n");
}

function linkOf(path: string): string {
  try {
    return readlinkSync(path);
  } catch {
    return "";
  }
}

/**
 * A lookup's record: the path's state, `racy` when too recent, then what
 * the lookup read: a folder's entries, `#` and the blob of a file it read,
 * or nothing.
 */
export function lookupRecord(state: string, read: string): string {
  return `${state.startsWith("racy") ? "racy" : state}\n${read}`;
}

/** Whether `path` left its `record`: the same state is no move; else what was read is read again. */
export function lookupMoved(path: string, record: string, format: ObjectFormat): boolean {
  const at = record.indexOf("\n");
  const state = record.slice(0, at);
  const read = record.slice(at + 1);
  const now = pathState(path);
  if (now === state) return false;
  if (now === "missing" || state === "missing" || read === "") return true;
  if (!read.startsWith("#")) return folderEntries(path) !== read;
  try {
    return `#${blobHash(readFileSync(path), format)}` !== read;
  } catch {
    return true;
  }
}
