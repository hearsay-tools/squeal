import { compare } from "../fs/compare.js";
import type { Analysis } from "./analyze.js";
import type { Proposal } from "./report-types.js";
import type { ReachSnapshot } from "./types.js";

/*
 * Spec 015 D11 "No history": what the report proposes. It never starts a
 * run or turns coverage on. A current result with no coverage record is
 * re-run only by a forced checkpoint: `run --all` and `run <group> <path>`
 * skip a current file, and `retry` refuses a passing one (spec 001,
 * checkpoint requests; 011 C5). A test file with no result at its inputs
 * is queued by `retry` (015-116, P7).
 */

/** The `squeal.config.json` keys that turn coverage on (`coverageOn` needs both). */
export const COVERAGE_KEY = '"coverage": { "enabled": true }';
export const COMPLEXITY_KEY = '"complexity": { "enabled": true }';

export function proposals(
  snapshot: ReachSnapshot,
  analysis: Analysis,
  history: boolean,
  { command, listed }: { readonly command: string; readonly listed: number | null },
): Proposal[] {
  const warmup = `${command} warmup`;
  if (!history) {
    // 015-116 (P9): with no listing, the start's lookups may find every result; the warm-up's cost waits for them.
    if (listed === null) {
      const runsMissing = snapshot.onStart === "lookup-then-run-missing";
      return [{ kind: "start", command: `${command} start`, runsMissing }];
    }
    return [{ kind: "warmup", command: warmup, testFiles: listed }];
  }
  const out: Proposal[] = [];
  const { withoutSeconds, seconds } = analysis.suite;
  if (withoutSeconds > 0) out.push({ kind: "seconds", command: warmup, testFiles: withoutSeconds });
  const { coverage } = snapshot;
  if (!coverage.on) {
    const keys = [
      ...(coverage.coverageEnabled ? [] : [COVERAGE_KEY]),
      ...(coverage.complexityEnabled ? [] : [COMPLEXITY_KEY]),
    ];
    out.push({ kind: "coverage", keys, command: warmup });
    return out;
  }
  // A test file with no recorded seconds is the seconds proposal's; its pairs weigh nothing here.
  const none = analysis.tests
    .map((t) => t.test)
    .filter((t) => t.coverage.kind === "none" && t.seconds !== null);
  if (none.length > 0) {
    const missing = none.reduce((s, t) => s + (t.seconds ?? 0), 0);
    const paths = (current: boolean) => [
      ...new Set(none.filter((t) => t.current === current).map((t) => t.ref.path)),
    ];
    out.push({
      kind: "records",
      command: `${command} run --all --force`,
      retry: `${command} retry`,
      testFiles: none.length,
      share: seconds > 0 ? missing / seconds : 0,
      current: paths(true).sort(compare),
      noResult: paths(false).sort(compare),
    });
  }
  return out;
}
