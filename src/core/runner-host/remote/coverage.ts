import { rmSync } from "node:fs";
import { mapHere } from "../../code/coverage/mapper.js";
import { type SharedRecord, shareRecord } from "../../code/coverage/parts.js";
import {
  type BlobCache,
  COVERAGE_RECORD_VERSION,
  decodeRecord,
} from "../../code/coverage/record.js";
import type { CoverageRun, CoveredFile } from "../../code/coverage/types.js";
import type { ObjectFormat } from "../../hash/blob.js";
import type { AbsolutePath } from "../../types/common.js";
import type { TestFileRef } from "../../types/keys.js";
import { insideRoot, type RemoteRecord } from "./tree-wire.js";

/*
 * Spec 026 D9 (row 026-13): remote coverage, mapped where it ran. A
 * remote host keeps each run's payloads instead of sending their paths,
 * which name files of its own machine; once the run's report is built it
 * maps each covered file with the daemon's mapping (`mapHere`), whose
 * paths come out relative to the root, and deletes the raw payload at
 * once. The records, about 25 KiB each against 1.0 to 1.5 MB of raw V8
 * data, ride back on the run's reply. The daemon keeps a record only
 * after the run's blob proof, and only of a file whose result it keeps;
 * a record that does not decode, or names a path outside the root, is
 * dropped there.
 */

/** A remote host's coverage: each run's payloads until the run's reply maps or drops them. */
export interface RemoteCoverage {
  /** The adapter's `collected`: kept for the run's reply, never sent as an event. */
  collected(run: CoverageRun): void;
  /**
   * The records of run `runId`'s files, mapped here in `format`; each
   * payload deleted once read. A file whose map fails is left out.
   */
  take(runId: string, format: ObjectFormat): RemoteRecord[];
  /** Deletes the payloads of run `runId` unmapped. */
  drop(runId: string): void;
}

/** A host's remote coverage; `skip` names a path no record holds (the host's own provider). */
export function remoteCoverage(
  skip: (path: AbsolutePath) => boolean,
  log: (text: string) => void = () => {},
): RemoteCoverage {
  const runs = new Map<string, CoveredFile[]>();
  const blobs: BlobCache = new Map();
  const files = (runId: string): CoveredFile[] => {
    const kept = runs.get(runId) ?? [];
    runs.delete(runId);
    return kept;
  };
  return {
    collected(run) {
      runs.set(run.runId, [...(runs.get(run.runId) ?? []), ...run.files]);
    },
    take(runId, format) {
      const records: RemoteRecord[] = [];
      for (const file of files(runId)) {
        try {
          // `mapHere` deletes the payload and its children's files whatever it finds.
          const bytes = mapHere(file, format, blobs, skip, (why) =>
            log(`coverage: ${file.testFile.path}: a child process's file was dropped: ${why}`),
          );
          records.push({ testFile: file.testFile, record: Buffer.from(bytes).toString("base64") });
        } catch (error) {
          removeFile(file);
          log(`coverage: ${file.testFile.path}: not mapped: ${String(error)}`);
        }
      }
      return records;
    },
    drop(runId) {
      for (const file of files(runId)) removeFile(file);
    },
  };
}

/** A covered file's payload and children's files, deleted. */
function removeFile(file: CoveredFile): void {
  rmSync(file.payload, { force: true });
  if (file.children !== undefined) rmSync(file.children.dir, { recursive: true, force: true });
}

/**
 * The daemon's side: the record of `remote` as the code store takes it,
 * or why it is dropped: bytes that do not decode, or a path not inside the root.
 */
export function sharedOf(remote: RemoteRecord): SharedRecord | string {
  let record: ReturnType<typeof decodeRecord>;
  try {
    record = decodeRecord(Buffer.from(remote.record, "base64"));
  } catch (error) {
    return `its remote record does not decode: ${String(error)}`;
  }
  if (record?.v !== 1 || !Array.isArray(record.sources) || !Array.isArray(record.unread)) {
    return "its remote record is not a coverage record";
  }
  const paths = [...record.sources.map((source) => source?.path), ...record.unread];
  const outside = paths.find((path) => typeof path !== "string" || !insideRoot(path));
  if (outside !== undefined) {
    return `its remote record names a path outside the root: ${JSON.stringify(outside)}`;
  }
  return shareRecord(record, COVERAGE_RECORD_VERSION);
}

/** Of `records`, those of test files not in `without`. */
export function recordsWithout(
  records: readonly RemoteRecord[],
  without: readonly TestFileRef[],
): RemoteRecord[] {
  const gone = new Set(without.map((ref) => `${ref.project}\0${ref.path}`));
  return records.filter((r) => !gone.has(`${r.testFile.project}\0${r.testFile.path}`));
}
