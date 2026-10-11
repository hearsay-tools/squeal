import { testFileId } from "../core/keys/index.js";
import { classifySlowFiles, testFileOf, worktreeSlowView } from "../core/state/index.js";
import type {
  DeltaEntry,
  KnownState,
  RelativePath,
  Store,
  TestFileKeyRecord,
  WorktreeId,
} from "../core/types/index.js";

/*
 * Task 001-282 (research `slow-claims.md` §2): `run --slow --wait` holds for
 * the slow files the request queued, which `status --wait` does not hold for
 * (spec 004 D9, as Stop). The scheduler commits them as pending before it
 * answers the request, so the files pending at the wait's first read are the
 * ones it queued. Each is held until it has a result: no check pending and
 * not queued or running. The policy names them once, at that first read;
 * after it, a held file is judged by its own row and checks, so a policy
 * that stops calling it slow does not discharge it (review wave-13ak, B2).
 */

/** The slow files a wait holds for, by `testFileId`, with their paths. */
export type HeldSlow = ReadonlyMap<string, RelativePath>;

/** The worktree's slow files pending now; none without a slow file declared. */
export function pendingSlow(
  store: Store,
  worktreeId: WorktreeId,
  states: readonly KnownState[],
  keys: readonly TestFileKeyRecord[],
): HeldSlow {
  const view = worktreeSlowView(store, worktreeId);
  if (view === null) return new Map();
  const files = classifySlowFiles(states, keys, view.isSlow);
  return new Map(
    [...files]
      .filter(([, file]) => file.class === "pending")
      .map(([id, file]) => [id, file.ref.path]),
  );
}

/**
 * The held files still pending, in path order: a row still queued or
 * running, or a check still pending. A file whose row is gone has no run
 * left to wait for.
 */
export function heldSlowLeft(
  held: HeldSlow,
  states: readonly KnownState[],
  keys: readonly TestFileKeyRecord[],
): readonly RelativePath[] {
  const pending = new Set<string>();
  for (const state of states) {
    if (state.validity !== "pending") continue;
    const id = testFileId(testFileOf(state.check));
    if (held.has(id)) pending.add(id);
  }
  const rows = new Set<string>();
  for (const row of keys) {
    const id = testFileId(row.testFile);
    if (!held.has(id)) continue;
    rows.add(id);
    if (row.pending !== null) pending.add(id);
  }
  return [...pending]
    .filter((id) => rows.has(id))
    .map((id) => held.get(id) as RelativePath)
    .sort();
}

/**
 * Transitions of the held files' checks, news of the request's own files,
 * but those of `counted` files, which the edit's window already counts.
 */
export function heldSlowNews(
  held: HeldSlow,
  entries: readonly DeltaEntry[],
  counted: ReadonlySet<string>,
): number {
  return entries.filter((entry) => {
    const id = testFileId(testFileOf(entry.check));
    return held.has(id) && !counted.has(id);
  }).length;
}
