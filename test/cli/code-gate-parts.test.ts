import { describe, expect, it } from "vitest";
import { gate, listing, recorded, SLOW, sameApartFromSource } from "./code-gate-parts-kit.js";

/*
 * Spec 020 D13.2 (row 020-08b): `squeal code --base <ref> --parts <dir>...`
 * takes a selected test file's evidence from `squeal ci record`'s parts when
 * the part certifies every input of its closure here and its record is this
 * Squeal's, and runs every other file. Its report is the report of a gate
 * that ran the tests, apart from where each file's evidence came from and
 * the times.
 */

describe("squeal code --base --parts (spec 020 D13.2)", () => {
  it(
    "gives the report a run gives, with no run and nothing written to the parts",
    SLOW,
    async () => {
      const { root, parts } = await recorded();
      const before = listing(parts);

      const fromParts = await gate(root, ["--parts", parts]);
      const fromRuns = await gate(root);

      expect(fromParts.ran).toEqual([]);
      expect(fromRuns.ran).toEqual(["test/add.test.ts", "test/grade.test.ts"]);
      expect(fromParts.code).toBe(fromRuns.code);
      expect(sameApartFromSource(fromParts.report)).toEqual(sameApartFromSource(fromRuns.report));
      expect(fromParts.report.runs.map((r) => r.from)).toEqual([
        { "test/add.test.ts": "parts", "test/grade.test.ts": "parts" },
      ]);
      expect(fromRuns.report.runs.map((r) => r.from)).toEqual([undefined]);
      // Review 0.1.432 B2: before any setup, the selection and the run are counted apart.
      expect(fromParts.stderr).toContain(
        "squeal code: Vitest: 2 test files selected (tests 2): none to run, 2 read from the parts\n",
      );
      expect(fromRuns.stderr).toContain("squeal code: Vitest: 2 test files to run (tests 2)\n");
      expect(fromParts.stderr).toContain("2 of 2 selected test files read from the parts");
      expect(listing(parts)).toEqual(before);
    },
  );
});
