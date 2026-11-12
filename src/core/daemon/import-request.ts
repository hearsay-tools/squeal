import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { committedBlobs } from "../commit/tree.js";
import { isBusy } from "../store/connection.js";
import { BUSY_BOUND_MS } from "../store/sliced-write.js";
import { decodeBundle } from "../store/transfer-bundle.js";
import {
  ImportStopped,
  importRefusal,
  importSliced,
  type SliceRunner,
} from "../store/transfer-import.js";
import type { AbsolutePath, EpochMs, RelativePath, WorktreeId } from "../types/common.js";
import type { ImportOutcome, ImportRequest } from "../types/daemon-writes.js";
import type { FileHash } from "../types/keys.js";
import type { Store } from "../types/store.js";
import { type DaemonWrites, within } from "./busy-writes.js";

/** The step the socket names while the main thread runs `squeal import`'s import (row 011-302). */
export const COMMAND_IMPORT_STEP = "importing an export for squeal import";

export interface ImportInDaemonContext {
  readonly root: AbsolutePath;
  readonly worktreeId: WorktreeId;
  readonly store: Store;
  readonly writes: DaemonWrites;
  readonly now: () => EpochMs;
  /** True once the daemon stops: no slice starts after, and a waiting one gives up. */
  readonly stopping: () => boolean;
  readonly step?: (operation: string, running: boolean) => void;
}

/**
 * Spec 021 D15 (row 021-20): `squeal import`'s export file, imported by the
 * daemon that serves the worktree. It reads the file and imports exactly
 * the bytes the command checked (their hash), refused as the command
 * refuses them, re-keyed at the export's commit as the command re-keys
 * (018 D11). Each slice goes through the daemon's retried path (021 D2,
 * D3), and one a busy store refuses past `BUSY_BOUND_MS` ends the import
 * with how long it waited, as the command's own write would.
 */
export async function importInDaemon(
  context: ImportInDaemonContext,
  request: ImportRequest,
): Promise<ImportOutcome> {
  const { file } = request;
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch (error) {
    return { failed: `cannot read ${file}: ${(error as Error).message}` };
  }
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  if (fileHash !== request.fileHash) {
    return { failed: `${file} changed after squeal import read it; run the command again` };
  }
  const bundle = decodeBundle(bytes);
  const refusal = typeof bundle === "string" ? bundle : importRefusal(bundle);
  if (typeof bundle === "string" || refusal !== null) {
    return { failed: `refuses ${file}: ${refusal}` };
  }
  const blobs = await exportCommitBlobs(context.root, bundle.header.commit);
  let sliceFrom = Date.now();
  const run: SliceRunner = (slice) => {
    sliceFrom = Date.now();
    return context.writes.write(
      slice.what,
      () => slice.run(),
      within(BUSY_BOUND_MS, context.stopping),
    );
  };
  context.step?.(COMMAND_IMPORT_STEP, true);
  try {
    const counts = await importSliced(context.store, bundle, {
      importId: fileHash.slice(0, 16),
      fileHash,
      now: context.now(),
      clock: context.now,
      dryRun: request.dryRun,
      rekeying: { worktreeId: context.worktreeId, blobs },
      run,
      stopped: context.stopping,
    });
    return { counts, commitHere: blobs !== null };
  } catch (error) {
    if (error instanceof ImportStopped) {
      return { failed: "the daemon stopped during the import; run the command again" };
    }
    if (isBusy(error)) return { busyMs: Date.now() - sliceFrom };
    throw error;
  } finally {
    context.step?.(COMMAND_IMPORT_STEP, false);
  }
}

/** The blob ids of `commit`'s files, or `null` when this repository does not hold it (018 D11). */
export async function exportCommitBlobs(
  root: AbsolutePath,
  commit: string | null,
): Promise<ReadonlyMap<RelativePath, FileHash> | null> {
  if (commit === null) return null;
  try {
    return await committedBlobs(root, commit);
  } catch {
    return null;
  }
}
