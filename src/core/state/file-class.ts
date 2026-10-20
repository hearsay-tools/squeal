import { testFileId } from "../keys/index.js";
import type {
  KnownState,
  PendingPhase,
  TestFileKeyRecord,
  Validity,
  ValidityCounts,
} from "../types/index.js";
import { testFileKeyOf } from "./derive.js";

/** A test file as the verdict counts it: `current` only when every check it has is. */
export type FileClass = Validity;

/**
 * `row`'s class from its checks `own`: `pending` while queued or running or
 * any check is, else `unknown` while unkeyed, without checks or with an
 * unknown check, else `stale` with a stale check, else `current`. A file the
 * worktree does not list (`row` undefined) is `unknown`. A named wait's
 * verdict (`readVerdict`) and the header's `testFileCounts` both class by it
 * (row 011-26).
 */
export function fileClassOf(
  row: TestFileKeyRecord | undefined,
  own: readonly KnownState[],
): FileClass {
  const has = (validity: Validity) => own.some((s) => s.validity === validity);
  const queued = row !== undefined && row.key !== null && row.pending !== null;
  const unkeyed = row === undefined || row.key === null;
  if (queued || has("pending")) return "pending";
  if (unkeyed || own.length === 0 || has("unknown")) return "unknown";
  return has("stale") ? "stale" : "current";
}

/** What `notCurrentText` counts, from one pass over a worktree's states and key rows. */
export interface NotCurrentCounts {
  readonly testFileCounts: ValidityCounts;
  readonly testFilesByPhase: Readonly<Record<PendingPhase, number>>;
  readonly testsByPhase: Readonly<Record<PendingPhase, number>>;
}

/**
 * Spec 011 C6 as amended 2026-10-20 (gh-45, row 011-26): every listed test
 * file by `fileClassOf`, and the pending files and pending tests by phase.
 * A pending check without a phase takes its file's, else is queued; a file
 * or check of a file an open run holds (`openFiles`, `testFileId`s) is
 * running, though a re-key queued it under its new key (C15), as status's
 * breakdown counts checks. Here, not in `src/core/status`, since the guarded
 * `readHeader` counts by it (`test/keys/key-format.test.ts`'s seams).
 */
export function countNotCurrent(
  states: readonly KnownState[],
  keys: readonly TestFileKeyRecord[],
  openFiles: ReadonlySet<string> = new Set(),
): NotCurrentCounts {
  const checks = new Map<string, KnownState[]>();
  for (const state of states) {
    if (state.check.kind === "setup") continue;
    const id = testFileKeyOf(state.check);
    const own = checks.get(id);
    if (own === undefined) checks.set(id, [state]);
    else own.push(state);
  }
  const testFileCounts = { current: 0, pending: 0, stale: 0, unknown: 0 };
  const testFilesByPhase = { running: 0, queued: 0 };
  const testsByPhase = { running: 0, queued: 0 };
  for (const row of keys) {
    const id = testFileId(row.testFile);
    const own = checks.get(id) ?? [];
    const fileClass = fileClassOf(row, own);
    testFileCounts[fileClass]++;
    if (fileClass !== "pending") continue;
    const running = openFiles.has(id) || row.pending === "running" || own.some(isRunning);
    testFilesByPhase[running ? "running" : "queued"]++;
  }
  const filePhase = new Map(keys.map((row) => [testFileId(row.testFile), row.pending]));
  for (const state of states) {
    if (state.check.kind !== "test" || state.validity !== "pending") continue;
    const id = testFileKeyOf(state.check);
    const phase = openFiles.has(id)
      ? "running"
      : (state.pendingPhase ?? filePhase.get(id) ?? "queued");
    testsByPhase[phase]++;
  }
  return { testFileCounts, testFilesByPhase, testsByPhase };
}

const isRunning = (state: KnownState) => state.pendingPhase === "running";
