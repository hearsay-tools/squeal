import type { CoverageSource } from "../coverage/types.js";
import type { JoinFunction } from "./join.js";

/*
 * Spec 015 D9 and spec 020 D4: which of a record's V8 functions is each
 * counted function's. The counter's ranges are 1-based lines and columns
 * with an exclusive end; a record's functions are 1-based lines, 0-based
 * columns and an inclusive end, mapped back through the transform's source
 * map. A mapped position is where the code that holds it starts: an arrow's
 * start moves to the name or code before it, and an end to the start of
 * the function's last token. So a V8 function joins the counter's function
 * that ends where it ends, on the same line or the one after its start;
 * one whose last token is longer joins by its start.
 */

/** A record's function: start line, start column, end line, end column, hit. */
export type V8Entry = CoverageSource["functions"][number];

/** How far a joined V8 function's end column may sit from the counter's. */
const END_SLACK = 2;

export interface Span {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  /** 0-based and inclusive, as a record's. */
  readonly endColumn: number;
}

export const spanOf = ({ range }: JoinFunction): Span => ({
  startLine: range.startLine,
  startColumn: range.startColumn - 1,
  endLine: range.endLine,
  endColumn: range.endColumn - 2,
});

const before = (a: number, b: number, c: number, d: number) => a < c || (a === c && b <= d);
export const contains = (outer: Span, inner: Span) =>
  before(outer.startLine, outer.startColumn, inner.startLine, inner.startColumn) &&
  before(inner.endLine, inner.endColumn, outer.endLine, outer.endColumn);

export const entrySpan = ([startLine, startColumn, endLine, endColumn]: V8Entry): Span => ({
  startLine,
  startColumn,
  endLine,
  endColumn,
});

/**
 * Whether the record's function at `outer` is another function's than
 * `span`'s: it holds a counted function outside `span`, as a class's field
 * initializer does (review 0.1.297 B4), or it starts before a counted
 * function that holds `span` and does not hold it, as that function's own
 * does when a type the transform removes cuts its end short (spec 020 D4).
 */
function foreign(spans: readonly Span[], span: Span, outer: Span): boolean {
  return spans.some((other) => {
    if (contains(span, other)) return false;
    if (contains(outer, other)) return true;
    const first = !before(other.startLine, other.startColumn, outer.startLine, outer.startColumn);
    return first && contains(other, span);
  });
}

/**
 * The record's function each counted function joins, one to one: same end
 * line, an end column within `END_SLACK`, a start on the same line or the
 * one before, not `foreign`; the nearest end first, then one that does not
 * start after it, then the nearest start. An arrow's start maps to the code
 * before it, so a nested arrow that ends where its parent ends starts
 * inside the parent, and is not the parent's (spec 020 D4).
 */
export function matchEntries(
  spans: readonly Span[],
  entries: readonly V8Entry[],
): (V8Entry | null)[] {
  const pairs: { fn: number; entry: number; score: readonly number[] }[] = [];
  const endingOn = byEndLine(entries);
  spans.forEach((span, fn) => {
    for (const entry of endingOn.get(span.endLine) ?? []) {
      const e = entries[entry] as V8Entry;
      const [startLine, startColumn, , endColumn] = e;
      const endOff = Math.abs(endColumn - span.endColumn);
      const lineOff = span.startLine - startLine;
      if (endOff > END_SLACK || lineOff < 0 || lineOff > 1) continue;
      if (foreign(spans, span, entrySpan(e))) continue;
      const after = lineOff === 0 && startColumn > span.startColumn ? 1 : 0;
      const startOff = Math.abs(startColumn - span.startColumn);
      pairs.push({ fn, entry, score: [endOff, after, lineOff, startOff] });
    }
  });
  pairs.sort((a, b) => a.score.reduce((d, s, i) => d || s - (b.score[i] ?? 0), 0));
  const joined: (V8Entry | null)[] = spans.map(() => null);
  const used = new Set<number>();
  for (const { fn, entry } of pairs) {
    if (joined[fn] !== null || used.has(entry)) continue;
    joined[fn] = entries[entry] ?? null;
    used.add(entry);
  }
  return joinByStart(spans, entries, joined);
}

const spanKey = (e: V8Entry) => `${e[0]}:${e[1]}:${e[2]}:${e[3]}`;

/** The indices of `entries` by their end line, in order. */
function byEndLine(entries: readonly V8Entry[]): Map<number, number[]> {
  const by = new Map<number, number[]>();
  entries.forEach((e, i) => {
    const on = by.get(e[2]);
    if (on === undefined) by.set(e[2], [i]);
    else on.push(i);
  });
  return by;
}

/**
 * Spec 020 D4: a function whose last token is longer than `END_SLACK`, as
 * `r => r.field` or `x => (y as T).f`, ends in a record before its own end.
 * One the end left unjoined joins the one entry left that starts on its line
 * or the one before, not after it, and ends inside it but not inside an
 * unjoined function nested in it, when no other such function fits that
 * entry; again until none joins.
 */
function joinByStart(
  spans: readonly Span[],
  entries: readonly V8Entry[],
  joined: (V8Entry | null)[],
): (V8Entry | null)[] {
  const keys = entries.map(spanKey);
  const endingOn = byEndLine(entries);
  const fits = (span: Span, e: V8Entry, key: string, used: ReadonlySet<string>) => {
    const [startLine, startColumn, endLine, endColumn] = e;
    const lineOff = span.startLine - startLine;
    if (endColumn >= span.endColumn || lineOff < 0 || lineOff > 1) return false;
    if ((lineOff === 0 && startColumn > span.startColumn) || used.has(key)) return false;
    if (!before(span.startLine, span.startColumn, endLine, endColumn)) return false;
    if (foreign(spans, span, entrySpan(e))) return false;
    const end = { startLine: endLine, startColumn: endColumn, endLine, endColumn };
    return !spans.some(
      (other, j) =>
        other !== span && joined[j] === null && contains(span, other) && contains(other, end),
    );
  };
  for (let more = joined.includes(null); more; ) {
    more = false;
    const used = new Set(joined.flatMap((e) => (e === null ? [] : [spanKey(e)])));
    const open = spans.flatMap((span, fn) => (joined[fn] === null ? [{ span, fn }] : []));
    const found = open.map(({ span }) => {
      const on = endingOn.get(span.endLine) ?? [];
      const fit = on.filter((i) => fits(span, entries[i] as V8Entry, keys[i] as string, used));
      return [...new Set(fit.map((i) => keys[i] as string))];
    });
    open.forEach(({ fn }, i) => {
      const only = found[i]?.length === 1 ? found[i]?.[0] : undefined;
      if (only === undefined || found.some((k, j) => j !== i && k.includes(only))) return;
      joined[fn] = entries[keys.indexOf(only)] ?? null;
      more = true;
    });
  }
  return joined;
}

/**
 * The record's function each of `functions` joins, `null` when none does:
 * what `joinCoverage` reads a record's V8 functions by.
 */
export function joinedEntries(
  functions: readonly JoinFunction[],
  entries: readonly V8Entry[],
): (V8Entry | null)[] {
  return matchEntries(functions.map(spanOf), entries);
}
