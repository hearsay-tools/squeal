import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { compare } from "../../fs/index.js";
import { blobHash, type ObjectFormat } from "../../hash/index.js";
import type { AbsolutePath, FileHash, RelativePath } from "../../types/index.js";
import { mapScript } from "./map.js";
import type {
  CoverageRecord,
  CoverageSource,
  CoveredFile,
  ExecutedSource,
  V8Script,
} from "./types.js";

/**
 * Bumped when a record's meaning changes (its mapping, its fields), so a
 * record of another meaning is never read as this one: it is part of the
 * record's key (spec 015 D8). 2: functions at one span with different hits
 * are two entries, no longer one with the hits joined (review 0.1.297 B4).
 */
export const COVERAGE_PROVIDER_VERSION = 2;

/** Blob ids already confirmed, by the sha1 of the bytes Vite read; shared by every record mapped. */
export type BlobCache = Map<string, FileHash>;

const BLOB_CACHE_LIMIT = 20_000;

/**
 * Spec 015 D8: the record of one completed test file, from its worker's
 * payload and what the run executed. A script with no transform taken
 * (outside the worktree, `skip`) has no entry. A source's blob id is of the
 * bytes Vite read: the file now when its sha1 is still theirs, else the
 * map's `sourcesContent` when that is; neither, and the source is `unread`.
 */
export function buildRecord(
  file: CoveredFile,
  payload: readonly V8Script[],
  format: ObjectFormat,
  blobs: BlobCache,
  skip: (path: AbsolutePath) => boolean = () => false,
): CoverageRecord {
  const sources: CoverageSource[] = [];
  const unread: RelativePath[] = [];
  for (const script of payload) {
    const path = scriptPath(script.url);
    if (path === null || skip(path)) continue;
    const executed = file.sources.get(path);
    if (executed === undefined) continue;
    const blob = blobOf(path, executed, format, blobs);
    if (blob === null) {
      unread.push(executed.path);
      continue;
    }
    sources.push(sourceEntry(script, executed, blob));
  }
  return recordOf(sources, unread);
}

/** One source of a record: `script` mapped through what ran of it, at the blob id of those bytes. */
export function sourceEntry(
  script: V8Script,
  executed: ExecutedSource,
  blob: FileHash,
): CoverageSource {
  const mapped = mapScript(script, executed);
  return {
    path: executed.path,
    blob,
    lines: bitset(mapped.lines),
    covered: bitset(mapped.covered),
    functions: [...mapped.functions.values()].sort(
      (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3] || a[4] - b[4],
    ),
  };
}

/** The record of `sources` and `unread`, each sorted by path. */
export function recordOf(
  sources: CoverageSource[],
  unread: readonly RelativePath[],
): CoverageRecord {
  sources.sort((a, b) => compare(a.path, b.path));
  return { v: 1, sources, unread: [...new Set(unread)].sort(compare) };
}

/** The record as stored: deflated JSON. */
export function encodeRecord(record: CoverageRecord): Uint8Array {
  return deflateRawSync(JSON.stringify(record));
}

export function decodeRecord(bytes: Uint8Array): CoverageRecord {
  return JSON.parse(inflateRawSync(bytes).toString("utf8")) as CoverageRecord;
}

/** Whether 0-based `line` (1-based `line + 1`) is set in a record's bitset. */
export function hasLine(bitsetText: string, line: number): boolean {
  const bytes = Buffer.from(bitsetText, "base64");
  return ((bytes[line >> 3] ?? 0) & (1 << (line & 7))) !== 0;
}

function bitset(lines: ReadonlySet<number>): string {
  const bytes = new Uint8Array(lines.size === 0 ? 0 : (Math.max(...lines) >> 3) + 1);
  for (const line of lines) bytes[line >> 3] = (bytes[line >> 3] ?? 0) | (1 << (line & 7));
  return Buffer.from(bytes).toString("base64");
}

/** The file a script's URL names; `null` for one that names none, or a module ID with a query. */
export function scriptPath(url: string): AbsolutePath | null {
  if (!url.startsWith("file://") || url.includes("?")) return null;
  try {
    return fileURLToPath(url);
  } catch {
    return null;
  }
}

function blobOf(
  path: AbsolutePath,
  executed: ExecutedSource,
  format: ObjectFormat,
  blobs: BlobCache,
): FileHash | null {
  const sha1 = executed.sha1;
  if (sha1 === undefined) return null;
  const known = blobs.get(sha1);
  if (known !== undefined) return known;
  const content = executed.map?.sourcesContent?.[0];
  for (const read of [() => readFileSync(path), () => Buffer.from(content ?? "", "utf8")]) {
    let bytes: Buffer;
    try {
      bytes = read();
    } catch {
      continue;
    }
    if (createHash("sha1").update(bytes).digest("hex") !== sha1) continue;
    const blob = blobHash(bytes, format);
    if (blobs.size >= BLOB_CACHE_LIMIT) blobs.clear();
    blobs.set(sha1, blob);
    return blob;
  }
  return null;
}
