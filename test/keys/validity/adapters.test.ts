import { describe, expect, it } from "vitest";
import { failures } from "./compare.js";
// The validity path's entries, statically, so a change to one re-runs this file (`compare.test.ts`).
import "./driver.js";
import { comparisons, edited, only, SLOW } from "./self-test.js";

/*
 * Risk 3 of task 011-37 (design section 6): runner code that runs and
 * reports a test is no global entry's, so each adapter is compared under
 * its own version (011 C14, row 011-41), its scheduling hints left out.
 */

const { compare, release } = comparisons();

const fired = (result: Awaited<ReturnType<typeof compare>>) =>
  result.alarms.filter((a) => a.fired).map((a) => a.component.name);

describe("each adapter's comparison (risk 3)", SLOW, () => {
  it("fails Vitest's alone when its results read a skipped test as a pass", async () => {
    const result = await compare(
      edited("src/runners/vitest/results.ts", 'skipped: "skip",', 'skipped: "pass",'),
      only("adapter:vitest", "rows"),
    );
    expect(fired(result)).toEqual(["vitest"]);
    const differing = result.cases.filter((c) => !c.outputsEqual).map((c) => c.name);
    expect(differing).toEqual([
      "a touched module withholds the files that reach it (013-01 test 2)",
      "a module only another project loaded withholds none of this project's files (013-01 test 4)",
    ]);
    const failed = failures(result, release());
    expect(failed).toHaveLength(2);
    for (const line of failed)
      expect(line).toMatch(/^adapter:vitest case .* raise VITEST_ADAPTER_VERSION/);
  });

  it("fires none for a change to Vitest's width hints", async () => {
    const result = await compare(
      edited(
        "src/runners/vitest/width.ts",
        "const width = Math.max(2, Math.floor(want));",
        "const width = Math.max(3, Math.floor(want));",
      ),
      [],
    );
    expect(result.fired).toBe(false);
    expect(failures(result, release())).toEqual([]);
  });
});
