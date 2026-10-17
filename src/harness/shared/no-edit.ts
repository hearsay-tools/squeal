import { registration, seesEveryChange } from "../../core/delivery/registered.js";
import type { Consumer, Store } from "../../core/types/index.js";

/**
 * Task 004-67 (issue 19, decided by the human 2026-10-17): whether the
 * worktree has had no revision since `consumer` registered, so a main agent
 * that changed nothing is not held at Stop for its slow files under
 * `stop.requireSlowSuite`. The daemon's record of revisions decides, never
 * the agent's claim: true only when the consumer's registration revision is
 * still the latest, and the daemon that had finished its start scan at
 * registration is the one recorded (`seesEveryChange`), since an edit made
 * while no daemon ran is in no revision until a start scan. Any revision
 * counts, another session's or the agent's own. Call inside a transaction.
 */
export function unchangedSinceRegistration(store: Store, consumer: Consumer): boolean {
  const r = registration(store, consumer);
  if (r === null || !seesEveryChange(store, consumer.worktreeId, r)) return false;
  return (store.revisions.latest(consumer.worktreeId)?.number ?? 0) === r.since;
}
