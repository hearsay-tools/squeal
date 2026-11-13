import type { TestFileRef } from "../../src/core/types/keys.js";
import type { RunnerTraits } from "../../src/core/types/runner-traits.js";

/*
 * The columns of the runner traits table (row 011-329): a holder's eight
 * answers at fixed files and a grant of 8, read as the scheduler reads them.
 */

export const A: TestFileRef = { project: "", path: "test/a.test.ts" };
export const B: TestFileRef = { project: "", path: "test/b.test.ts" };

/** The eight answers of `traits` for `file`: three slow files led by it, a grant of 8. */
export function answers(traits: RunnerTraits, file: TestFileRef = A) {
  return {
    omitted: traits.omittedTestFiles(),
    slowWidth: traits.slowWidth([file, B, file]),
    tierWidth: traits.tierWidth(file, 8),
    tierPart: traits.tierPart(file),
    besideBacklog: traits.besideBacklog(file),
    backlogSlot: traits.backlogSlot(file),
    focuses: traits.focuses(file),
    lane: traits.lane(file),
  };
}

/** Every default (`NO_TRAITS`). */
export const DEFAULTS: ReturnType<typeof answers> = {
  omitted: 0,
  slowWidth: 3,
  tierWidth: 8,
  tierPart: "",
  besideBacklog: false,
  backlogSlot: null,
  focuses: false,
  lane: "",
};

/** A Vitest width table: project `""` at most 2 workers, one group (`WidthTable`). */
export const VITEST_TABLE = { projects: [{ project: "", ceiling: 2, floor: 1, group: 0 }] };
