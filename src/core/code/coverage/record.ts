import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { compare } from "../../fs/compare.js";
import { blobHash, type ObjectFormat } from "../../hash/blob.js";
import type { AbsolutePath, RelativePath } from "../../types/common.js";
import type { FileHash } from "../../types/keys.js";
import { mapScript } from "./map.js";
import type {
  CoverageRecord,
  CoverageSource,
  CoveredFile,
  ExecutedSource,
  V8Script,
} from "./types.js";

/**
 * Two versions, each moved for its own reason. The provider version is a
 * key input of every test result run with coverage (the runners' environment
 * hashes): it moves only when a test's outcome can differ, since a move
 * re-keys every such result. The record version is part of each record's
 * key in `code.sqlite` (spec 015 D8): it moves when a record's meaning
 * does (its mapping, its fields), so a record of another meaning is never
 * read as this one; such a record reads as no coverage until its test file
 * runs again.
 *
 * Provider versions: 2: functions at one span with different hits are two
 * entries, no longer one with the hits joined (review 0.1.297 B4). 3:
 * node:test lazy inline maps preserve executed text; unusable maps are
 * unread (015-95).
 */
export const COVERAGE_PROVIDER_VERSION = 3;

/**
 * What a runner's key holds of Squeal's coverage (spec 015 D8): the
 * provider's name and version, and `children` while the processes a test
 * starts are measured (020 D12), since its tests can then see
 * `NODE_V8_COVERAGE` and their outcome can differ.
 */
export function coverageMarker(children: boolean) {
  const marker = { provider: "squeal", version: COVERAGE_PROVIDER_VERSION };
  return children ? { ...marker, children: true } : marker;
}

/**
 * Record versions: 3 and before, the provider version's. 4: a test file
 * that mocks `node:url` is mapped with its evaluator's wrapper offset
 * (row 018-10; review wave-3.5 B1), so its earlier records hold the wrong
 * lines at the same result key.
 */
export const COVERAGE_RECORD_VERSION = 4;

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
    functions: [...mapped.functions.values()].sort(byFunction),
  };
}

/** A record's function order: by start, then end, then hit. */
function byFunction(
  a: CoverageSource["functions"][number],
  b: CoverageSource["functions"][number],
) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3] || a[4] - b[4];
}

/** The record of `sources` and `unread`, each sorted by path. */
export function recordOf(
  sources: CoverageSource[],
  unread: readonly RelativePath[],
): CoverageRecord {
  sources.sort((a, b) => compare(a.path, b.path));
  return { v: 1, sources, unread: [...new Set(unread)].sort(compare) };
}

/**
 * Spec 020 D12: a test file's record with its child processes', per path.
 * Where every record holds a path at one blob, its lines and covered lines
 * are each an OR, and its functions are merged by span (`mergeFunctions`):
 * a function ran when one record ran it. A path at two blobs, or `unread`
 * in any record, reads `unread`. With no other record, `own`.
 */
export function mergeRecords(
  own: CoverageRecord,
  others: readonly CoverageRecord[],
): CoverageRecord {
  if (others.length === 0) return own;
  const records = [own, ...others];
  const unread = new Set(records.flatMap((record) => record.unread));
  const byPath = new Map<RelativePath, CoverageSource[]>();
  for (const source of records.flatMap((record) => record.sources)) {
    const known = byPath.get(source.path);
    if (known === undefined) byPath.set(source.path, [source]);
    else known.push(source);
  }
  const sources: CoverageSource[] = [];
  for (const [path, entries] of byPath) {
    if (unread.has(path)) continue;
    const [first] = entries as [CoverageSource, ...CoverageSource[]];
    if (entries.some((entry) => entry.blob !== first.blob)) unread.add(path);
    else sources.push(mergeSource(first, entries));
  }
  return recordOf(sources, [...unread]);
}

/** One path's entries at one blob, as one entry. */
function mergeSource(first: CoverageSource, entries: readonly CoverageSource[]): CoverageSource {
  if (entries.length === 1) return first;
  return {
    path: first.path,
    blob: first.blob,
    lines: orBits(entries.map((entry) => entry.lines)),
    covered: orBits(entries.map((entry) => entry.covered)),
    functions: mergeFunctions(entries),
  };
}

type RecordFunction = CoverageSource["functions"][number];

/**
 * The entries' functions, one per span where each entry has one function
 * there, with the hits ORed: one function in two processes ran when one ran
 * it (row 020-10b, request 7665085b). An entry with two functions at one
 * span, which V8 gives a class's field initializer and its only arrow field
 * (review 0.1.297 B4), keeps every hit seen there as an entry of its own,
 * so no hit moves from one of them to the other.
 */
function mergeFunctions(entries: readonly CoverageSource[]): RecordFunction[] {
  const spans = new Map<string, { hits: Set<0 | 1>; split: boolean; fn: RecordFunction }>();
  for (const entry of entries) {
    const own = new Map<string, Set<0 | 1>>();
    for (const fn of entry.functions) {
      const span = fn.slice(0, 4).join();
      own.set(span, (own.get(span) ?? new Set()).add(fn[4]));
      if (!spans.has(span)) spans.set(span, { hits: new Set(), split: false, fn });
    }
    for (const [span, hits] of own) {
      const known = spans.get(span) as { hits: Set<0 | 1>; split: boolean };
      known.split ||= hits.size > 1;
      for (const hit of hits) known.hits.add(hit);
    }
  }
  const functions: RecordFunction[] = [];
  for (const { hits, split, fn } of spans.values()) {
    const [startLine, startColumn, endLine, endColumn] = fn;
    const kept: readonly (0 | 1)[] = split ? [...hits] : [hits.has(1) ? 1 : 0];
    for (const hit of kept) functions.push([startLine, startColumn, endLine, endColumn, hit]);
  }
  return functions.sort(byFunction);
}

function orBits(bitsets: readonly string[]): string {
  const all = bitsets.map((bits) => Buffer.from(bits, "base64"));
  const bytes = Buffer.alloc(Math.max(...all.map((b) => b.length)));
  for (const b of all) for (let i = 0; i < b.length; i++) bytes[i] = (bytes[i] ?? 0) | (b[i] ?? 0);
  return bytes.toString("base64");
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
