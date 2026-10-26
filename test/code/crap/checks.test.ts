import { describe, expect, it } from "vitest";
import {
  coverageChecks,
  readCoverageChange,
  readEvidence,
  readSummary,
} from "../../../src/core/code/crap/index.js";
import { DEFAULT_POLICY } from "../../../src/core/types/index.js";
import { WT } from "../../state/helpers.js";
import { type CoverageRig, consumer, coverageRig, sourceOf } from "./rig.js";

/*
 * Spec 015 D1 as amended 2026-10-26 (row 015-64): `crap.enabled`,
 * `coverage.untested` and `coverage.exclude`. A check switched off, or a
 * file newly excluded, loses its states with no transition and one change
 * recorded for the summary line; a check switched on, or a file no longer
 * excluded, is seeded and judged quietly.
 */

const A = "hot 12 h1\ncold 6 c1\n";
const GEN = "made 9 m1\n";

const checks = (over: { crap?: boolean; untested?: boolean; exclude?: string[] } = {}) =>
  coverageChecks({
    crap: { ...DEFAULT_POLICY.crap, enabled: over.crap ?? true },
    coverage: {
      ...DEFAULT_POLICY.coverage,
      untested: over.untested ?? true,
      exclude: over.exclude ?? [],
    },
  });

const blobOf = (rig: CoverageRig, path: string) => rig.store.files.list(WT, [path])[0]?.blob ?? "";

/** `src/a.ts` and `src/gen/b.ts`, one test file loading both that ran `hot` only. */
async function judged(): Promise<CoverageRig> {
  const rig = coverageRig();
  await rig.edit({ "src/a.ts": A, "src/gen/b.ts": GEN });
  rig.loader("test/a.test.ts", {
    closure: ["src/a.ts", "src/gen/b.ts"],
    record: [sourceOf("src/a.ts", blobOf(rig, "src/a.ts"), 2, [1])],
  });
  rig.step();
  expect(rig.states("crap")).toEqual(["cold fail 42", "hot pass 12", "made fail 90"]);
  expect(rig.states("uncovered")).toEqual(["cold fail -", "hot pass -", "made fail -"]);
  return rig;
}

const told = (rig: CoverageRig) => [
  ...rig.transitions("src/a.ts", ["hot", "cold"]),
  ...rig.transitions("src/gen/b.ts", ["made"]),
];

describe("the coverage checks the policy keeps (row 015-64)", () => {
  it("with crap.enabled off, drops only the crap states, records the change once, and judges untested alone", async () => {
    const rig = await judged();
    const complexity = rig.states("complexity");
    rig.clock += 1_000;
    rig.step({ checks: checks({ crap: false }) });
    expect(rig.states("crap")).toEqual([]);
    expect(rig.states("uncovered")).toEqual(["cold fail -", "hot pass -", "made fail -"]);
    expect(rig.states("complexity")).toEqual(complexity);
    expect(told(rig)).toEqual([]);
    const change = readCoverageChange(rig.store.meta, WT);
    expect(change).toEqual({ revision: 1, at: rig.clock, off: ["crap"], excluded: 0 });
    expect(readSummary(rig.store.meta, WT)?.checks).toEqual(["uncovered"]);

    // A later step removes nothing again and records nothing new.
    rig.clock += 1_000;
    await rig.edit({ "src/a.ts": `${A}fresh 2 f1\n` });
    rig.loader("test/a.test.ts", {
      closure: ["src/a.ts", "src/gen/b.ts"],
      record: [sourceOf("src/a.ts", blobOf(rig, "src/a.ts"), 3, [1])],
      recordedAt: rig.clock,
    });
    rig.step({ checks: checks({ crap: false }) });
    expect(readCoverageChange(rig.store.meta, WT)).toEqual(change);
    expect(rig.states("crap")).toEqual([]);
    // A function an edit added is judged for the check kept only.
    expect(rig.transitions("src/a.ts", ["fresh"])).toEqual(["uncovered first-seen-fail fresh"]);
  });

  it("with coverage.untested off, drops only the uncovered states", async () => {
    const rig = await judged();
    rig.step({ checks: checks({ untested: false }) });
    expect(rig.states("uncovered")).toEqual([]);
    expect(rig.states("crap")).toEqual(["cold fail 42", "hot pass 12", "made fail 90"]);
    expect(told(rig)).toEqual([]);
    expect(readCoverageChange(rig.store.meta, WT)).toMatchObject({ off: ["uncovered"] });
  });

  it("seeds a check switched on again and judges it quietly", async () => {
    const rig = await judged();
    rig.step({ checks: checks({ crap: false }) });
    rig.step();
    expect(rig.states("crap")).toEqual(["cold fail 42", "hot pass 12", "made fail 90"]);
    expect(rig.states("uncovered")).toEqual(["cold fail -", "hot pass -", "made fail -"]);
    expect(told(rig)).toEqual([]);
    expect(readSummary(rig.store.meta, WT)?.checks).toBeUndefined();
  });

  it("with both checks off, keeps no D9 state, and records both", async () => {
    const rig = await judged();
    expect(rig.step({ checks: checks({ crap: false, untested: false }) })).toMatchObject({
      judged: 0,
      more: false,
    });
    expect(rig.store.states.list(WT).map((s) => s.measure)).toEqual([
      "complexity",
      "complexity",
      "complexity",
    ]);
    expect(readSummary(rig.store.meta, WT)).toMatchObject({ checks: [], files: {} });
    expect(readEvidence(rig.store.meta, WT, "src/a.ts")).toBeNull();
    expect(readCoverageChange(rig.store.meta, WT)).toMatchObject({
      off: ["crap", "uncovered"],
      excluded: 0,
    });
    expect(told(rig)).toEqual([]);
  });
});

describe("coverage.exclude (row 015-64)", () => {
  it("takes a newly excluded file's crap and uncovered states and evidence, and keeps its complexity", async () => {
    const rig = await judged();
    const complexity = rig.states("complexity");
    rig.step({ checks: checks({ exclude: ["src/gen/**"] }) });
    expect(rig.states("crap")).toEqual(["cold fail 42", "hot pass 12"]);
    expect(rig.states("uncovered")).toEqual(["cold fail -", "hot pass -"]);
    expect(rig.states("complexity")).toEqual(complexity);
    expect(readEvidence(rig.store.meta, WT, "src/gen/b.ts")).toBeNull();
    const summary = readSummary(rig.store.meta, WT);
    expect(Object.keys(summary?.files ?? {})).toEqual(["src/a.ts"]);
    expect(summary?.exclude).toEqual(["src/gen/**"]);
    expect(readCoverageChange(rig.store.meta, WT)).toMatchObject({ off: [], excluded: 1 });
    expect(told(rig)).toEqual([]);

    // An edit to the excluded file judges nothing of it.
    await rig.edit({ "src/gen/b.ts": `${GEN}more 4 n1\n` });
    rig.step({ checks: checks({ exclude: ["src/gen/**"] }) });
    expect(rig.store.states.list(WT, { paths: ["src/gen/b.ts"] }).map((s) => s.measure)).toEqual([
      "complexity",
      "complexity",
    ]);
    expect(told(rig)).toEqual([]);
  });

  it("seeds a file no longer excluded and judges it quietly", async () => {
    const rig = await judged();
    rig.step({ checks: checks({ exclude: ["src/gen/**"] }) });
    rig.step();
    expect(rig.states("crap")).toEqual(["cold fail 42", "hot pass 12", "made fail 90"]);
    expect(rig.states("uncovered")).toEqual(["cold fail -", "hot pass -", "made fail -"]);
    expect(told(rig)).toEqual([]);
    expect(readSummary(rig.store.meta, WT)?.exclude).toBeUndefined();
  });

  it("records no change for an exclude that matches no file with states", async () => {
    const rig = await judged();
    rig.step({ checks: checks({ exclude: ["scripts/**"] }) });
    expect(readCoverageChange(rig.store.meta, WT)).toBeNull();
    expect(readSummary(rig.store.meta, WT)?.exclude).toEqual(["scripts/**"]);
  });
});

describe("the summary line of a change of the checks (row 015-64)", () => {
  const S1 = consumer("s1");
  const lines = async (rig: CoverageRig) =>
    (await rig.told(S1)).filter((l) => /^(Coverage|FAIL|PASS|CRAP) /.test(l));

  it.each([
    [{ crap: false }, "Coverage checks changed: CRAP off (crap.enabled)."],
    [{ untested: false }, "Coverage checks changed: untested off (coverage.untested)."],
    [
      { crap: false, untested: false },
      "Coverage checks changed: CRAP off (crap.enabled); untested off (coverage.untested).",
    ],
    [
      { untested: false, exclude: ["src/gen/**"] },
      "Coverage checks changed: untested off (coverage.untested); 1 file no longer checked (coverage.exclude).",
    ],
  ])("with %j, tells one line once and no transition", async (over, line) => {
    const rig = await judged();
    await rig.register(S1);
    rig.clock += 1_000;
    rig.step({ checks: checks(over) });
    expect(await lines(rig)).toEqual([line]);
    expect(await rig.told(S1)).toEqual([]);
  });

  it("tells a session that registers after the change nothing", async () => {
    const rig = await judged();
    rig.clock += 1_000;
    rig.step({ checks: checks({ crap: false }) });
    await rig.register(S1);
    expect(await rig.told(S1)).toEqual([]);
  });
});
