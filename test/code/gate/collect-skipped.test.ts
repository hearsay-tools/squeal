import { describe, expect, it } from "vitest";
import { collectEvidence } from "../../../src/core/code/gate/collect.js";
import { evaluate } from "../../../src/core/code/gate/evaluate.js";
import { ADAPTERS, changedSet, project, SLOW } from "./collect-fixture.js";
import { POLICY, TIMES, VERSIONS } from "./evaluate-fixture.js";

/*
 * Spec 020 D11.3 (row 020-07a): the gate adopts 015 D9's rule for skipped
 * tests. A loader with a skipped test may have run the function in that
 * test, so its record proves a pass and never a violation: a function at
 * 0% there reads `incomplete` with the gap `skipped`.
 */

describe("a gate run whose loader skipped a test (spec 020 D11.3)", () => {
  it("reads the function incomplete (skipped), not a violation", SLOW, async () => {
    const root = project("selection");
    const changed = await changedSet(root, ["src/skips.ts"]);
    const evidence = await collectEvidence(root, changed, {
      tests: [],
      budgetSeconds: 600,
      adapters: ADAPTERS,
    });
    expect(evidence.testFiles.map((f) => [f.path, f.completed, f.skipped, f.failed])).toEqual([
      ["test/skips.test.ts", true, true, []],
    ]);
    const report = evaluate(changed, evidence, POLICY, VERSIONS, TIMES);
    expect(report.functions.map((f) => [f.qualifiedName, f.state, f.gap, f.crap])).toEqual([
      ["grade", "incomplete", "skipped", 42],
    ]);
    expect(report.verdict).toBe("incomplete");
  });
});
