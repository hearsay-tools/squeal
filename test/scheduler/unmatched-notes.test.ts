import { describe, expect, it } from "vitest";
import { unmatchedInputNotes } from "../../src/core/scheduler/notes.js";

describe("unmatchedInputNotes", () => {
  const unmatched = { testGlobs: ["math.test.ts"], inputGlobs: ["fixture/*.json"] };

  it("names keys that match no test file when test files are listed", () => {
    expect(unmatchedInputNotes(unmatched, 3)).toHaveLength(2);
  });

  /*
   * Lessons defect 13 probe: a daemon started before `npm ci` lists no test
   * file, and must not report every inputs key as matching none.
   */
  it("says nothing about keys while no test file is listed", () => {
    expect(unmatchedInputNotes(unmatched, 0)).toEqual([
      'squeal.config.json: inputs glob "fixture/*.json" matches no file',
    ]);
  });
});
