import { worktreeIdFor } from "../fs/index.js";
import { formatCheck } from "../state/index.js";
import { cap, plural } from "../text.js";
import {
  type AbsolutePath,
  type EpochMs,
  type FailuresResult,
  PAYLOAD_SCHEMA_VERSION,
} from "../types/index.js";
import { formatUnavailable, shortCommit } from "./format-status.js";
import { type StatusStoreOptions, withStatusStore } from "./open.js";
import { WHY_RESULT_LIMIT } from "./why.js";

/** Most failures `squeal failures` lists, as many as `why` lists results. */
export const FAILURES_LIMIT = WHY_RESULT_LIMIT;

/** Longest fingerprint a human line prints; `--json` carries it whole. */
const FINGERPRINT_CHARS = 160;

export interface FailuresOptions extends StatusStoreOptions {
  /** Every worktree's failures, not only this one's (`--all-worktrees`). */
  readonly allWorktrees?: boolean;
  /** Only failures recorded at or after this time (`--since`). */
  readonly since?: EpochMs | null;
}

/**
 * `squeal failures` for the worktree containing `cwd` (task 001-409): the
 * stored failing results, newest first, at most `FAILURES_LIMIT`. Reads the
 * shared store in one read transaction (D7, D8) and starts no daemon.
 */
export function readFailures(cwd: AbsolutePath, options: FailuresOptions = {}): FailuresResult {
  const allWorktrees = options.allWorktrees ?? false;
  const since = options.since ?? null;
  return withStatusStore(cwd, options, ({ store, root }) => {
    const worktreeId = worktreeIdFor(root);
    const roots = new Map(store.worktrees.list().map((w) => [w.id, w.root]));
    const filter = { worktreeId: allWorktrees ? null : worktreeId, since };
    const failures = store.results.listFailures(filter, FAILURES_LIMIT).map((r) => ({
      check: r.check,
      worktreeId: r.provenance.worktreeId,
      worktreeRoot: roots.get(r.provenance.worktreeId) ?? null,
      revision: r.provenance.revision,
      commit: r.provenance.commit,
      dirty: r.provenance.dirty,
      recordedAt: r.provenance.recordedAt,
      durationMs: r.durationMs,
      fingerprint: r.fingerprint,
      summary: r.summary,
      runId: r.provenance.runId,
    }));
    return {
      schemaVersion: PAYLOAD_SCHEMA_VERSION,
      available: true,
      worktreeId,
      worktreeRoot: roots.get(worktreeId) ?? root,
      allWorktrees,
      since,
      failures,
      total: store.results.countFailures(filter),
      limit: FAILURES_LIMIT,
    };
  });
}

/** Human rendering of `squeal failures`: two lines per failure, a third with its summary. */
export function formatFailures(report: FailuresResult): string {
  if (!report.available) return formatUnavailable(report);
  const scope = report.allWorktrees ? "every worktree" : "this worktree";
  const window = report.since === null ? "" : ` since ${new Date(report.since).toISOString()}`;
  if (report.total === 0) return `No stored failures in ${scope}${window}.\n`;
  const count =
    report.total > report.failures.length
      ? `newest ${report.failures.length} of ${report.total}`
      : plural(report.total, "failure");
  const lines = [`Failures in ${scope}${window} (${count}, newest first):`];
  for (const f of report.failures) {
    const where =
      f.worktreeId === report.worktreeId
        ? `${report.worktreeRoot} (this worktree)`
        : (f.worktreeRoot ?? `removed worktree ${f.worktreeId}`);
    lines.push(
      `  FAIL  ${new Date(f.recordedAt).toISOString()}  ${formatCheck(f.check)}`,
      `        ${where}, revision ${f.revision}, commit ${shortCommit(f.commit)}, ${f.dirty ? "dirty" : "clean"}, ${Math.round(f.durationMs)} ms, run ${f.runId}`,
    );
    const text = f.fingerprint ?? f.summary;
    if (text !== null) lines.push(`        ${cap(text.split("\n")[0] ?? "", FINGERPRINT_CHARS)}`);
  }
  lines.push("", 'squeal why "<check>" prints a failure\'s full output.');
  return `${lines.join("\n")}\n`;
}
