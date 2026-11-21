import { compare } from "../fs/compare.js";
import type { RelativePath } from "../types/common.js";
import { analyze } from "./analyze.js";
import { fileEntries, testEntries } from "./entries.js";
import { named, namedFiles } from "./named.js";
import { proposals } from "./proposals.js";
import { REACH_REPORT_VERSION, type ReachReport } from "./report-types.js";
import type { ReachSnapshot } from "./types.js";

/*
 * Spec 015 D11 "The report, with history": two parts ranked by avoidable
 * seconds per edit, then by reach seconds, and the files again by the
 * seconds the window's edits re-ran (015-118). `entries.ts` builds the
 * entries, `named.ts` the named files.
 */

export interface ReportOptions {
  /** Named files or folders, given in full; `null` for the ranked parts only. */
  readonly paths: readonly RelativePath[] | null;
  /** Entries per list, and routes and test files per named file; `null` for every one. */
  readonly limit: number | null;
  /** How the text names the CLI (`statusCommand`). */
  readonly command: string;
  /** Test files the daemon listed; `null` when it listed none yet. */
  readonly listed: number | null;
}

export function buildReport(snapshot: ReachSnapshot, options: ReportOptions): ReachReport {
  const isNamed = options.paths === null ? () => false : named(options.paths);
  const analysis = analyze(snapshot, isNamed);
  const { suite } = analysis;
  const history = suite.testFiles > 0 && suite.withoutSeconds < suite.testFiles;
  const times = analysis.kept.map((e) => e.at);
  const { files, byEdits, absent } = history
    ? fileEntries(analysis, snapshot)
    : { files: [], byEdits: [], absent: 0 };
  const tests = history ? testEntries(analysis) : [];
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const unmeasured = snapshot.coverage.on
    ? analysis.tests
        .filter((t) => t.test.coverage.kind === "unknown")
        .map((t) => RUNNER_NAMES[t.test.runner])
    : [];
  return {
    v: REACH_REPORT_VERSION,
    history,
    suite,
    window:
      times.length === 0
        ? null
        : { from: Math.min(...times), to: Math.max(...times), edits: times.length },
    coverage: snapshot.coverage.on ? "on" : "off",
    unmeasured: [...new Set(unmeasured)].sort(compare),
    edges: snapshot.graph !== null,
    notRecorded: [...analysis.files.values()].reduce((n, f) => n + f.notRecorded, 0),
    absent,
    files: files.slice(0, limit),
    moreFiles: Math.max(0, files.length - limit),
    byEdits: byEdits.slice(0, limit),
    moreByEdits: Math.max(0, byEdits.length - limit),
    testFiles: tests.slice(0, limit),
    moreTestFiles: Math.max(0, tests.length - limit),
    ...(options.paths === null || !history
      ? {}
      : { named: namedFiles(analysis, snapshot, options.paths, limit) }),
    proposals: proposals(snapshot, analysis, history, options),
  };
}

const RUNNER_NAMES = { vitest: "Vitest", nodeTest: "node:test", pytest: "pytest" } as const;
