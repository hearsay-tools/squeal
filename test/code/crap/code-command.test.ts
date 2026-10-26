import { describe, expect, it } from "vitest";
import { formatCodeReport } from "../../../src/cli/code.js";
import { readCodeReport } from "../../../src/cli/code-report.js";
import { coverageChecks } from "../../../src/core/code/crap/index.js";
import { DEFAULT_POLICY } from "../../../src/core/types/index.js";
import { WT } from "../../state/helpers.js";
import { type CoverageRig, coverageRig, sourceOf } from "./rig.js";

/*
 * Spec 015 D9 (row 015-12): `squeal code` with coverage judged. With paths,
 * each function's CRAP and coverage; without, the functions over CRAP and
 * the number untested. Row 015-64: only the checks judged, and a file
 * `coverage.exclude` leaves out says so.
 */

const POLICY = { threshold: 20, maxFileBytes: 524_288 };

async function judged(): Promise<CoverageRig> {
  const rig = coverageRig();
  await rig.edit({ "src/a.ts": "hot 12 h1\ncold 6 c1\nbig 35 b1\n" });
  const blob = rig.store.files.list(WT, ["src/a.ts"])[0]?.blob ?? "";
  rig.loader("test/a.test.ts", {
    closure: ["src/a.ts"],
    record: [sourceOf("src/a.ts", blob, 3, [1, 3])],
  });
  rig.step();
  return rig;
}

const report = (rig: CoverageRig, paths: readonly string[] | null) =>
  readCodeReport(rig.main, rig.store, WT, POLICY, { paths, changed: false, shell: null });

describe("squeal code with coverage judged", () => {
  it("gives each function of a path its CRAP and who runs it", async () => {
    const rig = await judged();
    const read = report(rig, ["src/a.ts"]);
    expect(read.functions.map((f) => [f.qualifiedName, f.coverage])).toEqual([
      [
        "hot",
        {
          crap: { outcome: "pass", value: 12 },
          uncovered: "pass",
          lines: 1,
          covered: 1,
          testFiles: 1,
          first: ["test/a.test.ts"],
        },
      ],
      [
        "cold",
        {
          crap: { outcome: "fail", value: 42 },
          uncovered: "fail",
          lines: 1,
          covered: 0,
          testFiles: 0,
          first: [],
        },
      ],
      [
        "big",
        {
          crap: { outcome: "fail", value: 35 },
          uncovered: "pass",
          lines: 1,
          covered: 1,
          testFiles: 1,
          first: ["test/a.test.ts"],
        },
      ],
    ]);
    expect(formatCodeReport(read).split("\n").slice(1, 4)).toEqual([
      "  src/a.ts:1  hot  CC 12 (if 11), at or under; CRAP 12; 100% of its lines ran in 1 test file",
      "  src/a.ts:2  cold  CC 6 (if 5), at or under; CRAP 42, over; untested: no test runs it in its own process",
      "  src/a.ts:3  big  CC 35 (if 34), over since revision 1; CRAP 35, over; 100% of its lines ran in 1 test file",
    ]);
  });

  it("lists the functions over CRAP and counts those untested, without paths", async () => {
    const rig = await judged();
    const read = report(rig, null);
    expect(read.coverage).toMatchObject({ threshold: 30, uncovered: 1, notJudged: 0 });
    expect(read.coverage?.functions.map((f) => f.qualifiedName)).toEqual(["big", "cold"]);
    expect(formatCodeReport(read)).toContain(
      [
        "CRAP: 2 functions over 30; 1 function untested; squeal code <path> shows them by file",
        "  src/a.ts  big  CRAP 35, fail, since revision 1",
        "  src/a.ts  cold  CRAP 42, fail, since revision 1",
      ].join("\n"),
    );
  });

  it("has no coverage part before the coverage step judged here", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": "hot 12 h1\n" });
    const read = report(rig, null);
    expect("coverage" in read).toBe(false);
    expect(report(rig, ["src/a.ts"]).functions.every((f) => !("coverage" in f))).toBe(true);
  });

  it("shows only the checks judged once one is switched off (015-64)", async () => {
    const rig = await judged();
    const off = (crap: boolean, untested: boolean) =>
      coverageChecks({
        crap: { ...DEFAULT_POLICY.crap, enabled: crap },
        coverage: { ...DEFAULT_POLICY.coverage, untested },
      });
    rig.step({ checks: off(false, true) });
    expect(
      formatCodeReport(report(rig, ["src/a.ts"]))
        .split("\n")
        .slice(1, 4),
    ).toEqual([
      "  src/a.ts:1  hot  CC 12 (if 11), at or under; 100% of its lines ran in 1 test file",
      "  src/a.ts:2  cold  CC 6 (if 5), at or under; untested: no test runs it in its own process",
      "  src/a.ts:3  big  CC 35 (if 34), over since revision 1; 100% of its lines ran in 1 test file",
    ]);
    expect(formatCodeReport(report(rig, null))).toContain(
      "Coverage: 1 function untested; squeal code <path> shows them by file",
    );
    rig.step({ checks: off(true, false) });
    rig.step({ checks: off(true, false) });
    expect(formatCodeReport(report(rig, ["src/a.ts"])).split("\n")[2]).toBe(
      "  src/a.ts:2  cold  CC 6 (if 5), at or under; CRAP 42, over; 0% of its lines ran",
    );
    expect(formatCodeReport(report(rig, null))).toContain(
      "CRAP: 2 functions over 30; squeal code <path> shows them by file",
    );
  });

  it("says coverage is not checked for a file coverage.exclude leaves out (015-64)", async () => {
    const rig = await judged();
    rig.step({
      checks: coverageChecks({
        crap: DEFAULT_POLICY.crap,
        coverage: { ...DEFAULT_POLICY.coverage, exclude: ["src/**"] },
      }),
    });
    const read = report(rig, ["src/a.ts"]);
    expect(read.functions.map((f) => f.coverage)).toEqual([
      { excluded: true },
      { excluded: true },
      { excluded: true },
    ]);
    expect(formatCodeReport(read).split("\n")[1]).toBe(
      "  src/a.ts:1  hot  CC 12 (if 11), at or under; coverage not checked (coverage.exclude)",
    );
  });
});
