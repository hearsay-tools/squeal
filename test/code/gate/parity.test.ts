import { describe, expect, it } from "vitest";
import { readSummary } from "../../../src/core/code/crap/summary.js";
import { evaluate } from "../../../src/core/code/gate/evaluate.js";
import type { TestFileEvidence } from "../../../src/core/code/gate/types.js";
import type { FunctionCount } from "../../../src/core/types/code.js";
import { WT } from "../../state/helpers.js";
import { coverageRig, type LoaderSpec, sourceOf } from "../crap/rig.js";
import {
  changedSet,
  evidence,
  fn,
  POLICY,
  source,
  TIMES,
  testFile,
  VERSIONS,
} from "./evaluate-fixture.js";

/*
 * Spec 020 D11 (row 020-07a): the survey's parity table
 * (`research/probes/daemon-parity/parity.mts`) as golden tests. Each case
 * gives the same evidence in hand to the gate's `evaluate()` and to the
 * daemon's coverage step, and both read one rule (`gate/rule.ts`). A gate
 * state reads as the daemon's `crap` outcome: `pass` and `violation` as
 * `pass` and `fail`, `incomplete` as `unknown` with its gap. The daemon
 * reads its `crap` state, or, with none, its file's condition.
 */

const PATH = "src/a.ts";

/** One case: the function's CC, and its loaders as each path gets them. */
interface Case {
  readonly name: string;
  readonly cc: number;
  readonly gate: (f: FunctionCount) => TestFileEvidence[];
  readonly daemon: (blob: string) => Record<string, LoaderSpec>;
  /** The agreed `crap` reading; the daemon's own when D11.2 makes it differ. */
  readonly crap: string;
  readonly daemonCrap?: string;
  /** The daemon's `uncovered` reading. */
  readonly uncovered: string;
}

const ran = (blob: string): LoaderSpec => ({
  closure: [PATH],
  record: [sourceOf(PATH, blob, 1, [1])],
});
const ranNone = (blob: string): LoaderSpec => ({
  closure: [PATH],
  record: [sourceOf(PATH, blob, 1, [])],
});
/** A test file that loads nothing of the case, so the worktree has test files listed. */
const OTHER = { "test/other.test.ts": { closure: ["src/other.ts"] } };

const CASES: readonly Case[] = [
  {
    name: "A: no test file loads the source, CC 3",
    cc: 3,
    gate: () => [],
    daemon: () => OTHER,
    crap: "unknown (no-loader)",
    uncovered: "unknown (no-loader)",
  },
  {
    name: "A: no test file loads the source, CC 7",
    cc: 7,
    gate: () => [],
    daemon: () => OTHER,
    crap: "unknown (no-loader)",
    uncovered: "unknown (no-loader)",
  },
  {
    // D11.2: a failed test is a gate input only; the daemon tells it as a test.
    name: "B: a loader ran it, and a test failed",
    cc: 7,
    gate: (f) => [testFile("test/a.test.ts", [PATH], [source(PATH, [f])], { failed: ["t1"] })],
    daemon: (blob) => ({ "test/a.test.ts": { ...ran(blob), outcomes: ["pass", "fail"] } }),
    crap: "unknown (test-failed)",
    daemonCrap: "pass 7",
    uncovered: "pass",
  },
  {
    // D11.3 and 015-78: the records in hand prove a pass beside a skipped test.
    name: "C: a loader ran it, beside one that skipped a test",
    cc: 7,
    gate: (f) => [
      testFile("test/a.test.ts", [PATH], [source(PATH, [f])]),
      testFile("test/b.test.ts", [PATH], [source(PATH, [f], { ran: [] })], { skipped: true }),
    ],
    daemon: (blob) => ({
      "test/a.test.ts": ran(blob),
      "test/b.test.ts": { ...ranNone(blob), outcomes: ["pass", "skip"] },
    }),
    crap: "pass 7",
    uncovered: "pass",
  },
  {
    // D11.3: they never prove a violation.
    name: "C2: its loaders ran none of it, and one skipped a test",
    cc: 7,
    gate: (f) => [
      testFile("test/a.test.ts", [PATH], [source(PATH, [f], { ran: [] })]),
      testFile("test/b.test.ts", [PATH], [source(PATH, [f], { ran: [] })], { skipped: true }),
    ],
    daemon: (blob) => ({
      "test/a.test.ts": ranNone(blob),
      "test/b.test.ts": { ...ranNone(blob), outcomes: ["pass", "skip"] },
    }),
    crap: "unknown (skipped)",
    uncovered: "unknown (skipped)",
  },
  {
    name: "E: its loader ran none of it",
    cc: 7,
    gate: (f) => [testFile("test/a.test.ts", [PATH], [source(PATH, [f], { ran: [] })])],
    daemon: (blob) => ({ "test/a.test.ts": ranNone(blob) }),
    crap: "fail 56",
    uncovered: "fail",
  },
];

/** The gate's reading of the case's function, in the daemon's words. */
function gateReads(c: Case): string {
  const f = fn("work", [1, 10], c.cc);
  const report = evaluate(
    changedSet([{ path: PATH, functions: [f], changed: ["work"] }]),
    evidence(c.gate(f)),
    POLICY,
    VERSIONS,
    TIMES,
  );
  const [row] = report.functions;
  if (row === undefined) return "absent";
  const state =
    row.state === "pass"
      ? "pass"
      : row.state === "violation"
        ? "fail"
        : row.state === "incomplete"
          ? `unknown (${row.gap})`
          : row.state;
  const judged = row.state === "pass" || row.state === "violation";
  return judged && row.crap !== null ? `${state} ${row.crap}` : state;
}

/** The daemon's `crap` and `uncovered` readings of the case's function after one step. */
async function daemonReads(c: Case): Promise<{ crap: string; uncovered: string }> {
  const rig = coverageRig();
  await rig.edit({ [PATH]: `work ${c.cc} w1\n` });
  const blob = rig.store.files.list(WT, [PATH])[0]?.blob ?? "";
  for (const [path, spec] of Object.entries(c.daemon(blob))) rig.loader(path, spec);
  rig.step();
  const file = readSummary(rig.store.meta, WT)?.files[PATH];
  const condition = file?.state === "unknown" ? `unknown (${file.cause})` : `${file?.state}`;
  const reading = (measure: "crap" | "uncovered") => {
    const [state] = rig.store.states.list(WT, { paths: [PATH], measure });
    if (state === undefined || state.outcome === "unknown") return condition;
    return state.value === null ? state.outcome : `${state.outcome} ${state.value}`;
  };
  return { crap: reading("crap"), uncovered: reading("uncovered") };
}

describe("one rule for the daemon and the gate (spec 020 D11, the survey's parity table)", () => {
  it.each(CASES)("$name", async (c) => {
    expect(gateReads(c)).toBe(c.crap);
    expect(await daemonReads(c)).toEqual({ crap: c.daemonCrap ?? c.crap, uncovered: c.uncovered });
  });
});
