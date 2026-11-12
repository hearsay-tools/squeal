import type { StoreDecision, TierEnd } from "../scheduler/store-decision.js";
import type { TierFile } from "../scheduler/tiers.js";
import { listPaths } from "../text.js";
import type { RelativePath } from "../types/common.js";
import type { RecordOutcome } from "./run-evidence.js";

/* The reason of each store decision (`decisionOf`): the evidence behind it. */

/**
 * The kind of evidence behind a decision (row 011-320): a merge hold, a
 * touched input, the runtime's identity, or the decision's own kind, a
 * store at the key it ran under (`ran`) or with what it read (`grown`).
 */
export type CauseKind =
  | "held"
  | "touched"
  | "runtime"
  | "ran"
  | "grown"
  | Exclude<StoreDecision["kind"], "store">;

/** What a decision's reason names: its kind, and the paths behind it, none for some kinds. */
export interface Cause {
  readonly kind: CauseKind;
  readonly paths: readonly RelativePath[];
}

/** The reasons of the decisions that name no path. */
const REASONS = {
  superseded: "a newer run has the file at another key",
  gone: "the file is no longer held as it ran",
  withheld: "the runner withheld the run",
  requeue: "it is queued again",
  "not-started": "the global setup's failure kept it from starting",
  unknown: "the run did not complete it",
  "no-key": "its key moved during the run, so what it read gives no key to store at",
  held: "a merge holds a path its key names",
  runtime: "the runtime's identity moved during the run",
  environment: "it loaded environment files its key lacks",
  ran: "store at the key it ran under",
} as const;

/**
 * What lies behind `entry`'s `decision`. A file a merge holds, or the
 * barrier withheld, is queued again or left unknown for that evidence,
 * unless the ledger no longer has it as it ran.
 */
export function causeOf(
  decision: StoreDecision,
  entry: TierFile,
  end: TierEnd,
  outcome: RecordOutcome,
): Cause {
  if (decision.kind !== "superseded" && decision.kind !== "gone") {
    if (outcome.held.includes(entry)) return { kind: "held", paths: [] };
    if (outcome.barred.includes(entry))
      return { kind: "touched", paths: touched(entry, end, outcome) };
  }
  const growth = end.growth.get(entry.file.id);
  switch (decision.kind) {
    case "environment":
      return { kind: runtimeMoved(entry, end) ? "runtime" : "environment", paths: [] };
    case "unstable":
      return { kind: "unstable", paths: decision.paths };
    case "first-seen":
      return { kind: "first-seen", paths: growth?.firstSeen ?? [] };
    case "store":
      return decision.at === "ran"
        ? { kind: "ran", paths: [] }
        : { kind: "grown", paths: growth?.growth ?? [] };
    default:
      return { kind: decision.kind, paths: [] };
  }
}

/** Why `entry` got `decision`, in words: the evidence `cause` names. */
export function reasonOf(decision: StoreDecision, cause: Cause): string {
  const paths = listPaths(cause.paths);
  switch (cause.kind) {
    case "touched":
      return `${paths} was written during the run and ended as it was`;
    case "split":
      return decision.kind === "split"
        ? `the run timed out before it ended; it runs again in tiers of at most ${decision.cap}`
        : REASONS.unknown;
    case "unstable":
      return `${paths} changed during the run`;
    case "first-seen":
      return `it read ${paths}, first seen during the run`;
    case "grown":
      return `store at the key with what it read: ${paths}`;
    default:
      return REASONS[cause.kind];
  }
}

/** The touched paths `entry`'s key, or its read, names. */
function touched(entry: TierFile, end: TierEnd, outcome: RecordOutcome): RelativePath[] {
  const named = new Set([...entry.inputs, ...(end.growth.get(entry.file.id)?.growth ?? [])]);
  return outcome.paths.filter((path) => named.has(path));
}

/** Whether `storeDecision`'s "environment" for `entry` is the runtime's identity's (`TierFile.runtimePolicy`). */
function runtimeMoved(entry: TierFile, end: TierEnd): boolean {
  const now = end.runtimePolicies?.get(entry.file.id);
  return now !== undefined && now !== entry.runtimePolicy;
}
