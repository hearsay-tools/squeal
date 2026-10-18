import type {
  CheckKey,
  EpochMs,
  RerunFirstFailure,
  ResultRecord,
  Store,
  TestFileRef,
} from "../types/index.js";
import { checkIdentity } from "./derive.js";

/*
 * Spec 011 C5 as amended 2026-10-18 (gh-20, task 011-19): a slow file's new
 * failure after all its tests passed is re-run once, and `why` keeps the
 * first error. The re-run replaces the row at the key whether it passes or
 * fails again, so the first error is kept here when the re-run is queued,
 * apart from the flaky note, which only a flip writes: a fail replaced by a
 * fail is not flaky (review wave-2b B2).
 */

/** `meta` key of the kept first errors of every worktree: the rows they outlive are shared. */
export const RERUN_FIRST_META_KEY = "rerun-first-failures";

/** The newest checks whose first error is kept; an older one is forgotten. */
export const RERUN_FIRST_KEPT = 1_024;

/** The kept first error of each check by `checkIdentity`, oldest first; empty when none parses. */
export function readRerunFirstFailures(store: Store): ReadonlyMap<string, RerunFirstFailure> {
  const raw = store.meta.get(RERUN_FIRST_META_KEY);
  if (raw === null) return new Map();
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return new Map();
    return new Map(
      Object.entries(value).filter((e): e is [string, RerunFirstFailure] => isRecord(e[1])),
    );
  } catch {
    return new Map();
  }
}

/**
 * Keeps the failure of each check of `testFile` that `key` holds as the
 * first error of its re-run, queued `at`, replacing what was kept for the
 * check. Keeps the newest `RERUN_FIRST_KEPT`.
 */
export function recordRerunFirstFailures(
  store: Store,
  testFile: TestFileRef,
  key: CheckKey,
  at: EpochMs,
): void {
  const failed = store.results
    .byKey(key, 0)
    .filter(
      (r): r is ResultRecord & { summary: string } =>
        r.outcome === "fail" &&
        r.summary !== null &&
        r.check.project === testFile.project &&
        r.check.testPath === testFile.path,
    );
  if (failed.length === 0) return;
  const kept = new Map(readRerunFirstFailures(store));
  for (const r of failed) {
    const id = checkIdentity(r.check);
    kept.delete(id);
    kept.set(id, {
      key,
      runId: r.provenance.runId,
      worktreeId: r.provenance.worktreeId,
      failure: r.summary,
      at,
    });
  }
  const newest = [...kept].slice(-RERUN_FIRST_KEPT);
  store.meta.set(RERUN_FIRST_META_KEY, JSON.stringify(Object.fromEntries(newest)));
}

function isRecord(value: unknown): value is RerunFirstFailure {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.key === "string" &&
    typeof v.runId === "string" &&
    typeof v.worktreeId === "string" &&
    typeof v.failure === "string" &&
    typeof v.at === "number"
  );
}
