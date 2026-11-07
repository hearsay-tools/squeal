import type { Analysis } from "./analyze.js";
import type { Proposal } from "./report-types.js";
import type { ReachSnapshot } from "./types.js";

/*
 * Spec 015 D11 "No history": what the report proposes. It never starts a
 * run or turns coverage on. A current result with no coverage record is
 * re-run only by a forced checkpoint: `run --all` and `run <group>` skip a
 * current file, and `retry` re-runs a failure (spec 001, checkpoint
 * requests), so the records proposal names `run --all --force`.
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
  if (!history) return [{ kind: "warmup", command: warmup, testFiles: listed }];
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
  const none = analysis.tests.filter((t) => t.test.coverage.kind === "none");
  if (none.length > 0) {
    const missing = none.reduce((s, t) => s + (t.test.seconds ?? 0), 0);
    out.push({
      kind: "records",
      command: `${command} run --all --force`,
      testFiles: none.length,
      share: seconds > 0 ? missing / seconds : 0,
    });
  }
  return out;
}
