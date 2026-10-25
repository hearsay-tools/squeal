import type { RelativePath, RevisionNumber, WorktreeId } from "../../types/index.js";
import type { CodeMetaRepo } from "../store/types.js";
import type { PendingReason, UnknownCause } from "./loaders.js";

/*
 * Spec 015 D9: what the coverage step keeps beside the states, in the code
 * store's `meta`, so the store's schema stays at version 1 (an older
 * daemon of the repository keeps reading it). One key per worktree for
 * each file's condition, one per file for its functions' evidence.
 */

/**
 * A file's coverage condition at its blob. A pending or unknown file keeps
 * its last judged states but the passes the records in hand prove (row
 * 015-57); `early` is the signature of those records once they are judged,
 * so a step judges them once. A summary an older Squeal wrote has none.
 */
export type FileSummary =
  | { readonly state: "judged"; readonly blob: string; readonly signature: string }
  | {
      readonly state: "pending";
      readonly blob: string;
      readonly reason: PendingReason;
      readonly waiting: number;
      readonly early?: string;
    }
  | {
      readonly state: "unknown";
      readonly blob: string;
      readonly cause: UnknownCause;
      readonly early?: string;
    };

/** Code meta `coverage:<worktreeId>`. */
export interface CoverageSummary {
  readonly v: 1;
  /** The revision the worktree's coverage states were first seeded at. */
  readonly since: RevisionNumber;
  /** `COVERAGE_PROVIDER_VERSION` the states were judged from; another seeds them again. */
  readonly provider: number;
  readonly files: Readonly<Record<RelativePath, FileSummary>>;
  /**
   * The files a complexity recount left whose next judgement is the
   * recount's, so it records no crossing (review 0.1.297 B2); absent when
   * none waits.
   */
  readonly quiet?: readonly RelativePath[];
  /** Listed test files whose closure the daemon did not know at the last step (review 0.1.297 B3). */
  readonly withoutImports?: number;
  /**
   * Row 015-40: the `crap.threshold` a step judged every ready file at, so
   * a change is seen once that is done; absent from an older Squeal.
   */
  readonly threshold?: number;
  /**
   * Review 0.1.299 B1: the files git changed that are not judged at their
   * blob yet, with the last revision it did. Kept though an own edit after
   * it takes the file out of the pulled record (015-38): an own edit at or
   * before it does not qualify a STILL FAIL. Absent when none.
   */
  readonly brought?: Readonly<Record<RelativePath, RevisionNumber>>;
}

/**
 * Code meta `crapRecount:<worktreeId>` (row 015-40): the last change of
 * `crap.threshold`, once the step judged every ready file at it. A delivery
 * tells it as one summary line and seeds the view again by count, as a
 * complexity recount (D6).
 */
export interface CrapRecount {
  readonly revision: RevisionNumber;
  readonly at: number;
  readonly threshold: number;
}

/**
 * One function's evidence (D9 Delivery): its own lines that can run, those
 * that ran, the number of test files that ran it and the first of them.
 */
export type FunctionEvidence = readonly [
  lines: number,
  covered: number,
  testFiles: number,
  ...first: RelativePath[],
];

/** Code meta `coverage:<worktreeId>:<path>`: the file's functions at its last judged blob. */
export interface FileEvidence {
  readonly blob: string;
  /** By `qualifiedName` NUL `occurrence`. */
  readonly functions: Readonly<Record<string, FunctionEvidence>>;
}

/** How many test files that ran a function its evidence names. */
export const EVIDENCE_FILES = 3;

export const summaryKey = (worktreeId: WorktreeId) => `coverage:${worktreeId}`;
const crapRecountKey = (worktreeId: WorktreeId) => `crapRecount:${worktreeId}`;
export const evidenceKey = (worktreeId: WorktreeId, path: RelativePath) =>
  `coverage:${worktreeId}:${path}`;
export const functionKey = (fn: { qualifiedName: string; occurrence: number }) =>
  `${fn.qualifiedName}\0${fn.occurrence}`;

function parse<T>(text: string | null, valid: (value: unknown) => boolean): T | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return valid(value) ? (value as T) : null;
  } catch {
    return null;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The worktree's summary; `null` before its first step, or unreadable. */
export function readSummary(meta: CodeMetaRepo, worktreeId: WorktreeId): CoverageSummary | null {
  return parse(
    meta.get(summaryKey(worktreeId)),
    (v) => isObject(v) && v.v === 1 && typeof v.since === "number" && isObject(v.files),
  );
}

export function writeSummary(
  meta: CodeMetaRepo,
  worktreeId: WorktreeId,
  summary: CoverageSummary,
): void {
  meta.set(summaryKey(worktreeId), JSON.stringify(summary));
}

export function deleteSummary(meta: CodeMetaRepo, worktreeId: WorktreeId): void {
  meta.delete(summaryKey(worktreeId));
  meta.delete(crapRecountKey(worktreeId));
}

/** The worktree's last `crap.threshold` change; `null` when none is recorded, or it is unreadable. */
export function readCrapRecount(meta: CodeMetaRepo, worktreeId: WorktreeId): CrapRecount | null {
  return parse(
    meta.get(crapRecountKey(worktreeId)),
    (v) =>
      isObject(v) &&
      typeof v.revision === "number" &&
      typeof v.at === "number" &&
      typeof v.threshold === "number",
  );
}

export function writeCrapRecount(
  meta: CodeMetaRepo,
  worktreeId: WorktreeId,
  recount: CrapRecount,
): void {
  meta.set(crapRecountKey(worktreeId), JSON.stringify(recount));
}

export function readEvidence(
  meta: CodeMetaRepo,
  worktreeId: WorktreeId,
  path: RelativePath,
): FileEvidence | null {
  return parse(
    meta.get(evidenceKey(worktreeId, path)),
    (v) => isObject(v) && typeof v.blob === "string" && isObject(v.functions),
  );
}

export function writeEvidence(
  meta: CodeMetaRepo,
  worktreeId: WorktreeId,
  path: RelativePath,
  evidence: FileEvidence | null,
): void {
  if (evidence === null) meta.delete(evidenceKey(worktreeId, path));
  else meta.set(evidenceKey(worktreeId, path), JSON.stringify(evidence));
}
