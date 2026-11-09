import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { countFile } from "../../../src/core/code/count/index.js";
import { joinCoverage } from "../../../src/core/code/crap/join.js";
import { type CollectOptions, collectEvidence } from "../../../src/core/code/gate/collect.js";
import type { TestFileEvidence } from "../../../src/core/code/gate/types.js";
import { ADAPTERS, changedSet, project, SLOW } from "./collect-fixture.js";

/*
 * Spec 020 D3.2 (row 020-03; research `quality-gate.md` Q5): one adapter
 * run per runner. A node:test project of `.ts` files, run by Node's own
 * type stripping, gives a record as Vitest does; with both runners loading
 * one source, each file keeps its own record of it.
 */

const OPTIONS: CollectOptions = { tests: [], budgetSeconds: 600, adapters: ADAPTERS };

const blobsOf = (file: TestFileEvidence | undefined, path: string) =>
  file?.record?.sources.filter((s) => s.path === path).map((s) => s.blob);

describe("collectEvidence: node:test and Vitest", () => {
  it(
    "runs a changed node:test .ts file alone, and its record holds its callbacks",
    SLOW,
    async () => {
      const root = project("mixed");
      const path = "node/shared.test.ts";
      const changed = await changedSet(root, [path]);
      const evidence = await collectEvidence(root, changed, OPTIONS);
      expect(evidence.timedOut).toBe(false);
      expect(evidence.testFiles.map((f) => [f.runner, f.path, f.completed, f.failed])).toEqual([
        ["node-test", path, true, []],
      ]);
      const file = evidence.testFiles[0];
      expect(file?.loads).toEqual(expect.arrayContaining([path, "src/shared.ts"]));
      const own = file?.record?.sources.find((s) => s.path === path);
      expect(own?.blob).toBe(changed.counted[0]?.blob);

      const count = await countFile(readFileSync(join(root, path), "utf8"), "typescript");
      const joined = joinCoverage(count.functions, own === undefined ? [] : [own]);
      expect(count.functions.map((fn, i) => [fn.qualifiedName, joined[i]?.ran])).toEqual([
        ["twice", true],
        ["<test>", true],
      ]);
    },
  );

  it(
    "runs each runner's file that loads a changed source, each with its record",
    SLOW,
    async () => {
      const root = project("mixed");
      const changed = await changedSet(root, ["src/shared.ts"]);
      const blob = changed.counted[0]?.blob;
      const evidence = await collectEvidence(root, changed, OPTIONS);
      expect(evidence.timedOut).toBe(false);
      expect(evidence.testFiles.map((f) => [f.runner, f.path, f.completed, f.failed])).toEqual([
        ["vitest", "test/shared.test.ts", true, []],
        ["node-test", "node/shared.test.ts", true, []],
      ]);
      for (const file of evidence.testFiles) {
        expect(file.loads).toContain("src/shared.ts");
        expect(blobsOf(file, "src/shared.ts")).toEqual([blob]);
      }
    },
  );
});
