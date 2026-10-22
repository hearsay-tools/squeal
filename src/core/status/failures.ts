import { realpathSync } from "node:fs";
import { relative, resolve } from "node:path";
import { findWorktreeRoot, toRelative, worktreeIdFor } from "../fs/index.js";
import { formatCheck } from "../state/index.js";
import { cap, plural } from "../text.js";
import {
  type AbsolutePath,
  type EpochMs,
  type FailureSelection,
  type FailuresResult,
  type FailuresSelection,
  PAYLOAD_SCHEMA_VERSION,
  type RelativePath,
} from "../types/index.js";
import { formatUnavailable, shortCommit } from "./format-status.js";
import { type StatusStoreOptions, withStatusStore } from "./open.js";
import { WHY_RESULT_LIMIT } from "./why.js";

/** Most failures `squeal failures` lists by default, as many as `why` lists results. */
export const FAILURES_LIMIT = WHY_RESULT_LIMIT;

/** Longest fingerprint a human line prints; `--json` carries it whole. */
const FINGERPRINT_CHARS = 160;

export interface FailuresOptions extends StatusStoreOptions {
  /** Every worktree's failures, not only this one's (`--all-worktrees`). */
  readonly allWorktrees?: boolean;
  /** Only failures recorded at or after this time (`--since`). */
  readonly since?: EpochMs | null;
  /** Root-relative test files or directories (`failurePaths`); `.` the root. */
  readonly paths?: readonly RelativePath[];
  /** `--check`: only checks whose printed name holds one of these texts. */
  readonly checks?: readonly string[];
  /** `--error`: only failures whose summary holds one of these texts. */
  readonly errors?: readonly string[];
  /** `--per-check`: each selected check once, at its newest selected failure. */
  readonly perCheck?: boolean;
  /** Most failures listed (`--limit`), `"all"` for every one; default `FAILURES_LIMIT`. */
  readonly limit?: number | "all";
}

/**
 * The paths given to `squeal failures`, read from `cwd` as `status <path>`
 * reads them, root-relative (row 011-75): against `cwd`, or its real path
 * when `cwd` reaches the worktree through a symlink. `outside` is the first
 * path outside the worktree. Outside any worktree the paths stay as given,
 * and the read says the store is unavailable.
 */
export function failurePaths(
  cwd: AbsolutePath,
  paths: readonly string[],
):
  | { readonly paths: readonly RelativePath[] }
  | { readonly outside: string; readonly root: AbsolutePath } {
  const root = findWorktreeRoot(cwd);
  if (root === null) return { paths };
  const resolved: RelativePath[] = [];
  for (const path of paths) {
    const rel = worktreePath(root, cwd, path);
    if (rel === null) return { outside: path, root };
    resolved.push(rel);
  }
  return { paths: resolved };
}

function worktreePath(root: AbsolutePath, cwd: AbsolutePath, path: string): RelativePath | null {
  for (const base of [cwd, realOrNull(cwd)]) {
    if (base === null) continue;
    const absolute = resolve(base, path);
    if (relative(root, absolute) === "") return ".";
    const rel = toRelative(root, absolute);
    if (rel !== null) return rel;
  }
  return null;
}

function realOrNull(path: AbsolutePath): AbsolutePath | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/**
 * `squeal failures` for the worktree containing `cwd` (task 001-409): the
 * stored failing results, newest first, at most `limit`. Reads the shared
 * store in one read transaction (D7, D8) and starts no daemon. Row 011-75:
 * the paths and `--check` texts select in the store's query, through
 * `results_by_failure`; a text is matched against the failing checks'
 * printed names, so check names keep one formatter (C5). Review 0.1.262 B1:
 * `--error` texts select by summary and `--per-check` keeps each check's
 * newest, in the query too, so a grouped notice's command lists its group.
 */
export function readFailures(cwd: AbsolutePath, options: FailuresOptions = {}): FailuresResult {
  const allWorktrees = options.allWorktrees ?? false;
  const since = options.since ?? null;
  const selection: FailuresSelection = {
    paths: options.paths ?? [],
    checks: options.checks ?? [],
    errors: options.errors ?? [],
    perCheck: options.perCheck ?? false,
  };
  return withStatusStore(cwd, options, ({ store, root }) => {
    const worktreeId = worktreeIdFor(root);
    const roots = new Map(store.worktrees.list().map((w) => [w.id, w.root]));
    const base: FailureSelection = {
      worktreeId: allWorktrees ? null : worktreeId,
      since,
      paths: selection.paths.includes(".") ? [] : selection.paths,
      checks: null,
      errors: selection.errors,
      perCheck: selection.perCheck,
    };
    const texts = selection.checks;
    const filter =
      texts.length === 0
        ? base
        : {
            ...base,
            checks: store.failures
              .failingChecks(base)
              .filter((check) => texts.some((text) => formatCheck(check).includes(text))),
          };
    const total = store.failures.count(filter);
    const limit = options.limit === "all" ? total : (options.limit ?? FAILURES_LIMIT);
    const failures = store.failures.list(filter, limit).map((r) => ({
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
      selection,
      failures,
      total,
      limit,
    };
  });
}

/** Human rendering of `squeal failures`: two lines per failure, a third with its summary. */
export function formatFailures(report: FailuresResult): string {
  if (!report.available) return formatUnavailable(report);
  const scope = report.allWorktrees ? "every worktree" : "this worktree";
  const since = report.since === null ? "" : ` since ${new Date(report.since).toISOString()}`;
  const window = `${selectionText(report.selection)}${since}`;
  if (report.total === 0) return `No stored failures in ${scope}${window}.\n`;
  const { perCheck } = report.selection;
  const counted = report.total > report.failures.length;
  const count = counted
    ? `newest ${report.failures.length} of ${report.total}${perCheck ? " checks" : ""}`
    : plural(report.total, perCheck ? "check" : "failure");
  const each = perCheck ? ", newest failure of each" : "";
  const lines = [`Failures in ${scope}${window} (${count}${each}, newest first):`];
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

/**
 * ` for <paths>, checks holding "<text>" or "<text>", errors holding "<text>"`, or nothing when
 * every failure is selected.
 */
function selectionText({ paths, checks, errors }: FailuresSelection): string {
  const holding = (what: string, texts: readonly string[]) =>
    texts.length === 0
      ? []
      : [`${what} holding ${texts.map((t) => JSON.stringify(t)).join(" or ")}`];
  const parts = [...paths, ...holding("checks", checks), ...holding("errors", errors)];
  return parts.length === 0 ? "" : ` for ${parts.join(", ")}`;
}
