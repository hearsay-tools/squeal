import { compare } from "../fs/index.js";
import { testFileId } from "../keys/index.js";
import type { RelativePath, TestFileRef } from "../types/index.js";
import type { FileState } from "./files.js";

/**
 * Run order of queued test files, most urgent first.
 *
 * Spec 001 D5 step 4: "checks whose last known state is `fail` (including
 * inherited failures), then test files directly importing a changed path,
 * then transitively affected files, then never-run files". A v1 closure has
 * no direct-import edges, so `direct` is a test file that itself changed.
 */
export const Priority = { failing: 0, direct: 1, affected: 2, neverRun: 3 } as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

export function priorityOf(file: FileState, changed: ReadonlySet<RelativePath>): Priority {
  if (file.failing) return Priority.failing;
  if (changed.has(file.ref.path)) return Priority.direct;
  return file.resultKey === null ? Priority.neverRun : Priority.affected;
}

interface Entry {
  readonly ref: TestFileRef;
  priority: Priority;
  readonly seq: number;
  forced: boolean;
}

/**
 * Test files waiting for a tier, one entry each. Re-planning between tiers
 * (D5 step 5) is `ordered()` on the queue as the latest revision left it.
 */
export class RunQueue {
  readonly #entries = new Map<string, Entry>();
  #seq = 0;

  get size(): number {
    return this.#entries.size;
  }

  has(ref: TestFileRef): boolean {
    return this.#entries.has(testFileId(ref));
  }

  /**
   * Queues a test file, or raises the priority of its entry. A `forced` entry
   * (`run --all --force`) runs even when its key has a result.
   */
  add(ref: TestFileRef, priority: Priority, forced = false): void {
    const id = testFileId(ref);
    const entry = this.#entries.get(id);
    if (entry) {
      entry.priority = Math.min(entry.priority, priority) as Priority;
      entry.forced ||= forced;
      return;
    }
    this.#entries.set(id, { ref, priority, seq: this.#seq++, forced });
  }

  remove(ref: TestFileRef): boolean {
    return this.#entries.delete(testFileId(ref));
  }

  isForced(ref: TestFileRef): boolean {
    return this.#entries.get(testFileId(ref))?.forced ?? false;
  }

  /** Priority, then first queued, then project and path. */
  ordered(): TestFileRef[] {
    return [...this.#entries.values()]
      .sort(
        (a, b) =>
          a.priority - b.priority ||
          a.seq - b.seq ||
          compare(a.ref.project, b.ref.project) ||
          compare(a.ref.path, b.ref.path),
      )
      .map((entry) => entry.ref);
  }
}
