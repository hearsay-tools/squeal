import { describe, expect, it } from "vitest";
import { collectEvidence } from "../../../src/core/code/gate/collect.js";
import { ADAPTERS, changedSet, project } from "./collect-fixture.js";

/*
 * Spec 020 D3.4 (row 020-03): one deadline over every run. A file that
 * never ends (a deterministic sleep, not host load) is stopped at the
 * deadline; the files that completed keep their records, a runner reached
 * after the deadline runs nothing, and the project's own `testTimeout`,
 * above the 6 s test here, is not lowered.
 */

/** Room for a loaded host to start Vitest and run the 6 s file. */
const BUDGET = 25;

describe("collectEvidence: one budget over every run", () => {
  it("keeps the records of the files that finished, and names the rest", {
    timeout: 180_000,
  }, async () => {
    const root = project("budget");
    const changed = await changedSet(root, ["src/a.ts"]);
    const blob = changed.counted[0]?.blob;
    const started = performance.now();
    const evidence = await collectEvidence(root, changed, {
      tests: [],
      budgetSeconds: BUDGET,
      adapters: ADAPTERS,
    });
    // The deadline ended it, not the 600 s sleep: Vitest's cancel grace is a few seconds.
    expect(performance.now() - started).toBeLessThan((BUDGET + 30) * 1000);
    expect(evidence.timedOut).toBe(true);
    expect(evidence.budgetSeconds).toBe(BUDGET);
    expect(evidence.testFiles.map((f) => [f.runner, f.path, f.completed, f.failed])).toEqual([
      ["vitest", "test/fast.test.ts", true, []],
      ["vitest", "test/patient.test.ts", true, []],
      ["vitest", "test/slow.test.ts", false, []],
      ["node-test", "node/late.test.ts", false, []],
    ]);
    const [fast, patient, slow, late] = evidence.testFiles;
    for (const done of [fast, patient]) {
      expect(done?.record?.sources.find((s) => s.path === "src/a.ts")?.blob).toBe(blob);
    }
    expect(slow?.record).toBeNull();
    expect(late?.record).toBeNull();
    // Its closure is known though it never ran: the evaluator reads it as not finished.
    expect(late?.loads).toContain("src/a.ts");
  });
});
