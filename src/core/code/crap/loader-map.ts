import { testFileId } from "../../keys/reverse-index.js";
import type { RelativePath } from "../../types/common.js";
import type { TestFileRef } from "../../types/keys.js";
import type { Loader, LoaderCondition } from "./loaders.js";

/*
 * Row 021-31 (spec 021 D21.4): each source's loaders, kept across reads.
 * A read places every listed test file again; one whose closure and
 * condition stay touches nothing, so a read after one stored record moves
 * only the sources that record's test file loads. Before, each read built
 * the map anew over every closure path: 41% of a busy daemon's allocation
 * (`research/daemon-heap.md` Q1).
 */

/** A listed test file's loader; a read changes its condition in place. */
class Slot implements Loader {
  constructor(
    readonly testFile: TestFileRef,
    public condition: LoaderCondition,
    /** Its closure's paths; `undefined` while its closure is not known here: it loads every source. */
    public paths: readonly RelativePath[] | undefined,
    /** Its project's environment files, when that environment runs in each test file's process. */
    public files: readonly RelativePath[] | undefined,
    /** The read that placed it last. */
    public read: number,
  ) {}
}

export class LoaderMap {
  readonly #slots = new Map<string, Slot>();
  readonly #byPath = new Map<RelativePath, Slot[]>();
  /** Test files whose closure is not known here: each is a loader of every source. */
  readonly #everywhere: Slot[] = [];
  #read = 0;
  #listed: boolean | null = null;
  /** The sources whose loaders changed since `moved` was last called; `"all"`, any may have. */
  #moved: Set<RelativePath> | "all" = "all";

  /** Starts a read: a test file not placed before its `end` leaves the map. */
  begin(): void {
    this.#read++;
  }

  /**
   * One listed test file with its condition, the paths of its closure
   * (`undefined`: not known here) and its in-process environment's files.
   */
  place(
    testFile: TestFileRef,
    condition: LoaderCondition,
    paths: readonly RelativePath[] | undefined,
    files: readonly RelativePath[] | undefined,
  ): void {
    const id = testFileId(testFile);
    const slot = this.#slots.get(id);
    if (slot === undefined) {
      const added = new Slot(testFile, condition, paths, files, this.#read);
      this.#slots.set(id, added);
      this.#spread(added, true);
      return;
    }
    slot.read = this.#read;
    const spread =
      (paths === undefined) === (slot.paths === undefined) &&
      samePaths(slot.paths, paths) &&
      samePaths(slot.files, files);
    const moved = !sameCondition(slot.condition, condition);
    if (!spread) this.#spread(slot, false);
    slot.condition = condition;
    slot.paths = paths;
    slot.files = files;
    if (!spread) this.#spread(slot, true);
    else if (moved) this.#touch(slot);
  }

  /** Ends a read of `listed` test files: those it did not place leave the map. */
  end(listed: boolean): void {
    for (const [id, slot] of this.#slots) {
      if (slot.read === this.#read) continue;
      this.#spread(slot, false);
      this.#slots.delete(id);
    }
    // No source can be judged before the worktree has test files listed.
    if (listed !== this.#listed) this.#moved = "all";
    this.#listed = listed;
  }

  /** The loaders of `path`: its own, then those of every source; valid until the next read. */
  of(path: RelativePath): readonly Loader[] {
    const own = this.#byPath.get(path) ?? [];
    return this.#everywhere.length === 0 ? own : [...own, ...this.#everywhere];
  }

  get withoutImports(): number {
    return this.#everywhere.length;
  }

  /** The sources whose loaders changed since the last call; `"all"`, any may have. */
  moved(): ReadonlySet<RelativePath> | "all" {
    const moved = this.#moved;
    this.#moved = new Set();
    return moved;
  }

  /**
   * Adds `slot` to the lists of the sources it loads (`into`), or takes it
   * out of them; either way they moved. A slot with no closure is in every
   * source's list, so every source moved.
   */
  #spread(slot: Slot, into: boolean): void {
    if (slot.paths === undefined) {
      const at = this.#everywhere.indexOf(slot);
      if (into && at === -1) this.#everywhere.push(slot);
      if (!into && at !== -1) this.#everywhere.splice(at, 1);
      this.#moved = "all";
      return;
    }
    for (const path of sourcesOf(slot.paths, slot.files)) {
      if (this.#moved !== "all") this.#moved.add(path);
      const list = this.#byPath.get(path);
      if (into) {
        if (list === undefined) this.#byPath.set(path, [slot]);
        else list.push(slot);
        continue;
      }
      const at = list?.indexOf(slot) ?? -1;
      if (list === undefined || at === -1) continue;
      if (list.length === 1) this.#byPath.delete(path);
      else list.splice(at, 1);
    }
  }

  /** The sources `slot` loads moved: its condition changed. */
  #touch(slot: Slot): void {
    if (this.#moved === "all") return;
    if (slot.paths === undefined) {
      this.#moved = "all";
      return;
    }
    for (const path of sourcesOf(slot.paths, slot.files)) this.#moved.add(path);
  }
}

/**
 * The sources a loader loads. Spec 020 D11.6: a test file is its own
 * loader; its closure holds it, and its record measures it. Rows 015-75 and
 * 015-86: an environment that runs in each test file's process is loaded by each.
 */
function sourcesOf(
  paths: readonly RelativePath[],
  files: readonly RelativePath[] | undefined,
): Iterable<RelativePath> {
  return files === undefined ? paths : new Set([...paths, ...files]);
}

/** The same paths in the same order; the same array is the common case. */
function samePaths(
  a: readonly RelativePath[] | undefined,
  b: readonly RelativePath[] | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * What a source's condition reads of a loader's (`fileCondition`): all of
 * it but a pending one's `until`, which only the read's `wakeAt` takes.
 * A record waited for while the writer is busy moves its `until` at each read.
 */
function sameCondition(a: LoaderCondition, b: LoaderCondition): boolean {
  if (a === b) return true;
  switch (a.kind) {
    case "ready":
      return b.kind === "ready" && a.key === b.key && a.storedAt === b.storedAt;
    case "pending":
      return b.kind === "pending" && a.reason === b.reason;
    case "unknown":
      return b.kind === "unknown" && a.cause === b.cause && a.runner === b.runner;
  }
}
