import { describe, expect, it } from "vitest";
import { type CollectOptions, collectEvidence } from "../../../src/core/code/gate/collect.js";
import type { TestFileEvidence } from "../../../src/core/code/gate/types.js";
import { ADAPTERS, changedSet, project } from "./collect-fixture.js";

/*
 * Spec 020 D3.4 (row 020-03): one deadline over every run. A file that
 * never ends (a deterministic sleep, not host load) is stopped at the
 * deadline; the files that completed keep their records, a runner reached
 * after the deadline runs nothing, and the project's own `testTimeout`,
 * above the 6 s test here, is not lowered. D18 (row 020-19): the runners
 * run in ascending order of their estimate, so node:test's one quick file
 * is not left unrun behind Vitest's three, one of which never ends.
 */

/** Room for a loaded host to start node:test and Vitest and run the 6 s file. */
const BUDGET = 30;

/** The collector over the fixture under the budget, given the stores' `durations`: what it told and gave. */
async function collect(durations?: CollectOptions["durations"]) {
  const root = project("budget");
  const changed = await changedSet(root, ["src/a.ts"]);
  const told: { runners: string[]; estimates: string[] } = { runners: [], estimates: [] };
  const started = performance.now();
  const evidence = await collectEvidence(root, changed, {
    tests: [],
    budgetSeconds: BUDGET,
    adapters: ADAPTERS,
    ...(durations === undefined ? {} : { durations }),
    selected: (summary) => told.runners.push(...summary.runners.map((r) => r.runner)),
    estimated: (estimates) => told.estimates.push(...estimates.map((e) => e.runner)),
  });
  // The deadline ended it, not the 600 s sleep: Vitest's cancel grace is a few seconds.
  expect(performance.now() - started).toBeLessThan((BUDGET + 30) * 1000);
  expect(evidence.timedOut).toBe(true);
  expect(evidence.budgetSeconds).toBe(BUDGET);
  const blob = changed.counted[0]?.blob;
  const ownBlob = (file: TestFileEvidence) =>
    file.record?.sources.find((s) => s.path === "src/a.ts")?.blob;
  return { evidence, told, blob, ownBlob };
}

const summary = (files: readonly TestFileEvidence[]) =>
  files.map((f) => [f.runner, f.path, f.completed, f.failed]);

describe("collectEvidence: one budget over every run", () => {
  it("keeps the records of the files that finished, and names the rest", {
    timeout: 180_000,
  }, async () => {
    // The stores hold node:test's file as the longer run, so Vitest's runs first.
    const { evidence, told, blob, ownBlob } = await collect((ref) =>
      ref.path === "node/late.test.ts" ? 900 : 1,
    );
    expect(told).toEqual({ runners: ["vitest", "node-test"], estimates: ["vitest", "node-test"] });
    expect(summary(evidence.testFiles)).toEqual([
      ["vitest", "test/fast.test.ts", true, []],
      ["vitest", "test/patient.test.ts", true, []],
      ["vitest", "test/slow.test.ts", false, []],
      ["node-test", "node/late.test.ts", false, []],
    ]);
    const [fast, patient, slow, late] = evidence.testFiles;
    for (const done of [fast, patient]) expect(done && ownBlob(done)).toBe(blob);
    expect(slow?.record).toBeNull();
    expect(late?.record).toBeNull();
    // Its closure is known though it never ran: the evaluator reads it as not finished.
    expect(late?.loads).toContain("src/a.ts");
  });

  it("runs node:test's one file before Vitest's three with no store, so it completes", {
    timeout: 180_000,
  }, async () => {
    const { evidence, told, blob, ownBlob } = await collect();
    // With no stored duration, the runner with fewer files runs first, and is told first.
    expect(told).toEqual({ runners: ["node-test", "vitest"], estimates: ["node-test", "vitest"] });
    expect(evidence.estimates?.map((e) => [e.runner, e.seconds, e.files])).toEqual([
      ["node-test", null, 1],
      ["vitest", null, 3],
    ]);
    // The report's order stays Vitest first; only the runs' order changed.
    expect(summary(evidence.testFiles)).toEqual([
      ["vitest", "test/fast.test.ts", true, []],
      ["vitest", "test/patient.test.ts", true, []],
      ["vitest", "test/slow.test.ts", false, []],
      ["node-test", "node/late.test.ts", true, []],
    ]);
    const late = evidence.testFiles[3];
    expect(late && ownBlob(late)).toBe(blob);
  });
});
