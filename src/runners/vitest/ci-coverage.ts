import type {
  CoverageOff,
  NoRecord,
  PartCoverage,
  PartFile,
  PartRecords,
} from "../../core/ci/parts.js";
import { assemble, type Manifest, storedPart } from "../../core/code/coverage/parts.js";
import {
  COVERAGE_PROVIDER_VERSION,
  COVERAGE_RECORD_VERSION,
  decodeRecord,
} from "../../core/code/coverage/record.js";
import type { CoverageRecord, CoverageSource } from "../../core/code/coverage/types.js";
import type { WorktreePaths } from "../../core/fs/worktree-paths.js";
import type { RelativePath } from "../../core/types/common.js";

/*
 * Spec 020 D13 (row 020-08a): the coverage `coverage.cjs` wrote into a
 * Vitest process's run file, as a part holds it. A record comes as the
 * records' worker made it, a `SharedRecord` (row 015-85), and is assembled
 * here into the record the daemon and the gate hold; the part stores each
 * source entry once, as most test files of a run load the same sources.
 */

/** Whether the provider was in the run, as `coverage.cjs` wrote it. */
export type RawCoverage =
  | { readonly on: true; readonly note?: string }
  | { readonly off: CoverageOff; readonly note: string };

/** A `SharedRecord` as `coverage.cjs` writes it: each part's bytes in base64, no tail. */
export interface RawRecord {
  readonly paths: readonly RelativePath[];
  readonly parts: readonly { readonly at: number; readonly bytes: string }[];
  readonly unread: readonly number[];
}

/** One module's record, or why it has none. */
export type RawFileCoverage = { readonly record: RawRecord } | { readonly none: NoRecord };

/** The part header's coverage; notes name no absolute path of the worktree. */
export function partCoverage(
  raw: RawCoverage | undefined,
  paths: WorktreePaths,
): PartCoverage | undefined {
  if (raw === undefined) return undefined;
  if ("off" in raw) return { off: raw.off, note: paths.relativizeText(String(raw.note)) };
  return {
    provider: "squeal",
    providerVersion: COVERAGE_PROVIDER_VERSION,
    recordVersion: COVERAGE_RECORD_VERSION,
    ...(raw.note === undefined ? {} : { note: paths.relativizeText(String(raw.note)) }),
  };
}

/** The record `raw` holds; `null` when it does not read. A part that does not read leaves its path unread. */
export function rawRecord(raw: RawRecord): CoverageRecord | null {
  try {
    const manifest: Manifest = {
      paths: raw.paths,
      parts: raw.parts.map((part, i) => ({ at: part.at, id: i + 1 })),
      unread: raw.unread,
    };
    const parts = new Map(
      raw.parts.map((part, i) => [i + 1, storedPart(Buffer.from(part.bytes, "base64"))] as const),
    );
    return decodeRecord(assemble(manifest, parts));
  } catch {
    return null;
  }
}

/** One part's records, each source entry once, by its content. */
export class PartRecordTable {
  readonly #sources: CoverageSource[] = [];
  readonly #index = new Map<string, number>();
  readonly #records: { sources: number[]; unread: readonly RelativePath[] }[] = [];

  /** A test file's `record` or `noRecord`; a module the hook said nothing of is `unmapped`. */
  fileCoverage(raw: RawFileCoverage | undefined): Pick<PartFile, "record" | "noRecord"> {
    if (raw === undefined) return { noRecord: "unmapped" };
    if ("none" in raw) return { noRecord: raw.none };
    const record = rawRecord(raw.record);
    return record === null ? { noRecord: "unmapped" } : { record: this.add(record) };
  }

  add(record: CoverageRecord): number {
    const sources = record.sources.map((source) => {
      const { path, blob, lines, covered, functions } = source;
      const text = JSON.stringify({ path, blob, lines, covered, functions });
      let at = this.#index.get(text);
      if (at === undefined) {
        at = this.#sources.push(source) - 1;
        this.#index.set(text, at);
      }
      return at;
    });
    return this.#records.push({ sources, unread: record.unread }) - 1;
  }

  /** The table; `undefined` when it holds no record. */
  records(): PartRecords | undefined {
    if (this.#records.length === 0) return undefined;
    return { sources: this.#sources, records: this.#records };
  }
}
