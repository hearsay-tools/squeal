import { createHash } from "node:crypto";
import { constants, deflateRawSync, inflateRawSync } from "node:zlib";
import { compare } from "../../fs/index.js";
import type { RelativePath } from "../../types/index.js";
import type { CoverageRecord, CoverageSource } from "./types.js";

/*
 * Row 015-85 (spec 015 D4, "An additive table after version 1"): a record
 * stored as its sources' parts, each once, and a manifest at the record's
 * key. Every piece is raw deflate that ends byte-aligned (a sync flush or a
 * stored block), so pieces joined in order inflate to their texts joined:
 * the manifest's parts joined are the record's text as `encodeRecord` makes
 * it, with no compression on the read.
 *
 * - A part is the source's JSON text: a stored block holding
 *   `{"path":<path>,`, then the rest deflated. A reader checks the path
 *   without inflating. Its hash is the SHA-256 of the provider version, a
 *   newline and that text, so equal blobs with other hits are other parts.
 * - A manifest begins with a stored block holding
 *   `{"v":1,"sources":[],"parts":`, which no record `encodeRecord` made
 *   begins with. Its JSON holds `parts`, pairs of the change in path index
 *   and in part id, in source order; `unreadAt`, the indices of the record's
 *   own unread paths; and `unread`, every path the record holds, sorted. So
 *   the released decoder reads it as a record of no source with every path
 *   unread, and judges none of them from it.
 */

/** One source of a record, ready to store: hashed and compressed off the main thread. */
export interface SharedPart {
  /** Index in `SharedRecord.paths` of the source's path. */
  readonly at: number;
  /** Hex SHA-256 of the provider version, a newline and the source's JSON text. */
  readonly hash: string;
  readonly bytes: Uint8Array;
}

/** A record as its parts, ready to store (`shareRecord`); only the part ids are left to the store. */
export interface SharedRecord {
  /** Every path the record holds, its sources' and its unread, once each, sorted. */
  readonly paths: readonly RelativePath[];
  /** The record's sources, in its order. */
  readonly parts: readonly SharedPart[];
  /** Indices in `paths` of the record's own unread sources. */
  readonly unread: readonly number[];
  /** The manifest's last piece, `"unread":<paths>}`, deflated to its end. */
  readonly tail: Uint8Array;
}

/** A manifest read: each part's path index and id, in source order. */
export interface Manifest {
  readonly paths: readonly RelativePath[];
  readonly parts: readonly { readonly at: number; readonly id: number }[];
  readonly unread: readonly number[];
}

const SYNC = { finishFlush: constants.Z_SYNC_FLUSH } as const;
const SYNC_END = Buffer.from([0, 0, 0xff, 0xff]);
const MANIFEST_HEAD = stored('{"v":1,"sources":[],"parts":');
const RECORD_HEAD = stored('{"v":1,"sources":[');
const COMMA = stored(",");

/** `record` as parts, for `CodeCoverageRepo.putParts`. */
export function shareRecord(record: CoverageRecord, providerVersion: number): SharedRecord {
  const paths = [...new Set([...record.sources.map((s) => s.path), ...record.unread])].sort(
    compare,
  );
  const index = new Map(paths.map((path, i) => [path, i]));
  const parts = record.sources.map((source) => {
    const text = sourceText(source);
    const head = partHead(source.path);
    return {
      at: index.get(source.path) ?? 0,
      hash: createHash("sha256").update(`${providerVersion}\n${text}`).digest("hex"),
      bytes: Buffer.concat([stored(head), deflateRawSync(text.slice(head.length), SYNC)]),
    };
  });
  const unread = [...new Set(record.unread)].map((path) => index.get(path) ?? 0);
  const tail = deflateRawSync(`"unread":${JSON.stringify(paths)}}`);
  return { paths, parts, unread: unread.sort((a, b) => a - b), tail };
}

/** The manifest of `record` whose parts are stored under `ids`, in its parts' order. */
export function manifestBytes(record: SharedRecord, ids: readonly number[]): Uint8Array {
  const pairs: number[] = [];
  let at = 0;
  let id = 0;
  record.parts.forEach((part, i) => {
    const partId = ids[i] ?? 0;
    pairs.push(part.at - at, partId - id);
    at = part.at;
    id = partId;
  });
  const middle = `[${pairs.join(",")}],"unreadAt":[${record.unread.join(",")}],`;
  return Buffer.concat([MANIFEST_HEAD, deflateRawSync(middle, SYNC), record.tail]);
}

/** Whether stored bytes are a manifest, read from their first bytes alone. */
export function isManifest(bytes: Uint8Array): boolean {
  return (
    bytes.length > MANIFEST_HEAD.length &&
    Buffer.from(bytes.buffer, bytes.byteOffset, MANIFEST_HEAD.length).equals(MANIFEST_HEAD)
  );
}

/** A manifest's paths and part ids; `null` when it does not read as one. */
export function readManifest(bytes: Uint8Array): Manifest | null {
  let read: unknown;
  try {
    read = JSON.parse(inflateRawSync(bytes).toString("utf8"));
  } catch {
    return null;
  }
  const { parts: pairs, unreadAt, unread: paths } = (read ?? {}) as Record<string, unknown>;
  if (!integers(pairs) || !integers(unreadAt) || !strings(paths) || pairs.length % 2 !== 0) {
    return null;
  }
  const parts: { at: number; id: number }[] = [];
  let at = 0;
  let id = 0;
  for (let i = 0; i < pairs.length; i += 2) {
    at += pairs[i] ?? 0;
    id += pairs[i + 1] ?? 0;
    if (at < 0 || at >= paths.length || id < 1) return null;
    parts.push({ at, id });
  }
  if (unreadAt.some((i) => i < 0 || i >= paths.length)) return null;
  return { paths, parts, unread: unreadAt };
}

/**
 * The record a manifest names, as `encodeRecord`'s text: each part `parts`
 * holds for its path, joined. A part missing, or not its path's, leaves
 * that path unread, never a source the test file ran none of.
 */
export function assemble(manifest: Manifest, parts: ReadonlyMap<number, Uint8Array>): Uint8Array {
  const pieces: Uint8Array[] = [RECORD_HEAD];
  const unread = manifest.unread.map((i) => manifest.paths[i] ?? "");
  for (const { at, id } of manifest.parts) {
    const path = manifest.paths[at] ?? "";
    const bytes = parts.get(id);
    if (bytes === undefined || !isPartOf(bytes, path)) {
      unread.push(path);
      continue;
    }
    if (pieces.length > 1) pieces.push(COMMA);
    pieces.push(bytes);
  }
  const left = [...new Set(unread)].sort(compare);
  pieces.push(deflateRawSync(`],"unread":${JSON.stringify(left)}}`));
  return Buffer.concat(pieces);
}

/** A source's JSON text, its fields in `CoverageSource`'s order whatever the object's. */
function sourceText(source: CoverageSource): string {
  const { path, blob, lines, covered, functions } = source;
  return JSON.stringify({ path, blob, lines, covered, functions });
}

function partHead(path: RelativePath): string {
  return `{"path":${JSON.stringify(path)},`;
}

/** Whether `bytes` are a part of `path`: its stored head names the path, and it ends byte-aligned. */
function isPartOf(bytes: Uint8Array, path: RelativePath): boolean {
  const head = stored(partHead(path));
  const all = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return (
    all.length > head.length + SYNC_END.length &&
    all.subarray(0, head.length).equals(head) &&
    all.subarray(all.length - SYNC_END.length).equals(SYNC_END)
  );
}

/** A raw deflate stored block, not the last, holding `text`. */
function stored(text: string): Buffer {
  const body = Buffer.from(text, "utf8");
  if (body.length > 0xffff) throw new RangeError(`a stored block holds at most 65535 bytes`);
  const head = Buffer.alloc(5);
  head.writeUInt16LE(body.length, 1);
  head.writeUInt16LE(~body.length & 0xffff, 3);
  return Buffer.concat([head, body]);
}

function integers(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((v) => Number.isSafeInteger(v));
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}
