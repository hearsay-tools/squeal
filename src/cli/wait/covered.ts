import { testFileId } from "../../core/keys/reverse-index.js";
import { withStatusStore } from "../../core/status/open.js";
import { type CoveredFiles, readCoveredFiles } from "../../core/store/covered-files.js";
import type { AbsolutePath, WorktreeId } from "../../core/types/common.js";
import type { TestFileRef } from "../../core/types/keys.js";
import type { Store } from "../../core/types/store.js";
import { laneFiles } from "../run-lanes.js";
import { readBound } from "./presence.js";
import type { CheckpointFiles, WaitFiles } from "./reads.js";

/*
 * Row 011-328 (`research/request-intake.md`, "Covered files", conditions
 * 2 to 4): a run wait's files are its request's covered files as the
 * scheduler recorded them when it took the request, read by the id in the
 * daemon's answer through `readCoveredFiles`, in place of the guess from
 * the policy.
 */

/** The answer that named the record, and the wait's deadline, which bounds the read. */
export interface CoveredAsk {
  readonly root: AbsolutePath;
  /** `coveredId` of the daemon's answer; absent from a daemon before row 011-325. */
  readonly coveredId: string | undefined;
  /** Epoch ms; `Infinity` without `--wait`, or for a bare `--wait`. */
  readonly deadline: number;
}

/** What a run wait is for once the daemon took its request (`requestFiles`). */
export interface RequestFiles<F extends WaitFiles> {
  /** The record's files as a list, else `guess`. */
  readonly files: F | Extract<WaitFiles, { kind: "list" }>;
  /** The record read, `null` when the files are the guess. */
  readonly covered: CoveredFiles | null;
}

/**
 * The files a run wait is for, decided once, right after the daemon's
 * answer: the request's covered files, read in one read of the store and
 * kept for the whole wait, a bare `--wait` included; else `guess`, today's
 * reading. The guess stays when the answer names no record (an older
 * daemon), the record is gone (pruned, or a store without its table), or
 * the store was not read (busy past the read's bound, or unopened): the
 * wait's own reads then meet the store as before. A checkpoint of both
 * lanes is for every listed file and every project's setup (`readVerdict`
 * with no list): no guess, so no record is read.
 */
export function requestFiles<F extends WaitFiles>(
  ask: CoveredAsk,
  guess: F,
  now: () => number = Date.now,
): RequestFiles<F> {
  const all = guess.kind === "lane" && guess.lane === null;
  const covered = all ? null : readCovered(ask, now);
  if (covered === null) return { files: guess, covered };
  return { files: { kind: "list", files: covered.files.map((file) => file.testFile) }, covered };
}

/** One read of the record `ask` names, bounded as a run wait's read (`readBound`); `null` when none is read. */
function readCovered({ root, coveredId, deadline }: CoveredAsk, now: () => number) {
  if (coveredId === undefined) return null;
  const { busyTimeoutMs } = readBound(deadline, now);
  const read = withStatusStore(root, { busyTimeoutMs }, ({ store }) =>
    readCoveredFiles(store, coveredId),
  );
  return read !== null && "available" in read ? null : read;
}

/** Whether a test file is one of `files`. */
export function inList(files: readonly TestFileRef[]): (ref: TestFileRef) => boolean {
  const ids = new Set(files.map(testFileId));
  return (ref) => ids.has(testFileId(ref));
}

/**
 * The worktree's listed test files a checkpoint wait is for: a list's,
 * one lane's by the policy (`laneFiles`), or `null` for every listed file.
 */
export function checkpointFiles(
  store: Store,
  worktreeId: WorktreeId,
  files: CheckpointFiles,
): TestFileRef[] | null {
  if (files.kind === "lane") return laneFiles(store, worktreeId, files.lane);
  const listed = inList(files.files);
  return store.testFileKeys
    .list(worktreeId)
    .map((row) => row.testFile)
    .filter(listed);
}
