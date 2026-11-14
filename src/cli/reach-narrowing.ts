import type { NarrowingEstimate, NoList, Unproved } from "../core/reach/report-types.js";
import { plural } from "../core/text.js";
import { pct, secs } from "./reach-text.js";

/*
 * Spec 022 D4: the text of `squeal reach`'s section "narrowing by loaded
 * modules", one block per project.
 */

const REASONS = {
  "never recorded": "never recorded",
  "coverage off": "coverage off, so no list is recorded",
  "isolate: false": "isolate: false, so no list is recorded",
  "incomplete run": "the run did not complete",
  "list lost": "the list was lost",
} as const;

function noListText(entry: NoList): string {
  const detail = entry.detail === null ? "" : ` (${entry.detail})`;
  return `${entry.reason}${detail}: ${plural(entry.testFiles, "test file")}, ${secs(entry.seconds)}`;
}

/** Review 0.1.493 B2: why a pair with a list is left out of the estimate. */
const UNPROVED = {
  "no recorded walk": "no import walk at its key",
  "walk incomplete": "its import walk stops at an unrecorded module",
} as const;

function unprovedText(entry: Unproved): string {
  return `${UNPROVED[entry.reason]}: ${plural(entry.testFiles, "test file")}, ${secs(entry.seconds)}`;
}

function projectLines(estimate: NarrowingEstimate): string[] {
  const name = estimate.project === "" ? "default project" : estimate.project;
  if (estimate.status === "not Vitest") {
    return [`  ${name}: its runner records no lists (Vitest only); nothing estimated.`];
  }
  const without =
    estimate.withoutList.length === 0
      ? []
      : [`    re-run without a list: ${estimate.withoutList.map(noListText).join("; ")}`];
  const unproved =
    estimate.unproved.length === 0
      ? []
      : [
          `    re-run, input not proved an import, not estimated: ${estimate.unproved.map(unprovedText).join("; ")}`,
        ];
  if (estimate.status === "no lists") {
    const reason = REASONS[estimate.reason ?? "never recorded"];
    return [`  ${name}: no lists: ${reason}; nothing estimated.`, ...without];
  }
  if (estimate.rerunSeconds === 0) {
    return [
      `  ${name}: no edit in the window re-ran a test file with recorded seconds.`,
      ...without,
      ...unproved,
    ];
  }
  return [
    `  ${name}: would save ${pct(estimate.share)} of re-run seconds, ${secs(estimate.avoidableSeconds)} of ${secs(estimate.rerunSeconds)} over the window's edits.`,
    ...estimate.files.map(
      (f) =>
        `    ${f.path}: avoidable ${secs(f.avoidableSeconds)}; imported by ${plural(f.importedBy, "test file")}, loaded by ${f.loadedBy}`,
    ),
    ...(estimate.moreFiles === 0
      ? []
      : [`    … and ${estimate.moreFiles} more; --limit lists more.`]),
    ...without,
    ...unproved,
  ];
}

export function narrowingLines(estimates: readonly NarrowingEstimate[]): string[] {
  const [first] = estimates;
  if (first === undefined) return [];
  return [
    `Narrowing by loaded modules (${first.lists}): seconds re-run only because an edited file is on an import path the test file did not load. An upper bound on what narrowing saves, not proof those tests are waste.`,
    ...estimates.flatMap(projectLines),
  ];
}
