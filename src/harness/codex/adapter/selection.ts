import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { currentFile, isNewer, readCurrent, runtimeRoot, SCHEMA, writeAtomic } from "./layout.js";
import { checkRoot, RuntimeError } from "./manifest.js";
import type { RuntimeRef } from "./publish.js";

/*
 * Row 002-38 (spec 002 D8): every current writer compares and selects under
 * this short transaction. It never covers retention, copying or network I/O.
 * The permanent database is never replaced; process death releases exclusion.
 */
export const selectionFile = (data: string): string => `${currentFile(data)}.sqlite`;

export interface SelectionOptions {
  readonly node?: string;
  /** Updater cancellation/deadline admission, under exclusion just before writing. */
  readonly beforeSelect?: () => void;
}

/**
 * Selects monotonically and returns the usable winner, rather than the requested
 * version. An unusable newer record stays unchanged; the candidate is a local
 * fallback, as it was for seed bootstrap. Contention fails at once, without a pin.
 */
export function selectCurrent(
  data: string,
  version: string,
  options: SelectionOptions = {},
): RuntimeRef {
  const node = options.node ?? process.versions.node;
  const release = acquireSelection(data);
  try {
    const candidate = { root: runtimeRoot(data, version), version };
    checkRoot(candidate.root, version, node);
    const current = readCurrent(data);
    let winner = candidate;
    const advance = current === null || current === "invalid" || isNewer(version, current.version);
    if (!advance) {
      const root = runtimeRoot(data, current.version);
      try {
        checkRoot(root, current.version, node);
        winner = { root, version: current.version };
      } catch {
        // Preserve the newer record, but allow the seed fallback if its tree is gone.
      }
    }
    options.beforeSelect?.();
    if (advance) {
      try {
        writeAtomic(currentFile(data), `${JSON.stringify({ schema: SCHEMA, version })}\n`);
      } catch (error) {
        throw writeError(data, error);
      }
    }
    return winner;
  } finally {
    release();
  }
}

/** A nonblocking transaction, separate from the updater's download lock. */
function acquireSelection(data: string): () => void {
  let db: DatabaseSync;
  try {
    mkdirSync(dirname(selectionFile(data)), { recursive: true });
    db = new DatabaseSync(selectionFile(data));
  } catch (error) {
    throw writeError(data, error);
  }
  try {
    db.exec("PRAGMA busy_timeout = 0");
    db.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    db.close();
    if (((error as { errcode?: number }).errcode ?? 0) % 256 !== 5) throw writeError(data, error);
    throw new RuntimeError(
      "selection-busy",
      `Squeal runtime selection under ${data} is busy. Retry this hook or command; no session runtime was changed.`,
    );
  }
  return () => db.close();
}

function writeError(data: string, error: unknown): RuntimeError {
  return new RuntimeError(
    "unwritable-data",
    `Squeal cannot write its runtime store under ${data}: ${error instanceof Error ? error.message : String(error)}`,
  );
}
