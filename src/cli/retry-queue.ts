import { readPolicy } from "../core/daemon/policy.js";
import { worktreeLiveness } from "../core/presence/heartbeat.js";
import { groupLanesOf, type QueueReads } from "../core/retry/waits.js";
import { groupView } from "../core/scheduler/slow.js";
import { readGroupTiers } from "../core/state/groups.js";
import { readSlowTier, slowPolicyView } from "../core/state/slow.js";
import { openRunsOf } from "../core/status/open-runs.js";
import type { WorktreeId } from "../core/types/common.js";
import type { KnownState } from "../core/types/state.js";
import type { Store } from "../core/types/store.js";

/**
 * What the live daemon recorded that a retry's queued run waits on, as
 * `squeal retry` answers (row 011-272, gh-114): its open runs and its slow
 * tier's activity as status reads them, and each configured group's lane
 * (row 019-27); none without a live daemon, whose records may be old.
 * `states` are the worktree's, read by the caller.
 */
export function queueReads(
  store: Store,
  worktreeId: WorktreeId,
  states: readonly KnownState[],
): QueueReads {
  const root = store.worktrees.get(worktreeId)?.root;
  const policy = root === undefined ? null : readPolicy(root);
  const view = policy === null ? null : slowPolicyView(policy);
  const isSlow = view?.isSlow ?? (() => false);
  const daemon = worktreeLiveness(store.worktrees.get(worktreeId), Date.now());
  if (daemon.state !== "alive") return { isSlow, activity: null, runs: [] };
  // Every row: a running activity names only the slow files whose rows still run.
  const keys = store.testFileKeys.list(worktreeId);
  const tier = view === null ? null : readSlowTier(store, worktreeId, states, keys, view);
  const runs = openRunsOf(store, worktreeId, daemon);
  if (policy === null) return { isSlow, activity: tier?.activity ?? null, runs };
  const groups = groupView(policy);
  const tiers = readGroupTiers(store, worktreeId, states, keys, policy);
  const groupOf = groupLanesOf(tiers, (ref) => groups.of(ref).name);
  return { isSlow, activity: tier?.activity ?? null, runs, groupOf };
}
