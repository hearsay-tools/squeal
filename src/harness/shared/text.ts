import { checkName } from "../../core/delivery/collapse.js";
import { SQUEAL_COMMAND } from "../../core/delivery/format.js";
import { currentFilesText, headerParts } from "../../core/delivery/header.js";
import { formatCheck } from "../../core/state/check-name.js";
import {
  earlierFailuresLines,
  knownFailureCounts,
  splitByValidity,
} from "../../core/status/checks.js";
import { plural } from "../../core/text.js";
import type { CheckId } from "../../core/types/check.js";
import type { Validity } from "../../core/types/state.js";
import type { KnownFailure, StatusHeader } from "../../core/types/status.js";

/*
 * Hook-specific wording. Spec 001 D6: "Wording is factual, never imperative:
 * hooks carry no user authority and models do not follow instructions in them."
 */

/** Names listed in a block reason before the rest is counted. */
const LISTED_FAILURES = 10;

/** Known failures a Stop names before pointing to `squeal status` (task 001-222). */
const NAMED_FAILURES = 5;

/**
 * Stop with no delta: the registration's form (row 005-94, C2): the line after the title when
 * it has something to say, the known failures, then the tier lines. `command` is how the header
 * names the CLI (spec 002 D1 as amended).
 */
export function statusText(
  header: StatusHeader,
  failures: readonly KnownFailure[],
  command: string = SQUEAL_COMMAND,
): string {
  const { line, tiers } = headerParts(header, command);
  const known = knownFailuresLine(failures, command, header);
  return [
    `SQUEAL · status at revision ${header.revision}`,
    ...(line === null ? [] : [line]),
    ...(known === "" ? [] : [known]),
    ...tiers,
  ].join("\n");
}

/**
 * Task 001-222: the count, then the failures by name, or the first
 * `NAMED_FAILURES` and where the rest are listed. Spec 011 C6 as amended
 * (gh-34): only current failures are counted and named; earlier ones pending
 * a rerun or stale get status's line after it. With `header`, the count ends
 * with how many test files are current (row 005-94, R1), and no count is said
 * while the test files are not listed and none failed (row 005-90's rule for
 * the registration; C2): empty then.
 */
export function knownFailuresLine(
  failures: readonly { readonly check: CheckId; readonly validity: Validity }[],
  command: string = SQUEAL_COMMAND,
  header?: StatusHeader,
): string {
  const current = splitByValidity(failures).current.map((f) => f.check);
  const earlier = earlierFailuresLines(knownFailureCounts(failures));
  if (header?.testFilesListed === false && failures.length === 0) return earlier.join("\n");
  const files = header === undefined ? null : currentFilesText(header, command);
  const count = `${countLine(current, command)}${files === null ? "" : `; ${files}`}`;
  return [count, ...earlier].join("\n");
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
