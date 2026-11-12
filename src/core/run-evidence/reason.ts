import type { StoreDecision, TierEnd } from "../scheduler/store-decision.js";
import type { TierFile } from "../scheduler/tiers.js";
import { listPaths } from "../text.js";
import type { RecordOutcome } from "./run-evidence.js";

/* The reason of each store decision (`decisionOf`): the evidence behind it. */

/** The reasons of the decisions that name no path. */
const REASONS = {
  superseded: "a newer run has the file at another key",
  gone: "the file is no longer held as it ran",
  withheld: "the runner withheld the run",
  requeue: "it is queued again",
  "not-started": "the global setup's failure kept it from starting",
  unknown: "the run did not complete it",
  "no-key": "its key moved during the run, so what it read gives no key to store at",
} as const;

/**
 * Why `entry` got `decision`. A file a merge holds, or the barrier
 * withheld, is queued again or left unknown for that evidence, unless the
 * ledger no longer has it as it ran.
 */
export function reasonOf(
  decision: StoreDecision,
  entry: TierFile,
  end: TierEnd,
  outcome: RecordOutcome,
): string {
  if (decision.kind !== "superseded" && decision.kind !== "gone") {
    if (outcome.held.includes(entry)) return "a merge holds a path its key names";
    if (outcome.barred.includes(entry)) return touchedReason(entry, end, outcome);
  }
  return decidedReason(decision, entry, end);
}

/** The touched paths `entry`'s key, or its read, names. */
function touchedReason(entry: TierFile, end: TierEnd, outcome: RecordOutcome): string {
  const named = new Set([...entry.inputs, ...(end.growth.get(entry.file.id)?.growth ?? [])]);
  const paths = outcome.paths.filter((path) => named.has(path));
  return `${listPaths(paths)} was written during the run and ended as it was`;
}

function decidedReason(decision: StoreDecision, entry: TierFile, end: TierEnd): string {
  const growth = end.growth.get(entry.file.id);
  switch (decision.kind) {
    case "split":
      return `the run timed out before it ended; it runs again in tiers of at most ${decision.cap}`;
    case "environment":
      return runtimeMoved(entry, end)
        ? "the runtime's identity moved during the run"
        : "it loaded environment files its key lacks";
    case "unstable":
      return `${listPaths(decision.paths)} changed during the run`;
    case "first-seen":
      return `it read ${listPaths(growth?.firstSeen ?? [])}, first seen during the run`;
    case "store":
      return decision.at === "ran"
        ? "store at the key it ran under"
        : `store at the key with what it read: ${listPaths(growth?.growth ?? [])}`;
    default:
      return REASONS[decision.kind];
  }
}

/** Whether `storeDecision`'s "environment" for `entry` is the runtime's identity's (`TierFile.runtimePolicy`). */
function runtimeMoved(entry: TierFile, end: TierEnd): boolean {
  const now = end.runtimePolicies?.get(entry.file.id);
  return now !== undefined && now !== entry.runtimePolicy;
}
