import { describe, expect, it } from "vitest";
import { StepCache } from "../../../src/core/code/crap/cache.js";
import { RECORD_WAIT_MS } from "../../../src/core/code/crap/loaders.js";
import { readSummary } from "../../../src/core/code/crap/summary.js";
import { WT } from "../../state/helpers.js";
import { type CoverageRig, coverageRig, sourceOf } from "./rig.js";

/*
 * Review wave-3.5 B1 (row 018-10 R1): a record the provider before 0.1.419
 * wrote can map a test file that mocks `node:url` to the wrong lines, and
 * that file's result key did not move. Each record is stored at its result
 * key and the record version (spec 015 D8), so a record of version 3 at the
 * same key reads as no record until the file runs again.
 */

/** The record version every Squeal before 0.1.419 wrote. */
const OLD = 3;
const KEY = "key-test/a.test.ts";
const HELPER = "classify 4 h1\n";

const fileState = (rig: CoverageRig, path: string) => readSummary(rig.store.meta, WT)?.files[path];
const blobOf = (rig: CoverageRig, path: string) => rig.store.files.list(WT, [path])[0]?.blob ?? "";

/** `src/a.ts` with a passing loader at `KEY`, its record (line 1 ran) stored at `recordVersion`. */
async function loaded(recordVersion?: number): Promise<CoverageRig> {
  const rig = coverageRig();
  await rig.edit({ "src/a.ts": HELPER });
  rig.loader("test/a.test.ts", {
    closure: ["src/a.ts"],
    record: [sourceOf("src/a.ts", blobOf(rig, "src/a.ts"), 1, [1])],
    recordedAt: rig.clock,
    ...(recordVersion === undefined ? {} : { recordVersion }),
  });
  return rig;
}

describe("a coverage record of an older record version (review wave-3.5 B1)", () => {
  it("is not read by the loaders: the source waits for a record, then reads unknown", async () => {
    const rig = await loaded(OLD);
    rig.step();
    expect(fileState(rig, "src/a.ts")).toMatchObject({ state: "pending", reason: "record" });
    expect(rig.states("uncovered")).not.toContain("classify pass -");
    rig.clock += RECORD_WAIT_MS + 1;
    rig.step();
    expect(fileState(rig, "src/a.ts")).toMatchObject({ state: "unknown", cause: "no-record" });
    expect(rig.states("uncovered")).toEqual(["classify unknown -"]);
  });

  it("is not read by the step cache at the same result key", async () => {
    const rig = await loaded(OLD);
    expect(new StepCache().record(rig.store.coverage, KEY)).toBeNull();
  });

  it("reads the same record at the current record version", async () => {
    const rig = await loaded();
    rig.step();
    expect(rig.states("uncovered")).toEqual(["classify pass -"]);
    expect(new StepCache().record(rig.store.coverage, KEY)?.sources.map((s) => s.path)).toEqual([
      "src/a.ts",
    ]);
  });
});
