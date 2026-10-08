import { compare } from "../fs/index.js";
import { testFileId } from "../keys/index.js";
import type { RelativePath, TestFileRef } from "../types/index.js";
import type { FileState } from "./files.js";

/**
 * Run order of queued test files, most urgent first.
 *
 * Spec 001 D5 step 4: "checks whose last known state is `fail` (including
 * inherited failures), then test files that import a changed path directly
 * according to the runner's module graph, then transitively affected files,
 * then never-run files". `direct` is a test file that itself changed or that
 * the runner reported as a direct importer (`AffectedTestFiles.direct`).
 */
export const Priority = { failing: 0, direct: 1, transitive: 2, neverRun: 3 } as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

const NO_DIRECT_IMPORTERS: ReadonlySet<string> = new Set();

/**
 * The starvation bound (task 001-107, review wave 11 N3; D5 step 4 as
 * amended): after this many tiers in a row of recent work only while the
 * backlog waited, the next tier is the backlog's. Recent work keeps at least
 * four tiers in five while edits keep coming; the backlog moves by one tier
 * in five.
 */
export const RECENT_TIERS_PER_BACKLOG_TIER = 4;

/**
 * The class of a file at a revision that changed `changed`. `direct` holds the
 * `testFileId`s of the runner's direct importers; a revision whose runner part
 * has not run yet has none, and the runner part raises them (`RunQueue.add`).
 */
export function priorityOf(
  file: FileState,
  changed: ReadonlySet<RelativePath>,
  direct: ReadonlySet<string> = NO_DIRECT_IMPORTERS,
): Priority {
  if (file.failing) return Priority.failing;
  if (changed.has(file.ref.path) || direct.has(file.id)) return Priority.direct;
  return file.resultKey === null ? Priority.neverRun : Priority.transitive;
}

/** Last known run time of a test file in milliseconds; `null` when unknown. */
export type DurationOf = (ref: TestFileRef) => number | null;

interface Entry {
  readonly ref: TestFileRef;
  priority: Priority;
  readonly seq: number;
  forced: boolean;
  /** Queued by a revision's edit: its closure changed or it was added (`Ledger.settle`). */
  recent: boolean;
}

/**
 * Test files waiting for a tier, one entry each. Re-planning between tiers
 * (D5 step 5) is `ordered()` on the queue as the latest revision left it.
 */
export class RunQueue {
  readonly #entries = new Map<string, Entry>();
  #seq = 0;
  /** Tiers in a row that took recent entries only while others waited. */
  #recentTiers = 0;

  get size(): number {
    return this.#entries.size;
  }

  has(ref: TestFileRef): boolean {
    return this.#entries.has(testFileId(ref));
  }

  /**
   * Queues a test file, or raises the priority of its entry. A `forced` entry
   * (`run --all --force`) runs even when its key has a result. A `recent`
   * entry stays recent until it leaves the queue.
   */
  add(ref: TestFileRef, priority: Priority, forced = false, recent = false): void {
    const id = testFileId(ref);
    const entry = this.#entries.get(id);
    if (entry) {
      entry.priority = Math.min(entry.priority, priority) as Priority;
      entry.forced ||= forced;
      entry.recent ||= recent;
      return;
    }
    this.#entries.set(id, { ref, priority, seq: this.#seq++, forced, recent });
  }

  clear(): void {
    this.#entries.clear();
    this.#recentTiers = 0;
  }

  remove(ref: TestFileRef): boolean {
    return this.#entries.delete(testFileId(ref));
  }

  isForced(ref: TestFileRef): boolean {
    return this.#entries.get(testFileId(ref))?.forced ?? false;
  }

  isRecent(ref: TestFileRef): boolean {
    return this.#entries.get(testFileId(ref))?.recent ?? false;
  }

  /** Some entry was queued by an edit: tiers stay `runner.tierSize` (D5 step 5 as amended). */
  hasRecent(): boolean {
    for (const entry of this.#entries.values()) if (entry.recent) return true;
    return false;
  }

  /** A tier was selected; `tookBacklog` when it took an entry that is not recent. */
  tierSelected(tookBacklog: boolean): void {
    const waiting = [...this.#entries.values()].some((entry) => !entry.recent);
    this.#recentTiers = tookBacklog || !waiting ? 0 : this.#recentTiers + 1;
  }

  /**
   * Recent entries first, then priority, then shortest last known duration
   * with unknown ones last, then first queued, then project and path. Spec
   * 001 D5 step 4 as amended (task 001-100, defect 19): work an edit caused
   * runs ahead of the baseline, an environment change or `run --all`, "within
   * each group D5's order stands"; "within a class, shortest last known
   * duration first, so a slow integration file never delays the edited
   * module's own unit test." After `RECENT_TIERS_PER_BACKLOG_TIER` tiers of
   * recent entries only (`tierSelected`), the backlog comes first once.
   */
  ordered(durationOf: DurationOf = () => null): TestFileRef[] {
    const first = this.#recentTiers >= RECENT_TIERS_PER_BACKLOG_TIER ? -1 : 1;
    const durations = new Map<Entry, number>();
    for (const entry of this.#entries.values()) {
      durations.set(entry, durationOf(entry.ref) ?? Number.POSITIVE_INFINITY);
    }
    const duration = (entry: Entry) => durations.get(entry) ?? Number.POSITIVE_INFINITY;
    return [...this.#entries.values()]
      .sort(
        (a, b) =>
          first * (Number(b.recent) - Number(a.recent)) ||
          a.priority - b.priority ||
          byDuration(duration(a), duration(b)) ||
          a.seq - b.seq ||
          compare(a.ref.project, b.ref.project) ||
          compare(a.ref.path, b.ref.path),
      )
      .map((entry) => entry.ref);
  }
}

/** Ascending; two unknown (infinite) durations are equal. */
function byDuration(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1;
}
