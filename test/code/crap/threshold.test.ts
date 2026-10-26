import { describe, expect, it } from "vitest";
import { clearCoverage } from "../../../src/core/code/crap/index.js";
import { WT } from "../../state/helpers.js";
import { type CoverageRig, consumer, coverageRig, sourceOf } from "./rig.js";

/*
 * Row 015-40: a `crap.threshold` change delivers one summary line, as D6's
 * does for complexity, and seeds the views again by count; no function's
 * crossing that only the threshold made is told (D9). The line comes once
 * the step judged every ready file at the new threshold.
 */

const S1 = consumer("s1");
const A = "hot 12 h1\ncold 6 c1\nbig 35 b1\n";
const LINE = "CRAP threshold is now 10: 3 functions over; squeal code lists them.";

const blobOf = (rig: CoverageRig) => rig.store.files.list(WT, ["src/a.ts"])[0]?.blob ?? "";

/** `hot` 12, `cold` 42 and `big` 35 judged at CRAP 30, then S1 registers. */
async function judged(): Promise<CoverageRig> {
  const rig = coverageRig();
  await rig.edit({ "src/a.ts": A });
  rig.loader("test/a.test.ts", {
    closure: ["src/a.ts"],
    record: [sourceOf("src/a.ts", blobOf(rig), 3, [1, 3])],
  });
  rig.step();
  await rig.register(S1);
  return rig;
}

describe("a crap.threshold change (015-40)", () => {
  it("tells one summary line and no crossing, then seeds the view by count", async () => {
    const rig = await judged();
    rig.clock += 1_000;
    rig.step({ threshold: 10 });
    expect(rig.states("crap")).toEqual(["big fail 35", "cold fail 42", "hot fail 12"]);
    const lines = await rig.told(S1);
    expect(lines.filter((l) => /^(CRAP|FAIL|PASS|Complexity) /.test(l))).toEqual([LINE]);
    expect(await rig.told(S1)).toEqual([]);
    // `hot` is held by count: its first edit is a STILL FAIL, not a FAIL.
    await rig.edit({ "src/a.ts": "hot 12 h2\ncold 6 c1\nbig 35 b1\n" });
    rig.loader("test/a.test.ts", {
      closure: ["src/a.ts"],
      key: "key-2",
      record: [sourceOf("src/a.ts", blobOf(rig), 3, [1, 3])],
    });
    rig.step({ threshold: 10 });
    expect((await rig.told(S1)).filter((l) => l.includes("hot ("))).toEqual([
      "STILL FAIL CRAP: hot (src/a.ts:1): 12 after the edit; it was already over 10 before it (complexity 12; 100% of its lines ran in test/a.test.ts); Squeal stays quiet about it until it is at or under 10, and squeal code src/a.ts shows its CRAP.",
    ]);
  });

  it("tells a session that registers after the change nothing", async () => {
    const rig = await judged();
    rig.step({ threshold: 10 });
    await rig.register(consumer("s2"));
    expect(await rig.told(consumer("s2"))).toEqual([]);
  });

  it("waits for the step that judged every ready file at the new threshold", async () => {
    const rig = await judged();
    let t = rig.clock;
    // Past its budget before the first file: nothing judged at 10 yet.
    expect(rig.step({ threshold: 10, now: () => (t += 60) })).toMatchObject({ more: true });
    expect(await rig.told(S1)).toEqual([]);
    rig.step({ threshold: 10 });
    expect((await rig.told(S1)).filter((l) => l.startsWith("CRAP "))).toEqual([LINE]);
  });

  it("tells nothing when coverage starts, nor when it is switched off and on", async () => {
    const rig = await judged();
    expect(await rig.told(S1)).toEqual([]);
    rig.step({ threshold: 10 });
    clearCoverage(rig.store, WT);
    rig.step({ threshold: 10 });
    await rig.register(consumer("s2"));
    rig.step({ threshold: 10 });
    expect(await rig.told(consumer("s2"))).toEqual([]);
  });
});
