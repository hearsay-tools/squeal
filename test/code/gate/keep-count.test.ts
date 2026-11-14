import { describe, expect, it } from "vitest";
import { KeptTally } from "../../../src/core/code/gate/keep.js";
import { type Kept, keptCount } from "../../../src/core/code/gate/keep-write.js";
import type { CheckKey, TestFileRef } from "../../../src/core/types/keys.js";

/*
 * Spec 020 D17.5 as amended by row 020-68 (#220): after the keeper's last
 * pass, when a run completed a file, one line says how many completed
 * files are kept, how many while the runs went on, and what the next run
 * on the same bytes runs. The keeper tests check it after each pass.
 */

describe("row 020-68: the kept-count line", () => {
  it("counts kept and not-kept files, and the ones kept while the runs went on", () => {
    expect(keptCount({ kept: 145, completed: 478, early: 29 })).toBe(
      "145 of 478 completed test files are kept in the stores (29 while the runs went on); the next run on the same bytes runs the other 333",
    );
    expect(keptCount({ kept: 1, completed: 3, early: 0 })).toBe(
      "1 of 3 completed test files is kept in the stores; the next run on the same bytes runs the other 2",
    );
  });

  it("says so when every completed file is kept", () => {
    expect(keptCount({ kept: 478, completed: 478, early: 29 })).toBe(
      "all 478 completed test files are kept in the stores (29 while the runs went on); the next run on the same bytes reads them from the stores",
    );
    expect(keptCount({ kept: 1, completed: 1, early: 0 })).toBe(
      "the 1 completed test file is kept in the stores; the next run on the same bytes reads it from the stores",
    );
  });

  it("says the next run runs them all when none is kept", () => {
    expect(keptCount({ kept: 0, completed: 5, early: 0 })).toBe(
      "0 of 5 completed test files are kept in the stores; the next run on the same bytes runs all 5",
    );
    expect(keptCount({ kept: 0, completed: 1, early: 0 })).toBe(
      "0 of 1 completed test files are kept in the stores; the next run on the same bytes runs it",
    );
  });

  it("names the files a daemon may have kept apart (review 0.1.508 B1)", () => {
    expect(keptCount({ kept: 0, completed: 1, early: 0, unknown: 1 })).toBe(
      "0 of 1 completed test files are kept in the stores, and whether the daemon kept 1 of them is not known; the next run on the same bytes reads what was kept and runs the rest",
    );
    expect(keptCount({ kept: 3, completed: 6, early: 2, unknown: 1 })).toBe(
      "3 of 6 completed test files are kept in the stores (2 while the runs went on), and whether the daemon kept 1 of them is not known; the next run on the same bytes reads what was kept and runs the rest",
    );
    // No unknown file: the definite forms.
    expect(keptCount({ kept: 0, completed: 1, early: 0, unknown: 0 })).toBe(
      "0 of 1 completed test files are kept in the stores; the next run on the same bytes runs it",
    );
  });

  it("counts a file kept once a later pass wrote it, and an unknown one apart (review 0.1.508 B1)", () => {
    const file = (path: string) =>
      ({ ref: { project: "", path } as TestFileRef, key: `k-${path}` as CheckKey }) as Kept;
    const [a, b, c] = [file("test/a.test.ts"), file("test/b.test.ts"), file("test/c.test.ts")];
    const tally = new KeptTally();
    // An early pass: `a`'s write unknown. A later pass writes `a` and `b`; `c` unknown.
    tally.heard({ kept: [], unknown: [a] });
    expect([tally.kept, tally.unknown]).toEqual([0, 1]);
    tally.heard({ kept: [a, b], unknown: [c] });
    expect([tally.kept, tally.unknown]).toEqual([2, 1]);
    // A kept file stays kept, though a later try of it is unknown.
    tally.heard({ unknown: [a] });
    expect([tally.kept, tally.unknown]).toEqual([2, 1]);
  });
});
