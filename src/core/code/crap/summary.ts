import type { RelativePath, RevisionNumber, WorktreeId } from "../../types/index.js";
import type { CodeMetaRepo } from "../store/types.js";
import type { UnknownCause } from "./loaders.js";

/*
 * Spec 015 D9: what the coverage step keeps beside the states, in the code
 * store's `meta`, so the store's schema stays at version 1 (an older
 * daemon of the repository keeps reading it). One key per worktree for
 * each file's condition, one per file for its functions' evidence.
 */

/** A file's coverage condition at its blob. A pending or unknown file keeps its last judged states. */
export type FileSummary =
  | { readonly state: "judged"; readonly blob: string; readonly signature: string }
  | {
      readonly state: "pending";
      readonly blob: string;
      readonly reason: "run" | "record";
      readonly waiting: number;
    }
  | { readonly state: "unknown"; readonly blob: string; readonly cause: UnknownCause };

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
