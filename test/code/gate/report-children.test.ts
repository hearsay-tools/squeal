import { describe, expect, it } from "vitest";
import { evaluate } from "../../../src/core/code/gate/evaluate.js";
import type { BasePolicy } from "../../../src/core/code/gate/policy.js";
import type { TestFileEvidence } from "../../../src/core/code/gate/types.js";
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
 * Spec 020 D12.7 (row 020-10b): with `coverage.children` at the base, the
 * report names the key in `base` and counts each run's child coverage
 * files. With the key off, it has neither key, as before.
 */

const run = fn("run", [1, 5], 2);
const PATHS = [{ path: "scripts/run.mjs", functions: [run], changed: ["run"] }];
const loaded = (path: string, runner: TestFileEvidence["runner"] = "vitest") =>
  testFile(path, ["scripts/run.mjs"], [source("scripts/run.mjs", [run])], { runner });

const report = (files: readonly TestFileEvidence[], policy: BasePolicy) =>
  evaluate(changedSet(PATHS), evidence(files), policy, VERSIONS, TIMES);

describe("the gate report with coverage.children (020 D12.7)", () => {
  it("names the key in base and sums the child files each run read and dropped", () => {
    const out = report(
      [
        { ...loaded("test/a.test.ts"), children: { read: 2, dropped: 0 } },
        { ...loaded("test/b.test.ts"), children: { read: 1, dropped: 1 } },
        // Read from the stores: its record holds its children, and this command read none.
        { ...loaded("test/c.test.ts"), fromStore: true },
        { ...loaded("test/n.test.mjs", "node-test"), children: { read: 0, dropped: 0 } },
      ],
      { ...POLICY, children: true },
    );

    expect(out.base.policy.coverageChildren).toBe(true);
    expect(out.runs.map((r) => [r.runner, r.children])).toEqual([
      ["vitest", { read: 3, dropped: 1 }],
      ["node-test", { read: 0, dropped: 0 }],
    ]);
    expect(out.verdict).toBe("pass");
  });

  it("adds neither key with the key off", () => {
    const out = report([loaded("test/a.test.ts")], POLICY);

    expect(Object.keys(out.base.policy)).toEqual([
      "complexityThreshold",
      "crapThreshold",
      "coverageExclude",
      "complexityInclude",
      "complexityExclude",
      "complexityMaxFileBytes",
    ]);
    expect(Object.keys(out.runs[0] ?? {})).toEqual([
      "runner",
      "selected",
      "completed",
      "notFinished",
      "failed",
      "durationMs",
    ]);
  });
});
