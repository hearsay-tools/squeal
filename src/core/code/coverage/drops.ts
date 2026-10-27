/** The topic of the writer's one note on the test files that got no record (row 015-79). */
export const DROPPED_TOPIC = "coverage:no-record";

/** Why a completed test file got no record (row 015-79), as the note tells it. */
const CAUSES = {
  "no-result": "its run's result was not found at its key",
  "map-error": "its payload did not map",
  "store-open": "the code store did not open",
  "store-error": "the code store refused the write",
  busy: "the code store stayed locked past the retry budget",
  closed: "the writer closed first",
} as const;

export type DropCause = keyof typeof CAUSES;

/**
 * Row 015-79: the records' writer counts each completed test file that got
 * no record, by cause, and tells the counts in one note under one topic, so
 * status lists the latest. A hook-started daemon's log goes nowhere, so the
 * note is the count's only reader. The note goes at the first drop and at
 * each doubling of the total, a few per day at most; `tell` at close gives
 * the rest.
 */
export class Drops {
  readonly #counts = new Map<DropCause, number>();
  #total = 0;
  #noted = 0;
  #last = "";
  readonly #note: ((text: string, topic: string) => void) | undefined;

  // No parameter properties: the sources load under Node's type stripping too.
  constructor(note: ((text: string, topic: string) => void) | undefined) {
    this.#note = note;
  }

  /** `path` got no record for `cause`; `why`, when given, is the last one's detail. */
  count(cause: DropCause, path: string, why: string | undefined, quiet: boolean): void {
    this.#counts.set(cause, (this.#counts.get(cause) ?? 0) + 1);
    this.#total++;
    this.#last = `${path}: ${why?.slice(0, 200) ?? CAUSES[cause]}`;
    if (!quiet && (this.#total & (this.#total - 1)) === 0) this.tell();
  }

  /** The counts in one note, unless none came since the last. */
  tell(): void {
    if (this.#total === this.#noted) return;
    this.#noted = this.#total;
    const counts = [...this.#counts].map(([cause, n]) => `${n} ${cause} (${CAUSES[cause]})`);
    const files = this.#total === 1 ? "file" : "files";
    this.#note?.(
      `coverage: ${this.#total} completed test ${files} got no record since this daemon started: ` +
        `${counts.join(", ")}; the last: ${this.#last}`,
      DROPPED_TOPIC,
    );
  }

  counts(): Readonly<Partial<Record<DropCause, number>>> {
    return Object.fromEntries(this.#counts);
  }
}
