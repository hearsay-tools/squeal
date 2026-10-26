import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blobHash, type ObjectFormat } from "../../hash/index.js";
import type { AbsolutePath, FileHash, RelativePath } from "../../types/index.js";
import { underModules } from "./keys.js";
import { lookupMoved } from "./state.js";

/** Where the worktree's files are on disk. */
export interface Disk {
  readonly root: AbsolutePath;
  readonly format: ObjectFormat;
}

/**
 * Spec 017 D4 and D5 (waves 1.6 and 1.7): the one owner of the key inputs
 * the listing does not hold, the config's closure, the files the worker
 * read and the program's files outside `node_modules`, `../` above the root
 * included. A generated or git-ignored file makes no revision, so each pass
 * reads them on disk before any lookup; their blobs are the ones the keys
 * hold. Whether the worker holds the same bytes is told by what it
 * reports, never by an earlier look (review 0.1.351 B2-R3).
 */
export class Unlisted {
  #blobs = new Map<RelativePath, FileHash | null>();

  constructor(private readonly disk: Disk) {}

  /** Reads on disk each of `paths` that `listed` does not hold. */
  read(paths: Iterable<RelativePath>, listed: (path: RelativePath) => boolean): void {
    const blobs = new Map<RelativePath, FileHash | null>();
    for (const path of paths) {
      if (blobs.has(path) || underModules(path) || listed(path)) continue;
      blobs.set(path, this.#read(path));
    }
    this.#blobs = blobs;
  }

  /** An unlisted input's blob at the last read, `null` when no file was there; `undefined` for any other path. */
  blobOf(path: RelativePath): FileHash | null | undefined {
    return this.#blobs.get(path);
  }

  /** Whether a path the walk's lookups read has left the state the walk saw (Q3). */
  movedFrom(lookups: ReadonlyMap<RelativePath, string>): boolean {
    for (const [path, record] of lookups) {
      if (lookupMoved(join(this.disk.root, path), record, this.disk.format)) return true;
    }
    return false;
  }

  #read(path: RelativePath): FileHash | null {
    try {
      return blobHash(readFileSync(join(this.disk.root, path)), this.disk.format) as FileHash;
    } catch {
      return null;
    }
  }
}
