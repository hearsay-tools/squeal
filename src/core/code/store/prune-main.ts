import type { AbsolutePath, EpochMs, Policy, Store } from "../../types/index.js";
import { isCodeStoreOpenFailure, openCodeStore } from "./open.js";
import type { CodePruneReport } from "./types.js";

/**
 * 011 C7 for the code store (spec 015 D4, D8; row 015-11), after the main
 * store's prune: the code store keeps what the main store still names, its
 * worktrees, their registered consumers and the keys with a result, so a
 * coverage record goes with the last result at its key. `null`, and
 * nothing opened or created, while the policy is off or no code store
 * exists (goal 1).
 */
export function pruneCodeStoreAfter(
  main: Pick<Store, "worktrees" | "consumers" | "results">,
  commonDir: AbsolutePath,
  policy: Pick<Policy, "complexity" | "store">,
  now: EpochMs,
): CodePruneReport | null {
  const code = openCodeStore(commonDir, policy, { create: false });
  if (isCodeStoreOpenFailure(code)) return null;
  try {
    const worktrees = main.worktrees.list().map((w) => w.id);
    const consumers = worktrees.flatMap((id) => main.consumers.list(id).map((r) => r.consumer));
    const resultKeys = [...new Set(main.results.keysSince(0).map((k) => k.key))];
    return code.prune({
      now,
      retentionDays: policy.store.retentionDays,
      worktrees,
      consumers,
      resultKeys,
    });
  } finally {
    code.close();
  }
}
