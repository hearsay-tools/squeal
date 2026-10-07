import { formatRegistration } from "../../core/delivery/index.js";
import { formatCheck } from "../../core/status/index.js";
import { plural } from "../../core/text.js";
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

function list(names: readonly string[]): string {
  const shown = names.slice(0, LISTED_FAILURES);
  const more = names.length - shown.length;
  return more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", ");
}

/**
 * The block reason: `current` failures exist at `revision`; `earlier` ones
 * were observed at an earlier revision and are named with it, as pending when
 * their re-run is queued or running (review wave 3, S1).
 */
export function knownFailuresReason(
  revision: number,
  current: readonly KnownFailure[],
  earlier: readonly KnownFailure[] = [],
): string {
  const verb = current.length === 1 ? "exists" : "exist";
  const sentences = [
    `Squeal policy stop.blockOnKnownFailures is on and ${plural(current.length, "known failure")} ` +
      `${verb} at revision ${revision}: ${list(current.map((f) => formatCheck(f.check)))}.`,
  ];
  const named = (fs: readonly KnownFailure[]) =>
    list(fs.map((f) => `${formatCheck(f.check)} (failed at revision ${f.observedAt})`));
  const pending = earlier.filter((f) => f.validity === "pending");
  if (pending.length > 0) {
    const its = pending.length === 1 ? "its re-run" : "their re-runs";
    sentences.push(
      `${plural(pending.length, "check")} last failed at an earlier revision and ${its} at ` +
        `revision ${revision} ${pending.length === 1 ? "is" : "are"} pending: ${named(pending)}.`,
    );
  }
  const unrun = earlier.filter((f) => f.validity !== "pending");
  if (unrun.length > 0) {
    sentences.push(
      `${plural(unrun.length, "check")} last failed at an earlier revision and ` +
        `${unrun.length === 1 ? "has" : "have"} no result for the current files: ${named(unrun)}.`,
    );
  }
  return sentences.join(" ");
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
