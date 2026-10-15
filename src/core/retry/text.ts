import type { HostLoad } from "./load.js";
import type { RetryOutcome, RetryReason, RetryRecord } from "./records.js";

/*
 * The words `squeal retry`, status and delivery use for a retry (001-368),
 * one source so the agent reads the same phrase everywhere. Factual, never
 * imperative (spec 001 D6).
 */

/** "load average 12.40 on 8 CPUs", or that it is not known. */
export function loadText(load: HostLoad): string {
  const cpus = `${load.cpus} ${load.cpus === 1 ? "CPU" : "CPUs"}`;
  return load.oneMinute === null
    ? `load average not known on ${cpus}`
    : `load average ${load.oneMinute.toFixed(2)} on ${cpus}`;
}

/** What a pending request of `reason` waits for, with the load now. */
export function waitsText(reason: RetryReason, load: HostLoad): string {
  if (reason === "environment") return "runs at once";
  return `waits for the one-minute load average to fall below the CPU count (${loadText(load)} now)`;
}

/** How an ended request ended, as a short phrase. */
export function outcomeText(outcome: RetryOutcome): string {
  switch (outcome) {
    case "passed":
      return "it passed";
    case "failed":
      return "it failed again";
    case "unknown":
      return "its run gave no result";
    case "cancelled":
      return "it was withdrawn";
  }
}

/** "retry asked (load): it passed", or "pending" while it waits. */
export function retryFact(record: RetryRecord): string {
  const asked = `retry asked (${record.reason})`;
  return record.end === null ? `${asked}, pending` : `${asked}: ${outcomeText(record.end.outcome)}`;
}
