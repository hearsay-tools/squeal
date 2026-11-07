import type { Proposal } from "../core/reach/report-types.js";
import { plural } from "../core/text.js";

/*
 * Spec 015 D11 "No history": the text of what `squeal reach` proposes. It
 * names commands and their cost, and starts nothing.
 */

const pct = (share: number) => (share > 0 && share < 0.005 ? "<1%" : `${Math.round(share * 100)}%`);
const has = (n: number) => (n === 1 ? "has" : "have");

/** Paths a proposal names in the text; `--json` gives every one. */
const NAMED_PATHS = 10;

/** `a, b and c`; past `NAMED_PATHS`, the first ones and how many more. */
function pathList(paths: readonly string[]): string {
  if (paths.length > NAMED_PATHS) {
    const more = paths.length - NAMED_PATHS;
    return `${paths.slice(0, NAMED_PATHS).join(", ")} and ${more} more (--json lists every one)`;
  }
  return paths.length < 2 ? paths.join("") : `${paths.slice(0, -1).join(", ")} and ${paths.at(-1)}`;
}

/** 015-116 (P7): which command makes each test file's record, by whether it has a result at its inputs. */
function recordsLines(proposal: Extract<Proposal, { kind: "records" }>): string[] {
  const { noResult, current, testFiles } = proposal;
  const count = (n: number) => `${plural(n, "test file")} ${has(n)}`;
  const retry =
    noResult.length <= NAMED_PATHS
      ? `: \`${proposal.retry} ${noResult.join(" ")}\` runs ${noResult.length === 1 ? "it" : "each"} once.`
      : `; \`${proposal.retry} <test file>...\` runs each once: ${pathList(noResult)}.`;
  return [
    `${count(testFiles)} no coverage record at the current inputs, ${pct(proposal.share)} of the suite's seconds, so their pairs read no record.`,
    ...(noResult.length === 0
      ? []
      : [`${count(noResult.length)} no result at the current inputs${retry}`]),
    ...(current.length === 0
      ? []
      : [
          `${count(current.length)} a result and no record: ${pathList(current)}. Squeal re-runs a current result only in a forced checkpoint, ${proposal.command}, which re-runs every test file, about one run of the whole suite.`,
        ]),
  ];
}

export function proposalLines(proposal: Proposal, coverage: "on" | "off"): string[] {
  switch (proposal.kind) {
    case "start": {
      const lookups = proposal.runsMissing
        ? "looks up the results stored for their inputs, and runs the test files it finds none for (baseline.onStart is lookup-then-run-missing), up to one run of the whole suite"
        : "looks up the results stored for their inputs, in any worktree of this repository, and runs no test";
      return [
        "Reach: no daemon has listed this worktree's test files yet, so Squeal cannot tell what an edit re-runs.",
        `Proposal: ${proposal.command} lists them and ${lookups}. squeal reach then answers, or names what is still missing. squeal reach starts nothing.`,
      ];
    }
    case "warmup": {
      const count =
        proposal.testFiles === null ? "" : ` (${plural(proposal.testFiles, "test file")} listed)`;
      const extra =
        coverage === "on"
          ? "; with coverage on, each test file's coverage record costs about a tenth more CPU in each run"
          : "";
      return [
        "Reach: no test file of this worktree has a recorded result, so Squeal cannot tell yet what an edit re-runs.",
        `Proposal: ${proposal.command} runs every test file without a current result${count}. It costs about one run of the whole suite${extra}. squeal reach starts nothing.`,
      ];
    }
    case "seconds":
      return [
        `${plural(proposal.testFiles, "test file")} of the suite ${has(proposal.testFiles)} no recorded seconds, left out of every share; ${proposal.command} runs ${proposal.testFiles === 1 ? "it" : "them"}.`,
      ];
    case "coverage": {
      const keys = proposal.keys.map((k) => `\`${k}\``).join(" and ");
      return [
        `Proposal: set ${keys} in squeal.config.json, then run ${proposal.command}, so Squeal can tell which tests call each file. Cost: every Vitest and node:test file runs once more, because turning coverage on changes their keys, and each later run takes about a tenth more CPU; turning it off again re-runs them once more. squeal reach does not turn coverage on.`,
      ];
    }
    case "records":
      return recordsLines(proposal);
  }
}
