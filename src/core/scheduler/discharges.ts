import type { EpochMs, RekeyedTestFile, RevisionNumber, TestFileRef } from "../types/index.js";
import type { FileState } from "./files.js";

/** A file's last discharged attribution: the revisions its key move had, and when it had its result. */
interface Discharge {
  readonly ref: TestFileRef;
  readonly revisions: readonly RevisionNumber[];
  readonly at: EpochMs;
}

/**
 * Review wave 13k, S1 (task 001-196): the attribution a result, or
 * `unknown`, at a file's key discharged, so a wait whose sync answer comes
 * after it still names the file (`Scheduler.rekeyedSince`). Only the last
 * per file: it never comes back as `keyedAt`, which would hold a later
 * growth's wait for a file that has its result (003 wave-4.5 B1).
 */
export class Discharges {
  readonly #last = new Map<string, Discharge>();

  /** `file`'s attribution is discharged at `at`; nothing when it had none. */
  note(file: FileState, at: EpochMs): void {
    if (file.keyedAt === null || file.lastKeyedAt === null) return;
    const revisions = [...new Set([file.keyedAt, file.lastKeyedAt])];
    this.#last.set(file.id, { ref: file.ref, revisions, at });
  }

  forget(id: string): void {
    this.#last.delete(id);
  }

  /** Files discharged at or after `since`, at their revisions after `after` up to `upTo`. */
  since(since: EpochMs, after: RevisionNumber, upTo: RevisionNumber): RekeyedTestFile[] {
    const files: RekeyedTestFile[] = [];
    for (const { ref, revisions, at } of this.#last.values()) {
      if (at < since) continue;
      for (const revision of revisions) {
        if (revision > after && revision <= upTo) {
          files.push({ testFile: ref, revision, resolved: true });
        }
      }
    }
    return files;
  }
}
