import { describe, expect, it } from "vitest";
import {
  crapScore,
  RECORD_WAIT_MS,
  readSummary,
  writeSummary,
} from "../../../src/core/code/crap/index.js";
import { WT } from "../../state/helpers.js";
import { type CoverageRig, coverageRig, sourceOf } from "./rig.js";

/*
 * Row 015-75 (issue #106): a source that only tests without coverage load
 * reads `unknown` with its runner, never a kept `untested` or CRAP verdict.
 * pytest is that runner here, as node:test gives records from row 015-86.
 * The kept states drop when the source turns `unknown` with a loader set
 * its last judgement did not see (parts 1 and 2; the parent's Q2: a
 * `pending` source keeps them, so Vitest's FAIL -> PASS stays).
 */

const HELPER = "classify 4 h1\n";
const UNTESTED = ["classify fail -"];
const UNKNOWN = ["classify unknown -"];

const fileState = (rig: CoverageRig, path: string) => readSummary(rig.store.meta, WT)?.files[path];
const blobOf = (rig: CoverageRig, path: string) => rig.store.files.list(WT, [path])[0]?.blob ?? "";
const both = (rig: CoverageRig) => [...rig.states("crap"), ...rig.states("uncovered")];

/** `scripts/helper.ts`, judged untested while no test file loads it. */
async function judgedUntested(runner: string | null) {
  const rig = coverageRig();
  if (runner !== null) rig.closures.setEnvironment({ runner, files: [] });
  await rig.edit({ "scripts/helper.ts": HELPER });
  rig.loader("scripts/other.test.ts", { closure: [] });
  rig.step();
  expect(rig.states("uncovered")).toEqual(UNTESTED);
  expect(rig.states("crap")).toEqual([`classify pass ${crapScore(4, 0)}`]);
  return rig;
}

describe("a source that only tests without coverage load (row 015-75)", () => {
  it("drops the kept untested verdict once a pytest test file loads it (e-order)", async () => {
    const rig = await judgedUntested("pytest");
    rig.loader("scripts/helper.test.ts", { closure: ["scripts/helper.ts"] });
    rig.step();
    expect(fileState(rig, "scripts/helper.ts")).toMatchObject({
      state: "unknown",
      cause: "no-record",
      runners: ["pytest"],
    });
    expect(both(rig)).toEqual([...UNKNOWN, ...UNKNOWN]);
    expect(rig.transitions("scripts/helper.ts", ["classify"])).toEqual([]);
    // Unknown at once: no wait for a record that never comes.
    expect(rig.step()?.wakeAt).toBeNull();
  });

  it("drops it after D9's wait when the loader's runner is not known", async () => {
    const rig = await judgedUntested(null);
    rig.loader("scripts/helper.test.ts", {
      closure: ["scripts/helper.ts"],
      recordedAt: rig.clock,
    });
    rig.step();
    expect(fileState(rig, "scripts/helper.ts")).toMatchObject({ state: "pending" });
    expect(rig.states("uncovered")).toEqual(UNTESTED);
    rig.clock += RECORD_WAIT_MS + 1;
    rig.step();
    expect(fileState(rig, "scripts/helper.ts")).toMatchObject({
      state: "unknown",
      cause: "no-record",
    });
    expect(fileState(rig, "scripts/helper.ts")).not.toHaveProperty("runners");
    expect(both(rig)).toEqual([...UNKNOWN, ...UNKNOWN]);
    expect(rig.transitions("scripts/helper.ts", ["classify"])).toEqual([]);
  });

  it("keeps the states of a source whose same loaders turn unknown", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": HELPER });
    const ran = () => [sourceOf("src/a.ts", blobOf(rig, "src/a.ts"), 1, [])];
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], record: ran() });
    rig.step();
    expect(rig.states("uncovered")).toEqual(UNTESTED);
    // A focused run at a new key: a result and no record.
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], key: "k2", recordedAt: 1 });
    rig.step();
    expect(fileState(rig, "src/a.ts")).toMatchObject({ state: "unknown", cause: "no-record" });
    expect(rig.states("uncovered")).toEqual(UNTESTED);
  });

  it("drops the kept states of an unknown source whose summary an older Squeal wrote", async () => {
    const rig = await judgedUntested("pytest");
    rig.loader("scripts/helper.test.ts", { closure: ["scripts/helper.ts"] });
    // As 0.1.352 left the reporter's file: unknown, its untested verdict kept, no loader set.
    const summary = readSummary(rig.store.meta, WT);
    if (summary === null) throw new Error("no summary");
    const old = { state: "unknown", blob: blobOf(rig, "scripts/helper.ts"), cause: "no-record" };
    writeSummary(rig.store.meta, WT, {
      ...summary,
      files: { ...summary.files, "scripts/helper.ts": old as never },
    });
    rig.step();
    expect(both(rig)).toEqual([...UNKNOWN, ...UNKNOWN]);
  });

  it("keeps a pending source's verdict, so a Vitest test written for it tells FAIL -> PASS", async () => {
    const rig = await judgedUntested("vitest");
    rig.loader("scripts/helper.test.ts", { closure: ["scripts/helper.ts"], pending: "queued" });
    rig.step();
    expect(fileState(rig, "scripts/helper.ts")).toMatchObject({ state: "pending", reason: "run" });
    expect(rig.states("uncovered")).toEqual(UNTESTED);
    const blob = blobOf(rig, "scripts/helper.ts");
    rig.loader("scripts/helper.test.ts", {
      closure: ["scripts/helper.ts"],
      record: [sourceOf("scripts/helper.ts", blob, 1, [1])],
    });
    rig.step();
    expect(rig.states("uncovered")).toEqual(["classify pass -"]);
    expect(rig.transitions("scripts/helper.ts", ["classify"])).toEqual([
      "uncovered fail-to-pass classify",
    ]);
  });
});

describe("a module only a project's environment loads (row 015-75 part 2)", () => {
  async function preloaded(runner: string) {
    const rig = coverageRig();
    rig.closures.setEnvironment({ runner, files: ["scripts/preload.ts", "scripts/only.ts"] });
    await rig.edit({ "scripts/only.ts": "onlyPreload 2 o1\n", "src/a.ts": HELPER });
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"] });
    rig.step();
    return rig;
  }

  it("counts as loaded by each test file of the project, so a pytest plugin's reads unknown", async () => {
    const rig = await preloaded("pytest");
    expect(fileState(rig, "scripts/only.ts")).toMatchObject({
      state: "unknown",
      cause: "no-record",
      runners: ["pytest"],
    });
    expect(rig.states("uncovered")).toEqual(["onlyPreload unknown -", "classify unknown -"]);
  });

  it("is not loaded by a Vitest project's test files", async () => {
    const rig = await preloaded("vitest");
    expect(fileState(rig, "scripts/only.ts")).toMatchObject({ state: "judged" });
    expect(rig.states("uncovered")).toContain("onlyPreload fail -");
  });
});
