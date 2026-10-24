import type { V8Function } from "./types.js";

/**
 * V8's block ranges of one script as disjoint spans, each with the count of
 * the innermost range that holds it, in offset order. V8 nests ranges: a
 * function's own range holds its blocks, and a block's count overrides its
 * parent's inside it. Offsets are shifted by `-wrapper`, so they index the
 * module's code rather than the evaluator's wrapped script.
 */
export class Counts {
  readonly #starts: number[] = [];
  readonly #ends: number[] = [];
  readonly #counts: number[] = [];

  constructor(functions: readonly V8Function[], wrapper: number) {
    const ranges = functions
      .flatMap((fn) => fn.ranges)
      .map((r) => ({ start: r.startOffset - wrapper, end: r.endOffset - wrapper, count: r.count }))
      .filter((r) => r.end > r.start)
      .sort((a, b) => a.start - b.start || b.end - a.end);
    const open: { end: number; count: number }[] = [];
    let at = Number.NEGATIVE_INFINITY;
    const emit = (to: number, count: number) => {
      if (to > at) {
        this.#starts.push(at);
        this.#ends.push(to);
        this.#counts.push(count);
      }
      at = Math.max(at, to);
    };
    const close = (until: number) => {
      for (let top = open.at(-1); top !== undefined && top.end <= until; top = open.at(-1)) {
        emit(top.end, top.count);
        open.pop();
      }
    };
    for (const range of ranges) {
      close(range.start);
      const top = open.at(-1);
      if (top === undefined) at = range.start;
      else emit(range.start, top.count);
      // A range that overlaps its parent without nesting is cut at the parent's end.
      open.push({
        end: top === undefined ? range.end : Math.min(range.end, top.end),
        count: range.count,
      });
    }
    close(Number.POSITIVE_INFINITY);
  }

  /** The count at `offset`; `null` outside every range. */
  at(offset: number): number | null {
    let low = 0;
    let high = this.#starts.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if ((this.#ends[mid] ?? 0) <= offset) low = mid + 1;
      else if ((this.#starts[mid] ?? 0) > offset) high = mid - 1;
      else return this.#counts[mid] ?? null;
    }
    return null;
  }
}
