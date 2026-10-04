import { formatRegistration } from "../../core/delivery/index.js";
import { formatCheck } from "../../core/status/index.js";
import {
  type Consumer,
  type KnownFailure,
  PAYLOAD_SCHEMA_VERSION,
  type StatusHeader,
} from "../../core/types/index.js";

/*
 * Hook-specific wording. Spec 001 D6: "Wording is factual, never imperative:
 * hooks carry no user authority and models do not follow instructions in them."
 */

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Names listed in a block reason before the rest is counted. */
const LISTED_FAILURES = 10;

/**
 * The header line exactly as deltas and registrations render it: the second
 * line of a registration with no failures.
 */
function headerLine(consumer: Consumer, header: StatusHeader): string {
  const text = formatRegistration({
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    consumer,
    header,
    knownFailures: [],
  });
  return text.split("\n")[1] ?? "";
}

/** Stop with no delta: the status header and the known-failure count. */
export function statusText(consumer: Consumer, header: StatusHeader, failures: number): string {
  return [
    `SQUEAL · status at revision ${header.revision}`,
    headerLine(consumer, header),
    knownFailuresLine(failures),
  ].join("\n");
}

export function knownFailuresLine(failures: number): string {
  return `Known failures: ${failures}`;
}

/** Spec 001 D9: "one sentence stating that the edit was not applied and can be re-issued." */
export function denialSentence(toolName: string): string {
  return (
    `Squeal policy interrupt.onRegression denied this ${toolName} call, so the edit was not applied. ` +
    "The same call can be re-issued; this regression does not deny again."
  );
}

export function knownFailuresReason(revision: number, failures: readonly KnownFailure[]): string {
  const names = failures.slice(0, LISTED_FAILURES).map((f) => formatCheck(f.check));
  const more = failures.length - names.length;
  const list = more > 0 ? `${names.join(", ")} and ${more} more` : names.join(", ");
  const verb = failures.length === 1 ? "exists" : "exist";
  return (
    `Squeal policy stop.blockOnKnownFailures is on and ${plural(failures.length, "known failure")} ` +
    `${verb} at revision ${revision}: ${list}.`
  );
}

export function fullSuiteReason(header: StatusHeader): string {
  const last = header.fullSuite.lastCompletedRevision;
  const before =
    last === null ? "none completed at any revision" : `the last one completed at revision ${last}`;
  return (
    `Squeal policy stop.requireFullSuite is on and no full-suite checkpoint completed at revision ` +
    `${header.revision}; ${before}. \`squeal run --all\` starts one.`
  );
}
