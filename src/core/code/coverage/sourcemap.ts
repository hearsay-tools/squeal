import type { SourceMapLike } from "./types.js";

/** One mapping of a generated line: its column, then the source index, line and column (0-based). */
export type Segment = readonly [column: number, source: number, line: number, sourceColumn: number];

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const DIGIT = new Int8Array(128).fill(-1);
for (let i = 0; i < BASE64.length; i++) DIGIT[BASE64.charCodeAt(i)] = i;

/**
 * The segments of each generated line of a source map v3 (`mappings`), in
 * column order. A segment without a source position (one field) is left
 * out: it maps to nothing. Throws on a character outside base64.
 */
export function decodeMappings(mappings: string): Segment[][] {
  const lines: Segment[][] = [];
  let line: Segment[] = [];
  let source = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let column = 0;
  const fields: number[] = [];
  let value = 0;
  let shift = 0;
  const endSegment = () => {
    if (fields.length >= 4) {
      column += fields[0] ?? 0;
      source += fields[1] ?? 0;
      sourceLine += fields[2] ?? 0;
      sourceColumn += fields[3] ?? 0;
      line.push([column, source, sourceLine, sourceColumn]);
    } else if (fields.length > 0) column += fields[0] ?? 0;
    fields.length = 0;
  };
  for (let i = 0; i < mappings.length; i++) {
    const code = mappings.charCodeAt(i);
    if (code === 59 /* ; */) {
      endSegment();
      lines.push(line);
      line = [];
      column = 0;
      continue;
    }
    if (code === 44 /* , */) {
      endSegment();
      continue;
    }
    const digit = code < 128 ? (DIGIT[code] ?? -1) : -1;
    if (digit < 0) throw new Error(`source map: not base64 at ${i}`);
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
      continue;
    }
    fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
    value = 0;
    shift = 0;
  }
  endSegment();
  lines.push(line);
  for (const segments of lines) segments.sort((a, b) => a[0] - b[0]);
  return lines;
}

/**
 * Where each generated position maps in the module's own source: segments
 * whose source is another file are dropped. Without a map, the generated
 * code is its own source, line for line (an identity map).
 */
export class PositionMap {
  readonly #lines: Segment[][] | null;
  /** Vite maps a module to itself alone, its source 0; another source is not this module's. */
  readonly #own = 0;

  constructor(map: SourceMapLike | null) {
    this.#lines =
      map === null || typeof map.mappings !== "string" ? null : decodeMappings(map.mappings);
  }

  /**
   * Every mapped position of generated `line` (0-based), whose text is
   * `text`: `[column, sourceLine]`, both 0-based. Without a map, the line's
   * first character that is not white space.
   */
  *segments(line: number, text: string): Generator<readonly [number, number]> {
    if (this.#lines === null) {
      const column = text.search(/\S/);
      if (column !== -1) yield [column, line];
      return;
    }
    for (const segment of this.#lines[line] ?? []) {
      if (segment[1] === this.#own) yield [segment[0], segment[2]];
    }
  }

  /**
   * The source position of generated `(line, column)`: the last mapped
   * segment at or before it on its line, else the first after it; `null`
   * when the line maps nothing of the module's own source.
   */
  at(line: number, column: number): readonly [line: number, column: number] | null {
    if (this.#lines === null) return [line, column];
    let found: Segment | undefined;
    for (const segment of this.#lines[line] ?? []) {
      if (segment[1] !== this.#own) continue;
      if (segment[0] <= column) found = segment;
      else {
        found ??= segment;
        break;
      }
    }
    return found === undefined ? null : [found[2], found[3]];
  }
}
