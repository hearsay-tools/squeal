import { describe, expect, it } from "vitest";
import type { RunReport } from "../../../src/core/types/index.js";
import { openFixture, ref, SLOW } from "./helpers.js";

/*
 * Row 011-135 R1 (spec 011 C14, 013 V4): a run given texts for a file runs
 * only the checks whose full name holds one, on the installed Vitest 5, and
 * reports those alone: Vitest's `skipped` reports of the others are dropped.
 */

const FOUR = [
  'import { describe, expect, it, test } from "vitest";',
  'describe("parity", () => {',
  '  it("old 1", () => expect(1).toBe(1));',
  '  it("new 1", () => expect(1).toBe(2));',
  '  describe("inner", () => {',
  '    it("new 2", () => expect(1).toBe(1));',
  "  });",
  "});",
  'test("new 3 top", () => expect(1).toBe(1));',
  "",
].join("\n");

const FILE = ref("test/four.test.ts");
const OTHER = ref("test/math.test.ts");

const checks = (report: RunReport) => report.results.map((r) => [r.check.fullName, r.outcome]);

describe("vitest adapter: focused runs", SLOW, () => {
  it("runs and reports only the checks a text selects, the red one with its error", async () => {
    const fx = await openFixture("basic", { "test/four.test.ts": FOUR });
    expect(fx.adapter.focuses).toBe(true);
    const report = await fx.adapter.run(
      [FILE],
      fx.runOptions({ checks: [{ testFile: FILE, texts: ["new"] }] }),
    );

    expect(report.end).toBe("completed");
    expect(report.completedFiles).toEqual([FILE]);
    expect(checks(report)).toEqual([
      ["parity > new 1", "fail"],
      ["parity > inner > new 2", "pass"],
      ["new 3 top", "pass"],
    ]);
    expect(report.results[0]?.errors[0]?.message).toContain("expected 1 to be 2");
    expect(report.fileErrors).toEqual([]);
    expect(report.focused).toEqual([{ testFile: FILE, collected: 4, matched: 3 }]);
  });

  it("selects with a text holding ` > `, and with any of several texts", async () => {
    const fx = await openFixture("basic", { "test/four.test.ts": FOUR });
    const nested = await fx.adapter.run(
      [FILE],
      fx.runOptions({ checks: [{ testFile: FILE, texts: ["parity > inner > new"] }] }),
    );
    expect(checks(nested)).toEqual([["parity > inner > new 2", "pass"]]);
    expect(nested.focused).toEqual([{ testFile: FILE, collected: 4, matched: 1 }]);

    const two = await fx.adapter.run(
      [FILE],
      fx.runOptions({ checks: [{ testFile: FILE, texts: ["parity > old", "3 top"] }] }),
    );
    expect(checks(two)).toEqual([
      ["parity > old 1", "pass"],
      ["new 3 top", "pass"],
    ]);
  });

  it("reports matched 0 and no result for a text that selects nothing", async () => {
    const fx = await openFixture("basic", { "test/four.test.ts": FOUR });
    // `parity new 1` is Vitest 4's join: on Vitest 5 it names no check, and the post-filter agrees.
    const report = await fx.adapter.run(
      [FILE],
      fx.runOptions({ checks: [{ testFile: FILE, texts: ["no such check", "parity new 1"] }] }),
    );

    expect(report.completedFiles).toEqual([FILE]);
    expect(report.results).toEqual([]);
    expect(report.fileErrors).toEqual([]);
    expect(report.focused).toEqual([{ testFile: FILE, collected: 4, matched: 0 }]);
  });

  it("reports the file-level error of a file that does not load", async () => {
    const fx = await openFixture("basic", {
      "test/four.test.ts": `throw new Error("cannot load");\n${FOUR}`,
    });
    const report = await fx.adapter.run(
      [FILE],
      fx.runOptions({ checks: [{ testFile: FILE, texts: ["new"] }] }),
    );

    expect(report.completedFiles).toEqual([FILE]);
    expect(report.results).toEqual([]);
    expect(report.fileErrors.map((e) => [e.testFile, e.errors[0]?.message])).toEqual([
      [FILE, "cannot load"],
    ]);
    expect(report.focused).toEqual([{ testFile: FILE, collected: 0, matched: 0 }]);
  });

  it("runs a file without texts whole, beside a focused file and after one", async () => {
    const fx = await openFixture("basic", { "test/four.test.ts": FOUR });
    const beside = await fx.adapter.run(
      [FILE, OTHER],
      fx.runOptions({ checks: [{ testFile: FILE, texts: ["old 1"] }] }),
    );
    expect(beside.completedFiles).toEqual([FILE, OTHER]);
    expect(beside.results.filter((r) => r.check.testPath === FILE.path).length).toBe(1);
    expect(beside.results.filter((r) => r.check.testPath === OTHER.path).length).toBeGreaterThan(0);
    expect(beside.focused).toEqual([{ testFile: FILE, collected: 4, matched: 1 }]);

    // The pattern was the specification's: the same instance's next run is whole.
    const whole = await fx.adapter.run([FILE], fx.runOptions());
    expect(checks(whole)).toEqual([
      ["parity > old 1", "pass"],
      ["parity > new 1", "fail"],
      ["parity > inner > new 2", "pass"],
      ["new 3 top", "pass"],
    ]);
    expect(whole.focused).toBeUndefined();
  });
});
