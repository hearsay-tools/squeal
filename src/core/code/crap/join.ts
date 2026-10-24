import type { CoverageSource } from "../coverage/types.js";

/*
 * Spec 015 D9, the join: the coverage of one source's functions from the
 * records of the test files that load it, by position, never by name
 * (`complexity-and-crap.md` 4). The counter's ranges are 1-based lines and
 * columns with an exclusive end; a record's functions are 1-based lines,
 * 0-based columns and an inclusive end, mapped back through the transform's
 * source map, which moves an arrow's start to the name before it. So a V8
 * function joins the counter's function that ends where it ends, on the
 * same line or the one after its start. A function V8 never compiled has
 * no V8 function: it ran only when its own body says so.
 */

/** What the join reads of a counted function. */
export interface JoinFunction {
  readonly range: {
    readonly startLine: number;
    readonly startColumn: number;
    readonly endLine: number;
    readonly endColumn: number;
  };
}

/** One function's coverage over every loader's record. */
export interface JoinedFunction {
  /** Its own lines that can run: in its range, not inside a function nested in it. */
  readonly lines: number;
  /** Of those, the lines that ran in a test file that ran the function. */
  readonly covered: number;
  /**
   * A test file ran it in its own process; `null` when none did and a
   * record cannot tell whether it ran (review 0.1.297 B4).
   */
  readonly ran: boolean | null;
  /** The indices of the sources (test files) that ran it. */
  readonly runBy: readonly number[];
  /** The share of its own lines that ran, 0 to 1; 0 when it never ran. */
  readonly coverage: number;
}

/** A record's function: start line, start column, end line, end column, hit. */
type V8Entry = CoverageSource["functions"][number];

/** How far a joined V8 function's end column may sit from the counter's. */
const END_SLACK = 2;

interface Span {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  /** 0-based and inclusive, as a record's. */
  readonly endColumn: number;
}

const spanOf = ({ range }: JoinFunction): Span => ({
  startLine: range.startLine,
  startColumn: range.startColumn - 1,
  endLine: range.endLine,
  endColumn: range.endColumn - 2,
});

const before = (a: number, b: number, c: number, d: number) => a < c || (a === c && b <= d);
const contains = (outer: Span, inner: Span) =>
  before(outer.startLine, outer.startColumn, inner.startLine, inner.startColumn) &&
  before(inner.endLine, inner.endColumn, outer.endLine, outer.endColumn);

/**
 * Each function's own lines: every line of its range but those strictly
 * inside a function nested in it. A line a nested function starts or ends
 * on is both's.
 */
function ownLines(spans: readonly Span[]): number[][] {
  return spans.map((span, i) => {
    const inner = new Set<number>();
    spans.forEach((other, j) => {
      if (j === i || !contains(span, other) || (contains(other, span) && j < i)) return;
      for (let line = other.startLine + 1; line < other.endLine; line++) inner.add(line);
    });
    const lines: number[] = [];
    for (let line = span.startLine; line <= span.endLine; line++) {
      if (!inner.has(line)) lines.push(line);
    }
    return lines;
  });
}

const entrySpan = ([startLine, startColumn, endLine, endColumn]: V8Entry): Span => ({
  startLine,
  startColumn,
  endLine,
  endColumn,
});

/**
 * The record's function each counted function joins, one to one: same end
 * line, an end column within `END_SLACK`, a start on the same line or the
 * one before; the nearest end first, then the nearest start. An entry that
 * holds a counted function outside the one it would join is another
 * function's, as a class's field initializer is (review 0.1.297 B4).
 */
function matchEntries(spans: readonly Span[], entries: readonly V8Entry[]): (V8Entry | null)[] {
  const pairs: { fn: number; entry: number; score: readonly number[] }[] = [];
  spans.forEach((span, fn) => {
    entries.forEach((e, entry) => {
      const [startLine, startColumn, endLine, endColumn] = e;
      const endOff = Math.abs(endColumn - span.endColumn);
      const lineOff = span.startLine - startLine;
      if (endLine !== span.endLine || endOff > END_SLACK || lineOff < 0 || lineOff > 1) return;
      const outer = entrySpan(e);
      if (spans.some((other) => contains(outer, other) && !contains(span, other))) return;
      pairs.push({ fn, entry, score: [endOff, lineOff, Math.abs(startColumn - span.startColumn)] });
    });
  });
  pairs.sort((a, b) => a.score.reduce((d, s, i) => d || s - (b.score[i] ?? 0), 0));
  const joined: (V8Entry | null)[] = spans.map(() => null);
  const used = new Set<number>();
  for (const { fn, entry } of pairs) {
    if (joined[fn] !== null || used.has(entry)) continue;
    joined[fn] = entries[entry] ?? null;
    used.add(entry);
  }
  return joined;
}

/** A record's base64 bitset; bit `n - 1` is line `n`. */
function bits(text: string): Uint8Array {
  return Buffer.from(text, "base64");
}

const has = (set: Uint8Array, line: number) =>
  ((set[(line - 1) >> 3] ?? 0) & (1 << ((line - 1) & 7))) !== 0;

interface JoinRecord {
  readonly lines: Uint8Array;
  readonly covered: Uint8Array;
  readonly entries: readonly V8Entry[];
  readonly joined: readonly (V8Entry | null)[];
}

/** The smallest record function that holds `span`, other than its own. */
function enclosing(span: Span, entries: readonly V8Entry[]): V8Entry | null {
  let inner: V8Entry | null = null;
  for (const e of entries) {
    if (!contains(entrySpan(e), span)) continue;
    if (inner === null || contains(entrySpan(inner), entrySpan(e))) inner = e;
  }
  return inner;
}

/**
 * Whether the record's test file ran the function. A V8 function joined
 * tells it. With none (V8 never compiled it, or the join found none): not
 * when the function that holds it never ran; else its own lines strictly
 * inside its body tell it, since only its own code is on them; with no such
 * line, `null`. A line it starts or ends on can run outside it, as a
 * class's line does for its field arrows (review 0.1.297 B4).
 */
function ranIn(span: Span, body: readonly number[], record: JoinRecord, i: number): boolean | null {
  const entry = record.joined[i];
  if (entry !== null && entry !== undefined) return entry[4] === 1;
  if (enclosing(span, record.entries)?.[4] === 0) return false;
  const executable = body.filter((l) => has(record.lines, l));
  if (executable.length === 0) return null;
  return executable.some((l) => has(record.covered, l));
}

/**
 * Spec 015 D9: each function's coverage from `sources`, the entries for
 * this source at its current blob of every loader's record, in the
 * loaders' order (`ranIn` for each record). It ran when one record ran it;
 * else it is `null` when one record cannot tell.
 */
export function joinCoverage(
  functions: readonly JoinFunction[],
  sources: readonly CoverageSource[],
): JoinedFunction[] {
  const spans = functions.map(spanOf);
  const own = ownLines(spans);
  const records: JoinRecord[] = sources.map((s) => ({
    lines: bits(s.lines),
    covered: bits(s.covered),
    entries: s.functions,
    joined: matchEntries(spans, s.functions),
  }));
  return spans.map((span, i) => {
    const lines = own[i] ?? [];
    const body = lines.filter((l) => l > span.startLine && l < span.endLine);
    const said = records.map((record) => ranIn(span, body, record, i));
    const runBy = said.flatMap((ran, r) => (ran === true ? [r] : []));
    const executable = lines.filter((l) => records.some((r) => has(r.lines, l)));
    const covered = executable.filter((l) =>
      runBy.some((r) => has(records[r]?.covered ?? new Uint8Array(), l)),
    ).length;
    const ran = runBy.length > 0 ? true : said.includes(null) ? null : false;
    const coverage = ran !== true ? 0 : executable.length === 0 ? 1 : covered / executable.length;
    return { lines: executable.length, covered: ran === true ? covered : 0, ran, runBy, coverage };
  });
}
