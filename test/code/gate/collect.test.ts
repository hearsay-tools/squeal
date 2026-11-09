import { describe, expect, it } from "vitest";
import { collectEvidence } from "../../../src/core/code/gate/collect.js";
import { gitHashObject } from "../../hash/git-repo.js";
import { changedSet, project, SLOW } from "./collect-fixture.js";

/*
 * Spec 020 D3 (row 020-03): the one-shot collector selects the test files
 * whose import closure loads a changed source, runs them with Squeal's
 * coverage provider and no daemon, and keeps each completed file's record.
 */

const BUDGET = 600;

describe("collectEvidence: selection (spec 020 D3.1)", () => {
  it(
    "runs only the test file that loads the changed source, and its record holds it",
    SLOW,
    async () => {
      const root = project("selection");
      const evidence = await collectEvidence(root, await changedSet(root, ["src/changed.ts"]), {
        tests: [],
        budgetSeconds: BUDGET,
      });
      expect(evidence.timedOut).toBe(false);
      expect(evidence.budgetSeconds).toBe(BUDGET);
      expect(evidence.testFiles.map((f) => [f.runner, f.path, f.completed])).toEqual([
        ["vitest", "test/loads.test.ts", true],
      ]);
      const [file] = evidence.testFiles;
      expect(file?.failed).toEqual([]);
      expect(file?.loads).toContain("src/changed.ts");
      const source = file?.record?.sources.find((s) => s.path === "src/changed.ts");
      expect(source?.blob).toBe(gitHashObject(root, "src/changed.ts"));
    },
  );
});
