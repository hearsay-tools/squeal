import type { CachedSourceMap, SourceMapLike } from "./types.js";

// Bound decoding, JSON allocation and mapping work independently of payload size.
const MAX_MAP = 16 * 1024 * 1024;
const MAX_SEGMENTS = 250_000;
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** A map captured by Node, including its lazy inline form (row 015-95); never a disk read. */
export function ownMap(cached: CachedSourceMap, url: string): SourceMapLike | null {
  const map = mapData(cached.data ?? inlineMap(cached.url));
  if (map === null) return null;
  try {
    if (new URL(map.source, url).href !== url) return null;
  } catch {
    return null;
  }
  const lengths = cached.lineLengths;
  if (!validLengths(lengths) || !validMappings(map.mappings, lengths, map.text)) return null;
  return { mappings: map.mappings, sourcesContent: [map.text] };
}

function mapData(map: unknown) {
  if (map === null || typeof map !== "object" || Array.isArray(map)) return null;
  const value = map as Record<string, unknown>;
  if (
    value.version !== 3 ||
    value.sections !== undefined ||
    (value.sourceRoot !== undefined && value.sourceRoot !== "")
  )
    return null;
  const source = singleString(value.sources);
  const text = singleString(value.sourcesContent);
  const mappings = value.mappings;
  if (
    source === null ||
    text === null ||
    typeof mappings !== "string" ||
    text.length > MAX_MAP ||
    mappings.length > MAX_MAP
  )
    return null;
  return { source, text, mappings };
}

function singleString(value: unknown): string | null {
  return Array.isArray(value) && value.length === 1 && typeof value[0] === "string"
    ? value[0]
    : null;
}

function validLengths(lengths: readonly number[]): boolean {
  return (
    Array.isArray(lengths) &&
    lengths.length > 0 &&
    lengths.length <= MAX_SEGMENTS &&
    lengths.every((n) => Number.isSafeInteger(n) && n >= 0) &&
    Number.isSafeInteger(lengths.reduce((sum, n) => sum + n + 1, 0))
  );
}

function inlineMap(url: string | null | undefined): unknown {
  if (typeof url !== "string" || url.length > MAX_MAP) return null;
  const header = /^data:application\/json(?:;charset=utf-8)?(;base64)?,/i.exec(url);
  if (header === null) return null;
  const body = url.slice(header[0].length);
  try {
    let text: string;
    if (header[1] === undefined) text = decodeURIComponent(body);
    else {
      // Buffer's decoder alone accepts invalid characters and truncated base64.
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body)) return null;
      const bytes = Buffer.from(body, "base64");
      if (bytes.toString("base64").replace(/=+$/, "") !== body.replace(/=+$/, "")) return null;
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Validate VLQs before the shared mapper's permissive decoder sees them. */
function validMappings(mappings: string, lengths: readonly number[], text: string): boolean {
  const original = text.split("\n", MAX_SEGMENTS + 1);
  if (original.length > MAX_SEGMENTS) return false;
  let line = 0;
  let column = 0;
  let source = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let segments = 0;
  let value = 0;
  let shift = 0;
  const fields: number[] = [];
  const mapped = () => {
    source += fields[1] ?? 0;
    sourceLine += fields[2] ?? 0;
    sourceColumn += fields[3] ?? 0;
    return (
      source === 0 &&
      sourceLine >= 0 &&
      sourceLine < original.length &&
      sourceColumn >= 0 &&
      sourceColumn <= (original[sourceLine]?.length ?? 0)
    );
  };
  const end = () => {
    if (shift !== 0 || (fields.length !== 1 && fields.length !== 4 && fields.length !== 5))
      return false;
    if (++segments > MAX_SEGMENTS) return false;
    const delta = fields[0] ?? 0;
    column += delta;
    if (delta < 0 || line >= lengths.length || column > (lengths[line] ?? 0)) return false;
    if (fields.length > 1 && !mapped()) return false;
    fields.length = 0;
    return true;
  };
  for (let at = 0; at <= mappings.length; at++) {
    const char = mappings[at];
    if (char === undefined || char === "," || char === ";") {
      if ((fields.length > 0 || shift !== 0) && !end()) return false;
      if (char === ";") {
        line++;
        column = 0;
      }
      continue;
    }
    const digit = BASE64.indexOf(char);
    if (digit < 0 || shift > 30) return false;
    value += (digit & 31) * 2 ** shift;
    if (value > 0x7fff_ffff) return false;
    if ((digit & 32) !== 0) shift += 5;
    else {
      fields.push(value % 2 === 1 ? -Math.floor(value / 2) : value / 2);
      if (fields.length > 5) return false;
      value = 0;
      shift = 0;
    }
  }
  return true;
}
