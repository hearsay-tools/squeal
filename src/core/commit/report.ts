import type { EpochMs, RevisionNumber } from "../types/index.js";

/*
 * Spec 019 D5 steps 2 to 4: a report per commit `HEAD` moved to, from the
 * keys of its committed blobs. Squeal runs nothing for it; it never blocks,
 * denies or holds anything.
 */

/** The test files of one commit's report, each counted once. */
export interface CommitTestCounts {
  /**
   * The worktree's listed test files when the report was made, and the
   * commit's test files the working tree deleted (S3).
   */
  readonly files: number;
  /** Current failing checks of the test files whose key is the committed one, as `Known failures` counts them. */
  readonly failures: number;
  /**
   * Test files whose closure, or an environment input of the worktree,
   * differs between the commit and the working tree (partial staging, an
   * untracked file), and the commit's test files the working tree deleted:
   * "not determined for this commit" (D5 step 2).
   */
  readonly notDetermined: number;
  /** Test files at the committed key with no result yet and a run queued or running. */
  readonly running: number;
  /** Test files at the committed key with no result and nothing queued, or with no key at all. */
  readonly unknown: number;
}

/**
 * The lint checks of one commit's report, file-local only (019-13 slice 2):
 * a check counts only when the blob it was judged at is the committed blob,
 * the config its keys were made of is the committed config (019-21), and it
 * is not stale.
 */
export interface CommitLintCounts {
  /** Findings of the lint checks failing at the committed blob. */
  readonly findings: number;
  /**
   * Lint checks whose file or recorded config differs from the commit, with
   * no recorded config, that are stale, or whose findings are not stored.
   */
  readonly notDetermined: number;
  /** Lint checks whose file is the committed blob and is not linted yet. */
  readonly running: number;
}

interface CommitReportBase {
  /** The commit, full SHA. */
  readonly commit: string;
  /** The worktree's revision when the report was made. */
  readonly revision: RevisionNumber;
  readonly at: EpochMs;
}

/** A report with its counts. `lint` is absent while lint is off or its store was not read. */
export interface CountedCommitReport extends CommitReportBase {
  readonly tests: CommitTestCounts;
  readonly lint?: CommitLintCounts;
}

/** A report that could not be made, with the reason: a git error reading the commit's tree. */
export interface FailedCommitReport extends CommitReportBase {
  readonly failed: string;
}

/** One stored report, per commit SHA. */
export type CommitReport = CountedCommitReport | FailedCommitReport;

export const isFailedReport = (report: CommitReport): report is FailedCommitReport =>
  "failed" in report;

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function countsOf<K extends string>(
  raw: unknown,
  keys: readonly K[],
): Readonly<Record<K, number>> | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  return keys.every((key) => isCount(value[key])) ? (value as Record<K, number>) : null;
}

const TEST_KEYS = ["files", "failures", "notDetermined", "running", "unknown"] as const;
const LINT_KEYS = ["findings", "notDetermined", "running"] as const;

/** A stored report, or `null` when `raw` is not one. */
export function parseCommitReport(raw: unknown): CommitReport | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const { commit, revision, at } = value;
  if (typeof commit !== "string" || !isCount(revision) || !isCount(at)) return null;
  const base = { commit, revision, at };
  if (typeof value.failed === "string") return { ...base, failed: value.failed };
  const tests = countsOf(value.tests, TEST_KEYS);
  if (tests === null) return null;
  const pick = <K extends string>(counts: Record<K, number>, keys: readonly K[]) =>
    Object.fromEntries(keys.map((key) => [key, counts[key]])) as Record<K, number>;
  const lint = value.lint === undefined ? undefined : countsOf(value.lint, LINT_KEYS);
  if (lint === null) return null;
  return {
    ...base,
    tests: pick(tests, TEST_KEYS),
    ...(lint === undefined ? {} : { lint: pick(lint, LINT_KEYS) }),
  };
}
