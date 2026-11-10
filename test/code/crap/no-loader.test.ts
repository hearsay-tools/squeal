import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { formatCodeReport } from "../../../src/cli/code.js";
import { readCodeReport } from "../../../src/cli/code-report.js";
import { COVERAGE_MEASURES } from "../../../src/core/code/crap/seed.js";
import { readSummary, writeSummary } from "../../../src/core/code/crap/summary.js";
import { toldOver } from "../../../src/core/delivery/code-told.js";
import { WT } from "../../state/helpers.js";
import { type CoverageRig, consumer, coverageRig, sourceOf } from "./rig.js";

/*
 * Spec 020 D11.5 (row 020-07a): a source no test file Squeal runs loads
 * reads unknown, cause `no-loader`, never 0% and untested. The states an
 * older Squeal judged at 0% with no loader are dropped once at the first
 * step after the upgrade, with no transition, so they leave `--told`.
 * `squeal code` reads such a file as not measured (#165).
 */

const S1 = consumer("s1");
const blobOf = (rig: CoverageRig, path: string) => rig.store.files.list(WT, [path])[0]?.blob ?? "";
const fileState = (rig: CoverageRig, path: string) => readSummary(rig.store.meta, WT)?.files[path];

/** `loaderSet([])` as Squeal wrote it before the marker: the hash of no test file. */
const EMPTY_SET = createHash("sha1").update("").digest("hex").slice(0, 16);

const report = (rig: CoverageRig, paths: string[] | null) =>
  readCodeReport(
    rig.main,
    rig.store,
    WT,
    { threshold: 20, maxFileBytes: 524_288 },
    { paths, changed: false, shell: null },
  );

/**
 * `src/b.ts` told untested to `S1`, then left as an older Squeal judged a
 * file no test loads: its states stand, and its summary names the empty set.
 */
async function judgedAtNoLoader(): Promise<CoverageRig> {
  const rig = coverageRig();
  await rig.edit({ "src/a.ts": "hot 12 h1\n" });
  const a = () => sourceOf("src/a.ts", blobOf(rig, "src/a.ts"), 1, [1]);
  rig.loader("test/a.test.ts", { closure: ["src/a.ts"], record: [a()] });
  rig.step();
  await rig.register(S1);
  await rig.edit({ "src/b.ts": "lone 6 l1\n" });
  const b = sourceOf("src/b.ts", blobOf(rig, "src/b.ts"), 1, []);
  rig.loader("test/a.test.ts", { closure: ["src/a.ts", "src/b.ts"], key: "k2", record: [a(), b] });
  rig.step();
  const lines = await rig.told(S1);
  expect(lines).toContain("lone (src/b.ts:1):");
  expect(lines.filter((l) => /^- FAIL (untested|CRAP):/.test(l))).toHaveLength(2);
  expect(toldOver(rig.store, WT, [S1], COVERAGE_MEASURES).map((s) => s.measure)).toEqual([
    "crap",
    "uncovered",
  ]);
  // The test file stops loading it, and the summary reads as 0.1.423 wrote it at no loader.
  rig.loader("test/a.test.ts", { closure: ["src/a.ts"], key: "k3", record: [a()] });
  const summary = readSummary(rig.store.meta, WT);
  const before = summary?.files["src/b.ts"];
  if (summary === null || before === undefined) throw new Error("src/b.ts was not judged");
  writeSummary(rig.store.meta, WT, {
    ...summary,
    files: { ...summary.files, "src/b.ts": { ...before, loaders: EMPTY_SET } },
  });
  return rig;
}

describe("a source no test file loads (spec 020 D11.5)", () => {
  it("drops the states an older Squeal judged at no loader once, with no transition, out of --told", async () => {
    const rig = await judgedAtNoLoader();
    const transitions = rig.transitions("src/b.ts", ["lone"]);
    rig.step();
    expect(fileState(rig, "src/b.ts")).toMatchObject({ state: "unknown", cause: "no-loader" });
    expect([...rig.states("crap"), ...rig.states("uncovered")]).toEqual([
      "hot pass 12",
      "lone unknown -",
      "hot pass -",
      "lone unknown -",
    ]);
    expect(rig.transitions("src/b.ts", ["lone"])).toEqual(transitions);
    expect(toldOver(rig.store, WT, [S1], COVERAGE_MEASURES)).toEqual([]);
    expect(await rig.told(S1)).toEqual([]);
    // Once: the next step keeps the marker and drops nothing more.
    expect(fileState(rig, "src/b.ts")).toMatchObject({ loaders: "no-loader" });
    rig.step();
    expect(fileState(rig, "src/b.ts")).toMatchObject({ state: "unknown", cause: "no-loader" });
  });

  it("reads not measured in squeal code, with no CRAP value", async () => {
    const rig = await judgedAtNoLoader();
    rig.step();
    const paths = report(rig, ["src/b.ts"]);
    expect(paths.functions.map((f) => f.coverage)).toEqual([{ notLoaded: true }]);
    expect(formatCodeReport(paths)).toContain(
      "lone  CC 6 (if 5), at or under; not measured: no test Squeal runs loads this file\n",
    );
    const all = report(rig, null);
    expect(all.coverage).toMatchObject({ uncovered: 0, notJudged: 0, notLoaded: 1 });
    expect(formatCodeReport(all)).toContain(
      "  1 file not measured: no test Squeal runs loads them\n",
    );
  });

  it("reads a .py file with no Python runner as not measured, never untested (#165)", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": "hot 12 h1\n", "tools/report.py": "render 4 r1\n" });
    const a = sourceOf("src/a.ts", blobOf(rig, "src/a.ts"), 1, [1]);
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], record: [a] });
    rig.step();
    expect(fileState(rig, "tools/report.py")).toMatchObject({
      state: "unknown",
      cause: "no-loader",
    });
    expect(rig.states("uncovered")).not.toContain("render fail -");
    const py = report(rig, ["tools/report.py"]);
    expect(py.functions.map((f) => f.coverage)).toEqual([{ notLoaded: true }]);
    expect(formatCodeReport(py)).toContain("; not measured: no test Squeal runs loads this file\n");
  });
});
