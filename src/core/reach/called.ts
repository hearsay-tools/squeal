import type { CoverageSource } from "../code/coverage/types.js";

/*
 * Spec 015 D11 "Coverage per pair" (review 0.1.415 B1): whether a test file
 * called a function of a source "other than its module top level". A
 * function can start at line 1, column 0 too, so the top level is never
 * told by its start alone. It is the entry at 1:0 that encloses every
 * other entry and reaches the source's last line with code. Vitest's
 * records leave the top level out (it starts in the evaluator's wrapper);
 * node:test's and natively loaded CommonJS keep it.
 */

export type Calls = "called" | "loaded only" | "uncertain";

type Entry = CoverageSource["functions"][number];

const before = (a: Entry, line: number, column: number) =>
  a[0] < line || (a[0] === line && a[1] <= column);
const after = (a: Entry, line: number, column: number) =>
  a[2] > line || (a[2] === line && a[3] >= column);

/** Whether `outer` spans `inner`: starts at or before it and ends at or after it. */
const encloses = (outer: Entry, inner: Entry) =>
  before(outer, inner[0], inner[1]) && after(outer, inner[2], inner[3]);

/** The last 1-based line set in a record's bitset; `null` for none. */
export function lastLine(bitset: string): number | null {
  const bytes = Buffer.from(bitset, "base64");
  for (let at = bytes.length - 1; at >= 0; at--) {
    const byte = bytes[at] ?? 0;
    if (byte !== 0) return at * 8 + (31 - Math.clz32(byte)) + 1;
  }
  return null;
}

/**
 * The entries that can be the module's top level: at 1:0, enclosing every
 * other entry, reaching the last line with code. Two at one span are a
 * function the size of the module beside it; only one of them is the top.
 */
function topLevel(source: CoverageSource): readonly Entry[] {
  const last = lastLine(source.lines);
  const { functions } = source;
  return functions.filter(
    (e) =>
      e[0] === 1 &&
      e[1] === 0 &&
      (last === null || e[2] >= last) &&
      functions.every((other) => other === e || encloses(e, other)),
  );
}

/**
 * `firstLineFunction`: whether the counter (D3) found a function starting on
 * line 1 at the record's bytes; `null` when no count is at hand. It settles
 * a source whose only entry could be either its top level or a function.
 */
export function sourceCalls(source: CoverageSource, firstLineFunction: boolean | null): Calls {
  const hits = source.functions.filter((e) => e[4] === 1);
  if (hits.length === 0) return "loaded only";
  const tops = topLevel(source);
  if (hits.some((e) => !tops.includes(e))) return "called";
  // Only an entry that can be the top level ran.
  if (tops.length > 1) {
    // One span, two entries: the module always runs, so the one not hit is a function.
    return tops.filter((e) => e[4] === 1).length === 1 ? "loaded only" : "uncertain";
  }
  if (source.functions.length > 1) return "loaded only";
  return firstLineFunction === false ? "loaded only" : "uncertain";
}
