import { describe, expect, it } from "vitest";
import { failures, reportedChanges } from "./compare.js";
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

  const withholding = (kept: string) =>
    edited(
      "src/runners/vitest/moved.ts",
      "const kept = (ref: TestFileRef) => !gone.has(refKey(ref));",
      `const kept = (_ref: TestFileRef) => ${kept};`,
    );

  it("fails Vitest's when it withholds a file the last release completed", async () => {
    const result = await compare(withholding("false"), only("adapter:vitest"));
    const failed = failures(result, release());
    expect(failed).toEqual([
      expect.stringMatching(
        /^adapter:vitest case "a touched module withholds .*run 1, :test\/slow2\.test\.ts: completed at the last release, withheld at the candidate; .* raise VITEST_ADAPTER_VERSION/,
      ),
      expect.stringMatching(
        /^adapter:vitest case "a module only another project loaded .*run 1, a:a\/test\/held\.test\.ts: completed at the last release, withheld at the candidate\).* raise VITEST_ADAPTER_VERSION/,
      ),
    ]);
  });

  it("reports a file Vitest's completes that the last release withheld, without failing", async () => {
    const result = await compare(withholding("true"), only("adapter:vitest"));
    expect(result.cases.every((c) => c.outputsEqual)).toBe(true);
    expect(failures(result, release())).toEqual([]);
    const reported = reportedChanges(result);
    expect(reported).toContain(
      'adapter:vitest case "a touched module withholds the files that reach it (013-01 test 2)": run 1, :test/slow1.test.ts: withheld at the last release, completed at the candidate (the candidate stores more)',
    );
    for (const line of reported) expect(line).toMatch(/\(the candidate stores more\)$/);
  });

  it("fails Vitest's when the errors it reads change a stored fingerprint (review of cand/0.1.232, B1)", async () => {
    const result = await compare(
      edited(
        "src/runners/vitest/results.ts",
        'name: error.name ?? "Error",',
        'name: "ChangedAssertionKind",',
      ),
      only("adapter:vitest"),
    );
    expect(fired(result)).toEqual(["vitest"]);
    const differing = result.cases.filter((c) => !c.outputsEqual).map((c) => c.name);
    // Row 011-144's focused case stores the same kinds of failure, so it differs too.
    expect(differing).toEqual([
      "a failing test and a file that fails to load store their fingerprints (review of cand/0.1.232, B1)",
      "a focused run stores the selected checks' outcomes as a whole run does (row 011-144)",
    ]);
    // Row 011-175: the 011-137 case is equal because both trees stored its pass, not because both lost it.
    const whole = result.cases.find((c) => c.name.includes("(row 011-137)"));
    const kept = { runs: [{ completed: [":test/whole.test.ts"], results: [{ outcome: "pass" }] }] };
    expect([whole?.baseline.outputs, whole?.candidate.outputs]).toMatchObject([kept, kept]);
    const failed = failures(result, release());
    expect(failed).toEqual([
      expect.stringMatching(
        /^adapter:vitest case "a failing test .*:test\/broken\.test\.ts.*:test\/fails\.test\.ts.* raise VITEST_ADAPTER_VERSION/,
      ),
      expect.stringMatching(/^adapter:vitest case "a focused run .* raise VITEST_ADAPTER_VERSION/),
    ]);
  });

  it("passes a change to the errors' wording that keeps every fingerprint (review of cand/0.1.232, B1)", async () => {
    const result = await compare(
      edited(
        "src/runners/vitest/results.ts",
        "stack: error.stack ? paths.relativizeText(error.stack) : null,",
        "stack: null,",
      ),
      only("adapter:vitest"),
    );
    expect(fired(result)).toEqual(["vitest"]);
    expect(result.cases.every((c) => c.outputsEqual)).toBe(true);
    expect(failures(result, release())).toEqual([]);
  });

  it("fires none for a change to Vitest's width hints", async () => {
    const result = await compare(
      edited(
        "src/runners/vitest/width.ts",
        "const width = Math.max(floor, Math.floor(want));",
        "const width = Math.max(floor + 1, Math.floor(want));",
      ),
      [],
    );
    expect(result.fired).toBe(false);
    expect(failures(result, release())).toEqual([]);
  });
});
