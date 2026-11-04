import { checkName, headerLines, SQUEAL_COMMAND } from "../../core/delivery/index.js";
import {
  earlierFailuresLines,
  formatCheck,
  knownFailureCounts,
  notCurrentText,
  splitByValidity,
} from "../../core/status/index.js";
import { plural } from "../../core/text.js";
import type { CheckId, KnownFailure, StatusHeader, Validity } from "../../core/types/index.js";

/*
 * Hook-specific wording. Spec 001 D6: "Wording is factual, never imperative:
 * hooks carry no user authority and models do not follow instructions in them."
 */

/** Names listed in a block reason before the rest is counted. */
const LISTED_FAILURES = 10;

/** Known failures a Stop names before pointing to `squeal status` (task 001-222). */
const NAMED_FAILURES = 5;

/**
 * Stop with no delta: the status header and the known failures.
 * `command` is how the header names the CLI (spec 002 D1 as amended).
 */
export function statusText(
  header: StatusHeader,
  failures: readonly KnownFailure[],
  command: string = SQUEAL_COMMAND,
): string {
  return [
    `SQUEAL · status at revision ${header.revision}`,
    ...headerLines(header, command),
    knownFailuresLine(failures, command, header),
  ].join("\n");
}

/**
 * Task 001-222: the count, then the failures by name, or the first
 * `NAMED_FAILURES` and where the rest are listed. Spec 011 C6 as amended
 * (gh-34): only current failures are counted and named; earlier ones pending
 * a rerun or stale get status's line after it. With `header`, the count ends
 * with what is not current (gh-45, row 011-26).
 */
export function knownFailuresLine(
  failures: readonly { readonly check: CheckId; readonly validity: Validity }[],
  command: string = SQUEAL_COMMAND,
  header?: StatusHeader,
): string {
  const current = splitByValidity(failures).current.map((f) => f.check);
  const count = `${countLine(current, command)}${header === undefined ? "" : notCurrentText(header)}`;
  return [count, ...earlierFailuresLines(knownFailureCounts(failures))].join("\n");
}

function countLine(failures: readonly CheckId[], command: string): string {
  if (failures.length === 0) return "Known failures: 0";
  const named = failures.slice(0, NAMED_FAILURES).map(checkName).join(", ");
  const more = failures.length - NAMED_FAILURES;
  const rest = more > 0 ? ` and ${more} more; \`${command} status\` lists every one` : "";
  return `Known failures: ${failures.length} (${named}${rest})`;
}

/** Spec 001 D9: "one sentence stating that the edit was not applied and can be re-issued." */
export function denialSentence(toolName: string): string {
  return (
    `Squeal policy interrupt.onRegression denied this ${toolName} call, so the edit was not applied. ` +
    "The same call can be re-issued; this regression does not deny again."
  );
}

/** `names`, the first `LISTED_FAILURES` of them and how many more. */
export function listNames(names: readonly string[]): string {
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
      `${verb} at revision ${revision}: ${listNames(current.map((f) => formatCheck(f.check)))}.`,
  ];
  const named = (fs: readonly KnownFailure[]) =>
    listNames(fs.map((f) => `${formatCheck(f.check)} (failed at revision ${f.observedAt})`));
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

/** `command` is how the reason names the CLI (spec 002 D1 as amended). */
export function fullSuiteReason(header: StatusHeader, command: string = SQUEAL_COMMAND): string {
  const last = header.fullSuite.lastCompletedRevision;
  const before =
    last === null ? "none completed at any revision" : `the last one completed at revision ${last}`;
  return (
    `Squeal policy stop.requireFullSuite is on and no full-suite checkpoint completed at revision ` +
    `${header.revision}; ${before}. \`${command} run --all\` starts one.`
  );
}
