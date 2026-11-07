import type { CoverageState, PathKind } from "../core/reach/pairs.js";
import type {
  FileEntry,
  NamedFile,
  Proposal,
  ReachReport,
  ReachRoute,
  Split,
  TestEntry,
} from "../core/reach/report-types.js";
import { chainText } from "../core/reach/suggest.js";
import { plural } from "../core/text.js";
import type { EpochMs } from "../core/types/common.js";

/*
 * Spec 015 D11: the human rendering of `squeal reach`. Every number is
 * relative to this repository's own suite, seconds and edits.
 */

const pct = (share: number) => (share > 0 && share < 0.005 ? "<1%" : `${Math.round(share * 100)}%`);
const secs = (s: number) => `${s < 10 ? Math.round(s * 10) / 10 : Math.round(s)} s`;
const day = (at: EpochMs) => new Date(at).toISOString().slice(0, 10);
const has = (n: number) => (n === 1 ? "has" : "have");

/** `called 24%, loaded only 41%`; with coverage off, `called: unknown`. */
function splitText<K extends string>(split: Split<K>): string {
  const parts = (Object.entries(split) as [K, number][]).sort((a, b) => b[1] - a[1]);
  if (parts.length === 1 && parts[0]?.[0] === "unknown") return "called: unknown";
  return parts.map(([k, v]) => `${k} ${pct(v)}`).join(", ") || "none";
}

const COVERAGE_OFF =
  "Coverage is off, so called reads unknown: Squeal cannot tell which of these tests call the file; the path kinds are a proxy.";

function head(report: ReachReport): string[] {
  const { suite, window } = report;
  const left =
    suite.leftOut === 0 ? "" : `; ${plural(suite.leftOut, "test file")} of manual groups left out`;
  return [
    `Reach: what one edit of each file re-runs, of ${plural(suite.testFiles, "test file")} and ${secs(suite.seconds)} recorded${left}.`,
    window === null
      ? "Edits: none recorded (watch revisions in which HEAD did not move)."
      : `Edits: ${window.edits} from ${day(window.from)} to ${day(window.to)}, every worktree's watch revisions in which HEAD did not move.`,
    ...(report.edges
      ? []
      : [
          "Import chains are not stored yet, so import paths read unsplit and setup files are not listed.",
        ]),
    ...(suite.withoutClosure === 0
      ? []
      : [
          suite.withoutClosure === 1
            ? "1 test file has no import closure Squeal trusts at its current inputs, so its reach is not counted; its next run stores one."
            : `${suite.withoutClosure} test files have no import closure Squeal trusts at their current inputs, so their reach is not counted; their next runs store them.`,
        ]),
    ...(report.notRecorded === 0
      ? []
      : [
          `${plural(report.notRecorded, "pair")} read import, path not recorded yet: their test files were walked before Squeal stored import chains; their next run records them.`,
        ]),
    ...(report.coverage === "off" ? [COVERAGE_OFF] : []),
    ...report.unmeasured.map(
      (runner) => `${runner} gives no coverage records: its pairs read unknown.`,
    ),
  ];
}

function routeLine(route: ReachRoute): string {
  const through = route.gateway === null ? "" : ` through ${route.gateway}`;
  return `${route.kind}${through}`;
}

/** The path kind with the most seconds. */
const mainKind = (entry: FileEntry) =>
  (Object.entries(entry.kinds) as [PathKind, number][]).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

function fileLines(entry: FileEntry, rank: number): string[] {
  const [first = ""] = entry.files;
  const name =
    entry.files.length === 1
      ? first
      : `${entry.files.length} files in ${entry.folder}/${entry.gateway === null ? ` (${mainKind(entry)})` : ` through ${entry.gateway.gateway}`}`;
  const each = entry.files.length === 1 ? "" : " (each)";
  const edits =
    entry.edits === 0
      ? "no edits in the window"
      : `${plural(entry.edits, "edit")} in the window re-ran ${secs(entry.editSeconds)}`;
  return [
    `  ${rank}. ${name}`,
    `     re-runs ${pct(entry.share)} of the suite${each}: ${plural(entry.testFiles, "test file")}, ${secs(entry.seconds)}; ${edits}`,
    `     coverage: ${splitText(entry.coverage)}; avoidable ${secs(entry.avoidableSeconds)}`,
    `     paths: ${splitText<PathKind>(entry.kinds)}`,
    ...(entry.gateway === null
      ? []
      : [
          `     gateway: ${routeLine(entry.gateway)}, for example ${chainText(entry.gateway.chain)}`,
        ]),
    ...(entry.suggestion === null ? [] : [`     suggestion: ${entry.suggestion.text}`]),
    ...(entry.note === undefined ? [] : [`     note: ${entry.note}`]),
  ];
}

function testLines(entry: TestEntry, rank: number): string[] {
  const name = entry.project === "" ? entry.path : `${entry.project}: ${entry.path}`;
  const calls = entry.called === null ? "calls unknown" : `calls ${entry.called}`;
  return [
    `  ${rank}. ${name}, ${entry.seconds === null ? "no recorded seconds" : secs(entry.seconds)}`,
    `     loads ${plural(entry.sources, "source file")} on import paths, ${calls}; ${plural(entry.edits, "edit")} in the window re-ran it`,
    ...(entry.via === null
      ? []
      : [`     most uncalled files come through ${entry.via.path} (${entry.via.uncalled})`]),
  ];
}

const more = (n: number) => (n === 0 ? [] : [`  … and ${n} more; --limit lists more.`]);

function proposalLines(proposal: Proposal, coverage: "on" | "off"): string[] {
  switch (proposal.kind) {
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
      return [
        `${pct(proposal.share)} of the suite's seconds (${plural(proposal.testFiles, "test file")}) have no coverage record at their current inputs, so their pairs read no record; ${proposal.command} re-runs every test file and records them, about one run of the whole suite.`,
      ];
  }
}

function namedLines(file: NamedFile): string[] {
  if (file.testFiles === 0) {
    return [`${file.path}: no test file of the suite re-runs on an edit of it.`];
  }
  return [
    `${file.path}: re-runs ${pct(file.share)} of the suite: ${plural(file.testFiles, "test file")}, ${secs(file.seconds)}; ${plural(file.edits, "edit")} in the window`,
    `  coverage: ${splitText<CoverageState>(file.coverage)}`,
    ...file.routes.flatMap((route) => [
      `  ${routeLine(route)}: ${plural(route.testFiles, "test file")}, ${secs(route.seconds)}; ${splitText<CoverageState>(route.coverage)}`,
      ...(route.chain.length === 0 ? [] : [`    chain: ${chainText(route.chain)}`]),
      ...route.tests.map(
        (t) =>
          `    ${t.path}  ${t.seconds === null ? "no recorded seconds" : secs(t.seconds)}  ${t.coverage}`,
      ),
    ]),
    ...(file.suggestion === null ? [] : [`  suggestion: ${file.suggestion.text}`]),
    ...(file.note === undefined ? [] : [`  note: ${file.note}`]),
  ];
}

export function formatReach(report: ReachReport): string {
  if (!report.history) {
    return `${report.proposals.flatMap((p) => proposalLines(p, report.coverage)).join("\n")}\n`;
  }
  const named = report.named;
  const body =
    named === undefined
      ? [
          "",
          "Files, by avoidable seconds per edit, then seconds re-run:",
          ...report.files.flatMap((e, i) => fileLines(e, i + 1)),
          ...more(report.moreFiles),
          "",
          "Test files, by avoidable seconds, then seconds re-run:",
          ...report.testFiles.flatMap((e, i) => testLines(e, i + 1)),
          ...more(report.moreTestFiles),
        ]
      : ["", ...named.flatMap(namedLines)];
  const proposals = report.proposals.flatMap((p) => proposalLines(p, report.coverage));
  return `${[...head(report), ...body, ...(proposals.length === 0 ? [] : ["", ...proposals])].join("\n")}\n`;
}
