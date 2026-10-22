import { checkIdentity, formatCheck } from "../state/index.js";
import type {
  AbsolutePath,
  CheckId,
  EpochMs,
  FailureEntry,
  FailureSelection,
  ReplacedFailure,
  ResultRecord,
  Store,
  WorktreeId,
} from "../types/index.js";
import { testFileFrame } from "./test-frame.js";

/*
 * 011 C6 as amended 2026-10-21 (row 011-77, gh-54): `squeal failures` lists
 * the stored failing results and the replaced failures, merged newest first
 * and cut at `--limit`. The stored rows are selected and limited in SQL; the
 * kept entries, at most 1,024 in one `meta` row, are selected here by the
 * same selection, in the same read transaction.
 */

/** What the failures read needs besides the store: the worktrees' roots and the runs' loads. */
export interface EntryContext {
  readonly roots: ReadonlyMap<WorktreeId, AbsolutePath>;
  readonly loads: ReadonlyMap<string, number>;
}

/** A stored failing row as `failures` lists it. */
export function storedEntry(r: ResultRecord, { roots, loads }: EntryContext): FailureEntry {
  const frame = testFileFrame(r.check, r.errors);
  return {
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
    location: r.location,
    ...(frame === null ? {} : { testFileFrame: frame }),
    loadPerCpu: loads.get(r.provenance.runId) ?? null,
  };
}

/** A kept replaced failure as `failures` lists it; its frame is read from its kept text. */
function replacedEntry(store: Store, e: ReplacedFailure, { roots }: EntryContext): FailureEntry {
  const text = e.failureId === null ? null : store.failures.text(e.failureId);
  const frame = text === null ? null : testFileFrame(e.check, text.errors);
  const p = e.provenance;
  return {
    check: e.check,
    worktreeId: p.worktreeId,
    worktreeRoot: roots.get(p.worktreeId) ?? null,
    revision: p.revision,
    commit: p.commit,
    dirty: p.dirty,
    recordedAt: p.recordedAt,
    durationMs: e.durationMs,
    fingerprint: e.fingerprint,
    summary: e.summary,
    runId: p.runId,
    location: e.location,
    ...(frame === null ? {} : { testFileFrame: frame }),
    loadPerCpu: e.loadPerCpu,
    replacedBy: { ...e.replacedBy, worktreeRoot: roots.get(e.replacedBy.worktreeId) ?? null },
  };
}

/**
 * The kept entries `selection` selects, newest first; `texts` are the
 * `--check` texts, matched against the printed name as the stored rows'
 * checks are. With `perCheck`, each check's newest only.
 */
export function selectReplaced(
  entries: readonly ReplacedFailure[],
  selection: FailureSelection,
  texts: readonly string[],
): ReplacedFailure[] {
  const { worktreeId, since, paths, errors = [] } = selection;
  const selected = newestFirst(
    entries.filter(
      (e) =>
        (worktreeId === null || e.provenance.worktreeId === worktreeId) &&
        (since === null || e.provenance.recordedAt >= since) &&
        (paths.length === 0 ||
          paths.some((p) => e.check.testPath === p || e.check.testPath.startsWith(`${p}/`))) &&
        (texts.length === 0 || texts.some((t) => formatCheck(e.check).includes(t))) &&
        (errors.length === 0 || errors.some((t) => e.summary?.includes(t) === true)),
    ),
  );
  return selection.perCheck === true ? newestOfEach(selected, (e) => e.check) : selected;
}

/**
 * Review 0.1.265 B1: kept entries, newest failure first. They are kept in the
 * order passes replaced them, which need not be the order they failed in.
 * At one failure time, the one kept later comes first, as of two stored
 * rows the later one does.
 */
export function newestFirst(entries: readonly ReplacedFailure[]): ReplacedFailure[] {
  return entries.toReversed().sort((a, b) => b.provenance.recordedAt - a.provenance.recordedAt);
}

/**
 * The stored rows, newest `limit` first, merged with the selected replaced
 * failures: newest first, cut at `limit`, each check once with `perCheck`.
 * At one failure time a stored row comes first, as `perCheckTotals` counts.
 * The newest `limit` stored rows are enough: a check whose newest is stored
 * and listed has fewer than `limit` checks or rows newer than it.
 */
export function mergeFailures(
  store: Store,
  stored: readonly ResultRecord[],
  replaced: readonly ReplacedFailure[],
  perCheck: boolean,
  limit: number,
  context: EntryContext,
): FailureEntry[] {
  const all: Listed[] = [
    ...stored.map((r) => ({
      at: r.provenance.recordedAt,
      check: r.check,
      entry: () => storedEntry(r, context),
    })),
    ...replaced.map((e) => ({
      at: e.provenance.recordedAt,
      check: e.check,
      entry: () => replacedEntry(store, e, context),
    })),
  ].sort((a, b) => b.at - a.at);
  const chosen = perCheck ? newestOfEach(all, (x) => x.check) : all;
  return chosen.slice(0, limit).map((x) => x.entry());
}

/** One failure in the merged list, its entry built only when listed. */
interface Listed {
  readonly at: EpochMs;
  readonly check: CheckId;
  readonly entry: () => FailureEntry;
}

/**
 * With `perCheck`, how many checks the stored rows and the replaced ones
 * select in all, and how many of them have a replaced failure as their
 * newest; `storedChecks` is the stored rows' count of checks.
 */
export function perCheckTotals(
  store: Store,
  filter: FailureSelection,
  storedChecks: number,
  replaced: readonly ReplacedFailure[],
): { total: number; replaced: number } {
  if (replaced.length === 0) return { total: storedChecks, replaced: 0 };
  const checks: CheckId[] = replaced.map((e) => e.check);
  const newestStored = new Map(
    store.failures
      .list({ ...filter, checks, perCheck: true }, checks.length)
      .map((r) => [checkIdentity(r.check), r.provenance.recordedAt]),
  );
  let added = 0;
  let newer = 0;
  for (const e of replaced) {
    const at = newestStored.get(checkIdentity(e.check));
    if (at === undefined) added++;
    if (at === undefined || e.provenance.recordedAt > at) newer++;
  }
  return { total: storedChecks + added, replaced: newer };
}

/** The load per CPU a failure's run had, as a known failure states it (001-368). */
export function loadText(loadPerCpu: number | null): string {
  return loadPerCpu === null
    ? "load per CPU then not recorded"
    : `load ${loadPerCpu.toFixed(2)} per CPU when it ran`;
}

/** The first of each check in `items`, in their order. */
function newestOfEach<T>(items: readonly T[], checkOf: (item: T) => CheckId): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = checkIdentity(checkOf(item));
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
