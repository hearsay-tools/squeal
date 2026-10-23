import { testFileId } from "../keys/index.js";
import type { TestFileRef } from "../types/index.js";

/** One wait's focused checks of one test file, in the daemon's memory. */
export interface FocusEntry {
  readonly ref: TestFileRef;
  readonly id: string;
  texts: readonly string[];
  /** The wait's deadline, on the scheduler's clock. */
  until: number;
  /** Request order: the earlier first. */
  readonly seq: number;
  /** The focused tier in flight that runs it; `null` while it waits for one. */
  runId: string | null;
}

/**
 * The focused entries of a `RunQueue`. A file has at most one entry that
 * waits; a request for a file whose entry waits joins its texts and keeps
 * the later deadline, and one for a file whose entry runs waits beside it
 * (the newest run replaces the row's entry). An entry goes once its run
 * ends, or at its deadline while it waits; a discarded or cancelled run's
 * waits again. A successor daemon does not inherit them.
 */
export class FocusedEntries {
  #entries: FocusEntry[] = [];
  #seq = 0;

  get size(): number {
    return this.#entries.length;
  }

  add(ref: TestFileRef, texts: readonly string[], until: number): void {
    const id = testFileId(ref);
    const waiting = this.#entries.find((entry) => entry.id === id && entry.runId === null);
    if (waiting !== undefined) {
      waiting.texts = [...new Set([...waiting.texts, ...texts])];
      waiting.until = Math.max(waiting.until, until);
      return;
    }
    this.#entries.push({
      ref,
      id,
      texts: [...new Set(texts)],
      until,
      seq: this.#seq++,
      runId: null,
    });
  }

  /** The entries that wait for a run at `now`, in request order; one past its deadline goes. */
  waiting(now: number): readonly FocusEntry[] {
    this.#entries = this.#entries.filter((entry) => entry.runId !== null || entry.until > now);
    return this.#entries.filter((entry) => entry.runId === null);
  }

  /** Whether an entry of `ref` waits or runs: the file has a focused run to come. */
  has(ref: TestFileRef): boolean {
    const id = testFileId(ref);
    return this.#entries.some((entry) => entry.id === id);
  }

  drop(entry: FocusEntry): void {
    this.#entries = this.#entries.filter((e) => e !== entry);
  }

  /** `entries` run in the tier `runId`. */
  started(entries: readonly FocusEntry[], runId: string): void {
    for (const entry of entries) entry.runId = runId;
  }

  /**
   * The tier `runId` ended: an entry `again` holds for waits for another
   * run while its deadline holds, joining the file's waiting entry when one
   * came meanwhile; the others go.
   */
  ended(runId: string, again: (id: string) => boolean, now: number): void {
    for (const entry of this.#entries.filter((e) => e.runId === runId)) {
      this.drop(entry);
      if (again(entry.id) && entry.until > now) this.add(entry.ref, entry.texts, entry.until);
    }
  }

  clear(): void {
    this.#entries = [];
  }
}
