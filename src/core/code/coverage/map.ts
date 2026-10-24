import { Counts } from "./ranges.js";
import { PositionMap } from "./sourcemap.js";
import type { ExecutedSource, V8Script } from "./types.js";

/** One script mapped to its source: lines 0-based in sets, functions by their 1-based start. */
export interface MappedScript {
  /** Source lines (0-based) with code mapped to them. */
  readonly lines: ReadonlySet<number>;
  /** Of those, the lines whose code ran. */
  readonly covered: ReadonlySet<number>;
  /** By `"line:column"` of its start: `[startLine, startColumn, endLine, endColumn, hit]`. */
  readonly functions: ReadonlyMap<string, [number, number, number, number, 0 | 1]>;
}

/**
 * Spec 015 D8 mapping: one script of a worker's payload through its
 * module's transform and source map. Each mapped position of the code, but
 * closing punctuation, is a line that can run, covered when the innermost
 * V8 range at it ran. Each V8
 * function inside the module's code maps by its start and end; one that
 * starts in the evaluator's wrapper, or on code no source line maps to
 * (what the transform added), is left out.
 */
export function mapScript(script: V8Script, source: ExecutedSource): MappedScript {
  const code = source.code;
  const counts = new Counts(script.functions, script.startOffset ?? 0);
  const positions = new PositionMap(source.map);
  const starts = lineStarts(code);
  const lines = new Set<number>();
  const covered = new Set<number>();
  for (let line = 0; line < starts.length; line++) {
    const start = starts[line] ?? 0;
    const text = code.slice(start, starts[line + 1] ?? code.length);
    for (const [column, sourceLine] of positions.segments(line, text)) {
      if (CLOSING.test(text.charAt(column))) continue;
      const count = counts.at(start + column);
      if (count === null) continue;
      lines.add(sourceLine);
      if (count > 0) covered.add(sourceLine);
    }
  }
  const functions = new Map<string, [number, number, number, number, 0 | 1]>();
  const wrapper = script.startOffset ?? 0;
  for (const fn of script.functions) {
    const own = fn.ranges[0];
    if (own === undefined || own.startOffset < wrapper) continue;
    const from = positionOf(starts, own.startOffset - wrapper);
    const to = positionOf(starts, Math.max(own.startOffset, own.endOffset - 1) - wrapper);
    const begin = positions.at(from[0], from[1]);
    const end = positions.at(to[0], to[1]);
    if (begin === null || end === null) continue;
    const key = `${begin[0] + 1}:${begin[1]}`;
    const hit: 0 | 1 = own.count > 0 ? 1 : 0;
    const known = functions.get(key);
    if (known === undefined) functions.set(key, [begin[0] + 1, begin[1], end[0] + 1, end[1], hit]);
    else if (hit === 1) known[4] = 1;
  }
  return { lines, covered, functions };
}

/**
 * A position at closing punctuation starts no statement: a `}` after an
 * early return sits outside V8's uncovered block and would read as run.
 */
const CLOSING = /^[})\];,]$/;

/** The offset each line of `code` starts at. */
function lineStarts(code: string): number[] {
  const starts = [0];
  for (let at = code.indexOf("\n"); at !== -1; at = code.indexOf("\n", at + 1)) starts.push(at + 1);
  return starts;
}

/** `[line, column]`, 0-based, of `offset` in the code `starts` describes. */
function positionOf(starts: readonly number[], offset: number): [number, number] {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((starts[mid] ?? 0) <= offset) low = mid;
    else high = mid - 1;
  }
  return [low, offset - (starts[low] ?? 0)];
}
