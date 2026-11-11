import { describe, expect, it } from "vitest";
import {
  gate,
  listing,
  READS,
  recorded,
  SLOW,
  sameApartFromSource,
} from "./code-gate-parts-kit.js";

/*
 * Spec 020 D13.2 (row 020-08b): `squeal code --base <ref> --parts <dir>...`
 * takes a selected test file's evidence from `squeal ci record`'s parts when
 * the part certifies every input of its closure here and its record is this
 * Squeal's, and runs every other file. Its report is the report of a gate
 * that ran the tests, apart from where each file's evidence came from and
 * the times. `test/reads.test.ts` reads a file at run time, outside every
 * import graph: the part's observed reads certify it.
 */

/** In its `=` form: spec 010 D4's rule reads a list that starts with a bare `--test` as node's. */
const TESTS = ["--test=test/reads.test.ts"];

describe("squeal code --base --parts (spec 020 D13.2)", () => {
  it(
    "gives the report a run gives, with no run and nothing written to the parts",
    SLOW,
    async () => {
      const { root, parts } = await recorded(READS);
      const before = listing(parts);

      const fromParts = await gate(root, [...TESTS, "--parts", parts]);
      const fromRuns = await gate(root, TESTS);

      expect(fromParts.ran).toEqual([]);
      expect(fromRuns.ran).toEqual([
        "test/add.test.ts",
        "test/grade.test.ts",
        "test/reads.test.ts",
      ]);
      expect(fromParts.code).toBe(fromRuns.code);
      expect(sameApartFromSource(fromParts.report)).toEqual(sameApartFromSource(fromRuns.report));
      expect(fromParts.report.runs.map((r) => r.from)).toEqual([
        {
          "test/add.test.ts": "parts",
          "test/grade.test.ts": "parts",
          "test/reads.test.ts": "parts",
        },
      ]);
      expect(fromRuns.report.runs.map((r) => r.from)).toEqual([undefined]);
      // Review 0.1.432 B2: before any setup, the selection and the run are counted apart.
      expect(fromParts.stderr).toContain(
        "squeal code: Vitest: 3 test files selected (tests 3): none to run, 3 read from the parts\n",
      );
      expect(fromRuns.stderr).toContain("squeal code: Vitest: 3 test files to run (tests 3)\n");
      expect(fromParts.stderr).toContain("3 of 3 selected test files read from the parts");
      expect(listing(parts)).toEqual(before);
    },
  );
});
