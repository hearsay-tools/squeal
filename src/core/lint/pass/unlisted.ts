import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blobHash, type ObjectFormat } from "../../hash/index.js";
import type { AbsolutePath, FileHash, RelativePath } from "../../types/index.js";
import { underModules } from "./keys.js";
import type { LintSnapshot } from "./provider.js";

/** Where the worktree's files are on disk. */
export interface Disk {
  readonly root: AbsolutePath;
  readonly format: ObjectFormat;
}

/** What moved since the last look, by what it refreshes (D4). */
export interface Moved {
  /** Config and closure files whose bytes moved: each refreshes as a listed one does. */
  readonly loaded: readonly RelativePath[];
  /** Program files whose bytes moved: the program is read again, and each is fed. */
  readonly program: readonly RelativePath[];
  /** Program files gone: the worker's TypeScript service keeps what it read, so a new thread. */
  readonly deleted: readonly RelativePath[];
}

/**
 * Spec 017 D4 and D5 (wave 1.6, review 0.1.348-r2 B2-R and B3-R): the one
 * owner of the key inputs the listing does not hold, the config and
 * closure files and the program's files outside `node_modules`. A
 * generated or git-ignored file makes no revision, so each pass reads them
 * on disk before any lookup. Their blobs are the ones the keys hold; one
 * that moved since the last look refreshes the worker. A file first seen
 * is only recorded: the worker read it a moment before.
 */
export class Unlisted {
  readonly #seen = new Map<RelativePath, FileHash | null>();
  #current = new Set<RelativePath>();

  constructor(private readonly disk: Disk) {}

  /**
   * Reads `snapshot`'s inputs that `listed` does not hold. A path of
   * `changed`, the revisions since the last keying, that left the listing
   * counts as moved at first sight: the worker read it while it was listed.
   */
  look(
    snapshot: LintSnapshot,
    listed: (path: RelativePath) => boolean,
    changed: ReadonlySet<RelativePath>,
  ): Moved {
    const loaded = new Set([...snapshot.declaration.configFiles, ...snapshot.closure]);
    const moved = {
      loaded: [] as RelativePath[],
      program: [] as RelativePath[],
      deleted: [] as RelativePath[],
    };
    this.#current = new Set();
    for (const path of new Set([...loaded, ...snapshot.program])) {
      if (underModules(path) || listed(path)) continue;
      const blob = this.#read(path);
      const before = this.#seen.get(path);
      this.#seen.set(path, blob);
      this.#current.add(path);
      if (before === undefined ? !changed.has(path) : before === blob) continue;
      if (loaded.has(path)) moved.loaded.push(path);
      else (blob === null ? moved.deleted : moved.program).push(path);
    }
    return moved;
  }

  /** An unlisted input's blob at the last look, `null` when no file was there; `undefined` for any other path. */
  blobOf(path: RelativePath): FileHash | null | undefined {
    return this.#current.has(path) ? (this.#seen.get(path) ?? null) : undefined;
  }

  /** A new provider reads every file from disk: what the last one read is not kept. */
  forget(): void {
    this.#seen.clear();
    this.#current = new Set();
  }

  #read(path: RelativePath): FileHash | null {
    try {
      return blobHash(readFileSync(join(this.disk.root, path)), this.disk.format) as FileHash;
    } catch {
      return null;
    }
  }
}
