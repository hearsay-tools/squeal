import type { CoverageState, PathKind } from "../core/reach/pairs.js";
import type {
  FileEntry,
  NamedFile,
  ReachReport,
  ReachRoute,
  Split,
  TestEntry,
} from "../core/reach/report-types.js";
import { chainText } from "../core/reach/suggest.js";
import { plural } from "../core/text.js";
import type { EpochMs } from "../core/types/common.js";
import { proposalLines } from "./reach-proposals.js";

/*
 * Spec 015 D11: the human rendering of `squeal reach`. Every number is
 * relative to this repository's own suite, seconds and edits.
 */

const pct = (share: number) => (share > 0 && share < 0.005 ? "<1%" : `${Math.round(share * 100)}%`);
const secs = (s: number) => `${s < 10 ? Math.round(s * 10) / 10 : Math.round(s)} s`;
const day = (at: EpochMs) => new Date(at).toISOString().slice(0, 10);

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
      ? "Edits: none recorded of files this worktree has (watch revisions in which HEAD did not move)."
      : `Edits: ${window.edits} from ${day(window.from)} to ${day(window.to)}, every worktree's watch revisions in which HEAD did not move, of files this worktree has.`,
    ...(report.absent === 0
      ? []
      : [
          `${plural(report.absent, "path")} with no bytes in this worktree ${report.absent === 1 ? "is" : "are"} left out of the lists: files of other worktrees or commits, or paths tests look for at run time.`,
        ]),
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
          // 015-116 (P2): only Vitest walks are counted, and a run is not what reads them again under lookup-only.
          `${plural(report.notRecorded, "pair")} read import, path not recorded yet: Squeal stored no complete walk of their test files' imports at the current inputs; the daemon stores one when it reads those imports again.`,
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

/** `src/a.ts`, or `11 files in src/core/types/ through src/core/types/index.ts`. */
function entryName(entry: FileEntry): string {
  const [first = ""] = entry.files;
  if (entry.files.length === 1) return first;
  const via = entry.gateway === null ? ` (${entry.kind})` : ` through ${entry.gateway.gateway}`;
  return `${entry.files.length} files in ${entry.folder}/${via}`;
}

/** What the order counts: avoidable seconds, and import seconds whose coverage is unknown (015-116, P8). */
function ordered(entry: FileEntry): string {
  const unknown = `on import paths with called unknown ${secs(entry.unknownSeconds)}`;
  if (entry.unknownSeconds === 0) return `avoidable ${secs(entry.avoidableSeconds)}`;
  if (entry.avoidableSeconds === 0) return unknown;
  return `avoidable ${secs(entry.avoidableSeconds)}, ${unknown}`;
}

function advice(entry: FileEntry | NamedFile, indent: string): string[] {
  return [
    ...(entry.second === null
      ? []
      : [
          `${indent}second gateway: ${entry.second.gateway}`,
          `${indent}suggestion: ${entry.second.suggestion.text}`,
        ]),
    ...(entry.suggestion === null ? [] : [`${indent}suggestion: ${entry.suggestion.text}`]),
    ...(entry.note === undefined ? [] : [`${indent}note: ${entry.note}`]),
  ];
}

function fileLines(entry: FileEntry): string[] {
  const each = entry.files.length === 1 ? "" : " (each)";
  const edits =
    entry.edits === 0
      ? "no edits in the window"
      : `${plural(entry.edits, "edit")} in the window re-ran ${secs(entry.editSeconds)}`;
  return [
    `  ${entry.rank}. ${entryName(entry)}`,
    `     re-runs ${pct(entry.share)} of the suite${each}: ${plural(entry.testFiles, "test file")}, ${secs(entry.seconds)}; ${edits}`,
    `     coverage: ${splitText(entry.coverage)}; ${ordered(entry)}`,
    `     paths: ${splitText<PathKind>(entry.kinds)}`,
    ...(entry.gateway === null
      ? []
      : [
          `     gateway: ${routeLine(entry.gateway)}, for example ${chainText(entry.gateway.chain)}`,
        ]),
    ...advice(entry, "     "),
  ];
}

/** 015-118: the second list, short: what the window's edits re-ran, and where the entry ranks above. */
function editLines(entry: FileEntry, at: number): string[] {
  const each = entry.files.length === 1 ? "each" : "each file";
  return [
    `  ${at}. ${entryName(entry)}: ${plural(entry.edits, "edit")} re-ran ${secs(entry.editSeconds)}, ${secs(entry.seconds)} ${each}; ${ordered(entry)}; rank ${entry.rank} above`,
    ...advice(entry, "     "),
  ];
}

function editsPart(report: ReachReport): string[] {
  const title = "Files, by seconds re-run over the window's edits";
  if (report.window === null) return [`${title}: none ranked, because no edits are recorded yet.`];
  if (report.byEdits.length === 0) {
    return [`${title}: none; no edit in the window changed a file that a test re-runs on.`];
  }
  return [
    `${title}:`,
    ...report.byEdits.flatMap((e, i) => editLines(e, i + 1)),
    ...more(report.moreByEdits),
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

/** `… and 3 more`, or of a named thing, `… and 1 more route`. */
const more = (n: number, noun?: string) => {
  const what = noun === undefined ? "" : ` ${noun}${n === 1 ? "" : "s"}`;
  return n === 0 ? [] : [`  … and ${n} more${what}; --limit lists more.`];
};

/** The orders' titles, by what coverage can tell (015-116, P8 and P12). */
function titles(report: ReachReport): { readonly files: string; readonly tests: string } {
  if (report.coverage === "off") {
    return {
      files:
        "Files, by seconds re-run on import paths per edit (called is unknown), then seconds re-run:",
      tests:
        "Test files, by pair-seconds on import paths (seconds times the source files they load; called is unknown), then seconds re-run:",
    };
  }
  const some = report.unmeasured.length > 0;
  return {
    files: `Files, by avoidable seconds per edit${some ? ", or seconds on import paths where called is unknown" : ""}, then seconds re-run:`,
    tests: `Test files, by avoidable pair-seconds (seconds times the source files they load on import paths and never call${some ? ", or every one where called is unknown" : ""}), then seconds re-run:`,
  };
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
      ...more(route.moreTests, "test file").map((line) => `  ${line}`),
    ]),
    ...more(file.moreRoutes, "route"),
    ...advice(file, "  "),
  ];
}

export function formatReach(report: ReachReport): string {
  if (!report.history) {
    return `${report.proposals.flatMap((p) => proposalLines(p, report.coverage)).join("\n")}\n`;
  }
  const named = report.named;
  const title = titles(report);
  const body =
    named === undefined
      ? [
          "",
          title.files,
          ...report.files.flatMap(fileLines),
          ...more(report.moreFiles),
          "",
          ...editsPart(report),
          "",
          title.tests,
          ...report.testFiles.flatMap((e, i) => testLines(e, i + 1)),
          ...more(report.moreTestFiles),
        ]
      : ["", ...named.flatMap(namedLines)];
  const proposals = report.proposals.flatMap((p) => proposalLines(p, report.coverage));
  return `${[...head(report), ...body, ...(proposals.length === 0 ? [] : ["", ...proposals])].join("\n")}\n`;
}
