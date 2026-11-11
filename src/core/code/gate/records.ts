import { existsSync, readdirSync } from "node:fs";
import type { readObjectFormat } from "../../hash/git-index.js";
import { testFileId } from "../../keys/reverse-index.js";
import type { AbsolutePath } from "../../types/common.js";
import { mapHere } from "../coverage/mapper.js";
import { type BlobCache, decodeRecord } from "../coverage/record.js";
import type { CoverageRecord, CoveredFile } from "../coverage/types.js";
import type { ChildFiles } from "./types.js";

/*
 * Spec 020 D3.2: each completed test file's payload mapped to its record
 * here, before the adapter's close deletes it. D12 (row 020-10b): with
 * `coverage.children`, the payload's children's directory is mapped into
 * the same record, each child file dropped alone, and the files are counted
 * for the report.
 */

/** One test file's mapped payload. */
export interface Mapped {
  /** `null` when its payload could not be mapped. */
  readonly record: CoverageRecord | null;
  /** D12.7: with children on, its child coverage files read and dropped. */
  readonly children?: ChildFiles;
}

export interface MapOptions {
  readonly format: Awaited<ReturnType<typeof readObjectFormat>>;
  readonly blobs: BlobCache;
  /** Squeal's provider, never a source. */
  readonly provider: AbsolutePath;
  /** D12: `coverage.children` at the base. */
  readonly children: boolean;
  readonly note: (text: string) => void;
}

/**
 * Each payload's record, by test file. A payload that cannot be mapped
 * gives none, with a note, and its child files count as dropped. A child
 * file dropped alone gives a note, never a gap: a lost child only lowers
 * coverage (D12.4).
 */
export function mapPayloads(
  files: readonly CoveredFile[],
  { format, blobs, provider, children, note }: MapOptions,
): Map<string, Mapped> {
  const mapped = new Map<string, Mapped>();
  for (const file of files) {
    const found = children ? childFiles(file) : 0;
    let dropped = 0;
    const drop = (why: string) => {
      dropped += 1;
      note(
        `${file.testFile.path}: a coverage file of a process its tests started was dropped: ${why}`,
      );
    };
    let record: CoverageRecord | null = null;
    try {
      record = decodeRecord(mapHere(file, format, blobs, (path) => path === provider, drop));
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      note(`no coverage record for ${file.testFile.path}: its payload could not be mapped: ${why}`);
      dropped = found;
    }
    const counts = { read: found - dropped, dropped };
    mapped.set(testFileId(file.testFile), { record, ...(children ? { children: counts } : {}) });
  }
  return mapped;
}

/** The files in the payload's children's directory; none when its tests started no process. */
function childFiles(file: CoveredFile): number {
  const dir = file.children?.dir;
  return dir === undefined || !existsSync(dir) ? 0 : readdirSync(dir).length;
}
