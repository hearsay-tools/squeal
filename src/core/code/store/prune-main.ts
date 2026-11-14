import type { PruneSlice } from "../../store/prune.js";
import type { AbsolutePath, EpochMs } from "../../types/common.js";
import type { Policy } from "../../types/policy.js";
import type { Store } from "../../types/store.js";
import { isCodeStoreOpenFailure, openCodeStore } from "./open.js";
import { noCodeRemoved } from "./prune.js";
import type { CodePruneCounts, CodePruneOptions, CodePruneReport } from "./types.js";

type MainStore = Pick<Store, "worktrees" | "consumers" | "results">;
type PrunePolicy = Pick<Policy, "complexity" | "store">;

/**
 * 011 C7 for the code store (spec 015 D4, D8; row 015-11), after the main
 * store's prune: the code store keeps what the main store still names, its
 * worktrees, their registered consumers and the keys with a result, so a
 * coverage record goes with the last result at its key. `null`, and
 * nothing opened or created, while the policy is off or no code store
 * exists (goal 1).
 */
export function pruneCodeStoreAfter(
  main: MainStore,
  commonDir: AbsolutePath,
  policy: PrunePolicy,
  now: EpochMs,
): CodePruneReport | null {
  const counts = noCodeRemoved();
  let opened = false;
  const slices = pruneCodeSlicesAfter(main, commonDir, policy, now, counts, () => {
    opened = true;
  });
  for (const slice of slices) slice();
  return opened ? { ...counts } : null;
}

/**
 * Row 011-350 (#220): `pruneCodeStoreAfter` as slices, for the daemon's
 * `SlicedPrune`, which leaves the code store's write lock free between
 * them. The code store is opened when the first slice is asked for, and
 * closed when the slices end or their driver stops (`return`); `opened` is
 * told once it opened. No slice while the policy is off or no code store
 * exists.
 */
export function* pruneCodeSlicesAfter(
  main: MainStore,
  commonDir: AbsolutePath,
  policy: PrunePolicy,
  now: EpochMs,
  counts: CodePruneCounts,
  opened: () => void = () => {},
): Generator<PruneSlice, void, undefined> {
  const code = openCodeStore(commonDir, policy, { create: false });
  if (isCodeStoreOpenFailure(code)) return;
  opened();
  try {
    yield* code.pruneSlices(keptBy(main, policy, now), counts);
  } finally {
    code.close();
  }
}

/** What the main store still names, as the code prune keeps it. */
function keptBy(main: MainStore, policy: PrunePolicy, now: EpochMs): CodePruneOptions {
  const worktrees = main.worktrees.list().map((w) => w.id);
  const consumers = worktrees.flatMap((id) => main.consumers.list(id).map((r) => r.consumer));
  return {
    now,
    retentionDays: policy.store.retentionDays,
    worktrees,
    consumers,
    // Row 011-315: only the keys the code store's records hold, never every key.
    resultKeys: (keys) => main.results.keysWithResults(keys),
  };
}
