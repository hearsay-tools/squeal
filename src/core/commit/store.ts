import type { WorktreeId } from "../types/common.js";
import { type MetaRepo, worktreeMetaKey } from "../types/store.js";
import { type CommitReport, parseCommitReport } from "./report.js";

/*
 * Spec 019 D5 step 3: the reports of one worktree, stored per commit SHA in
 * one `meta` row, newest first, so worktree removal drops them with it. The
 * row also holds `seen`, the last `HEAD` the daemon looked at: the tool
 * boundary asks for a pass while `HEAD` differs from it.
 */

/** Reports kept per worktree; the oldest leaves first. */
export const COMMIT_REPORTS_KEPT = 20;

/** The `meta` row: the last `HEAD` looked at, and the newest reports first. */
export interface CommitReports {
  readonly seen: string;
  readonly reports: readonly CommitReport[];
}

/** `meta` key of a worktree's commit reports. */
export function commitReportsMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("commitReports", worktreeId);
}

/** The stored row, or `null` when there is none or it is not one; a report that does not parse is left out. */
export function readCommitReports(
  meta: Pick<MetaRepo, "get">,
  worktreeId: WorktreeId,
): CommitReports | null {
  const raw = meta.get(commitReportsMetaKey(worktreeId));
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as { seen?: unknown; reports?: unknown };
    if (typeof value.seen !== "string" || !Array.isArray(value.reports)) return null;
    const reports = value.reports.flatMap((r: unknown) => parseCommitReport(r) ?? []);
    return { seen: value.seen, reports };
  } catch {
    return null;
  }
}

/** The stored report of `commit`, or `null`. */
export function readCommitReport(
  meta: Pick<MetaRepo, "get">,
  worktreeId: WorktreeId,
  commit: string,
): CommitReport | null {
  return readCommitReports(meta, worktreeId)?.reports.find((r) => r.commit === commit) ?? null;
}

/** The newest stored report, the one status shows (D5 step 3), or `null`. */
export function newestCommitReport(
  meta: Pick<MetaRepo, "get">,
  worktreeId: WorktreeId,
): CommitReport | null {
  return readCommitReports(meta, worktreeId)?.reports[0] ?? null;
}

/**
 * Records that `seen` is the `HEAD` looked at, with `report` as the newest
 * report when given. A report of the same commit replaces its older one;
 * past `COMMIT_REPORTS_KEPT` the oldest leave. Only the newest report waits
 * for its update (row 019-22): the others drop what they waited for.
 */
export function writeCommitReports(
  meta: MetaRepo,
  worktreeId: WorktreeId,
  seen: string,
  report?: CommitReport,
): void {
  const before = readCommitReports(meta, worktreeId)?.reports ?? [];
  const kept = report === undefined ? before : before.filter((r) => r.commit !== report.commit);
  const reports = report === undefined ? kept : [report, ...kept.map(settled)];
  const row: CommitReports = { seen, reports: reports.slice(0, COMMIT_REPORTS_KEPT) };
  meta.set(commitReportsMetaKey(worktreeId), JSON.stringify(row));
}

/** `report` without what it waited for. */
function settled(report: CommitReport): CommitReport {
  if (!("waiting" in report)) return report;
  const { waiting: _, ...rest } = report;
  return rest;
}

/**
 * Row 019-22 (D5 step 3): `report` in place of the stored report of its
 * commit, where that one stands; nothing when none is stored.
 */
export function replaceCommitReport(
  meta: MetaRepo,
  worktreeId: WorktreeId,
  report: CommitReport,
): void {
  const row = readCommitReports(meta, worktreeId);
  if (row === null || !row.reports.some((r) => r.commit === report.commit)) return;
  const reports = row.reports.map((r) => (r.commit === report.commit ? report : r));
  meta.set(commitReportsMetaKey(worktreeId), JSON.stringify({ seen: row.seen, reports }));
}
