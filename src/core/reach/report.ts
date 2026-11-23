import { compare } from "../fs/compare.js";
import type { RelativePath } from "../types/common.js";
import { analyze } from "./analyze.js";
import { fileEntries, gatewayEntries, testEntries } from "./entries.js";
import { named, namedFiles, page } from "./named.js";
import { proposals } from "./proposals.js";
import { REACH_REPORT_VERSION, type ReachReport } from "./report-types.js";
import type { ReachSnapshot } from "./types.js";

/*
 * Spec 015 D11 "The report, with history": two parts ranked by avoidable
 * seconds per edit, then by reach seconds, and the files again by the
 * seconds the window's edits re-ran (015-118), led by the gateways those
 * edits went through (row 015-128). `entries.ts` builds the entries,
 * `gateways.ts` the gateways, `named.ts` the named files.
 */

export interface ReportOptions {
  /** Named files or folders, given in full; `null` for the ranked parts only. */
  readonly paths: readonly RelativePath[] | null;
  /** Entries per list, and routes and test files per named file; `null` for every one. */
  readonly limit: number | null;
  /** Entries each list and each named route's test files skip first (row 015-129); `0` by default. */
  readonly offset?: number;
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
  const gateways = history ? gatewayEntries(analysis) : [];
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const offset = options.offset ?? 0;
  const [gatewayPage, moreGateways] = page(gateways, offset, limit);
  const [filePage, moreFiles] = page(files, offset, limit);
  const [editPage, moreByEdits] = page(byEdits, offset, limit);
  const [testPage, moreTestFiles] = page(tests, offset, limit);
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
        : {
            from: Math.min(...times),
            to: Math.max(...times),
            edits: times.length,
            rerunSeconds: analysis.rerunSeconds,
          },
    stale: snapshot.stale ?? null,
    coverage: snapshot.coverage.on ? "on" : "off",
    unmeasured: [...new Set(unmeasured)].sort(compare),
    edges: snapshot.graph !== null,
    notRecorded: [...analysis.files.values()].reduce((n, f) => n + f.notRecorded, 0),
    absent,
    offset,
    totalGateways: gateways.length,
    totalFiles: files.length,
    totalByEdits: byEdits.length,
    totalTestFiles: tests.length,
    gateways: gatewayPage,
    moreGateways,
    files: filePage,
    moreFiles,
    byEdits: editPage,
    moreByEdits,
    testFiles: testPage,
    moreTestFiles,
    ...(options.paths === null || !history
      ? {}
      : { named: namedFiles(analysis, snapshot, options.paths, limit, offset) }),
    proposals: proposals(snapshot, analysis, history, options),
  };
}

const RUNNER_NAMES = { vitest: "Vitest", nodeTest: "node:test", pytest: "pytest" } as const;
