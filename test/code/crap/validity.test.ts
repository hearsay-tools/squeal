import { describe, expect, it } from "vitest";
import { WT } from "../../state/helpers.js";
import { type CoverageRig, consumer, counterV2, coverageRig, sourceOf } from "./rig.js";

/*
 * Review 0.1.297 B1 and B2 (repair R6): a judgement holds while every input
 * that gives it its meaning holds, `crap.threshold` and the counter
 * version too; the first judgement after a recount is quiet, for the
 * functions it renamed and those whose CC it changed, also when a record
 * it waits for comes later.
 */

const A = "hot 12 h1\ncold 6 c1\ntiny 1 t1\n";

const blobOf = (rig: CoverageRig, path: string) => rig.store.files.list(WT, [path])[0]?.blob ?? "";

/** A record entry for `src/a.ts` that ran `hot` and `tiny`. */
const ranHotAndTiny = (rig: CoverageRig) => [
  sourceOf("src/a.ts", blobOf(rig, "src/a.ts"), 3, [1, 3]),
];

const thresholds = (rig: CoverageRig) =>
  rig.store.states
    .list(WT, { measure: "crap" })
    .map((s) => `${s.check.qualifiedName} ${s.threshold}`);

describe("the coverage step re-judges when crap.threshold changes (review 0.1.297 B1)", () => {
  it.each([
    ["raised", 50, ["cold pass 42", "hot pass 12", "tiny pass 1"]],
    ["lowered", 10, ["cold fail 42", "hot fail 12", "tiny pass 1"]],
  ] as const)("%s, with no new result or record, quietly", async (_, threshold, after) => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": A });
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], record: ranHotAndTiny(rig) });
    rig.step();
    expect(rig.states("crap")).toEqual(["cold fail 42", "hot pass 12", "tiny pass 1"]);

    const report = rig.step({ threshold });
    expect(report?.judged).toBe(1);
    expect(rig.states("crap")).toEqual(after);
    expect(thresholds(rig)).toEqual([`cold ${threshold}`, `hot ${threshold}`, `tiny ${threshold}`]);
    expect(rig.transitions("src/a.ts", ["hot", "cold", "tiny"])).toEqual([]);
    // The next step at the same threshold reads the judgement it left.
    expect(rig.step({ threshold })?.judged).toBe(0);
  });
});

describe("the coverage step after a complexity recount (review 0.1.297 B2)", () => {
  it("judges a function the recount renamed, though the blob and the loader's key stayed", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": "cold 6 c1\n" });
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], record: [] });
    rig.step();
    expect(rig.states("crap")).toEqual(["cold fail 42"]);

    await rig.recount(counterV2({ cold: ["newName", 8] }));
    rig.step({ reseed: true });
    expect(rig.states("crap")).toEqual(["newName fail 72"]);
    expect(rig.states("uncovered")).toEqual(["newName fail -"]);
    expect(rig.transitions("src/a.ts", ["cold", "newName"])).toEqual([]);
  });

  it.each([
    ["the loader's record ready at the recount", false],
    ["a new key and record ready at the recount", true],
  ])("tells no crossing a CC the recount changed made, with %s", async (_, rekey) => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": "cold 3 c1\n" });
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], record: [] });
    rig.step();
    expect(rig.states("crap")).toEqual(["cold pass 12"]);

    await rig.recount(counterV2({ cold: ["cold", 8] }));
    if (rekey) rig.loader("test/a.test.ts", { closure: ["src/a.ts"], key: "key-2", record: [] });
    rig.step({ reseed: true });
    expect(rig.states("crap")).toEqual(["cold fail 72"]);
    expect(rig.transitions("src/a.ts", ["cold"])).toEqual([]);
  });

  it("keeps the recount quiet until a record it waits for comes, then tells the next edit's crossing", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": "cold 3 c1\n" });
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], record: [] });
    rig.step();
    await rig.register(consumer("s1"));

    await rig.recount(counterV2({ cold: ["cold", 8] }));
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], key: "key-2", pending: "queued" });
    rig.step({ reseed: true });
    expect(rig.states("crap")).toEqual(["cold pass 12"]);
    await rig.told(consumer("s1"));

    // The record comes with no source edit: the recount's judgement, quiet.
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], key: "key-2", record: [] });
    rig.step();
    expect(rig.states("crap")).toEqual(["cold fail 72"]);
    expect(rig.transitions("src/a.ts", ["cold"])).toEqual([]);
    expect((await rig.told(consumer("s1"))).filter((l) => /CRAP|uncovered/.test(l))).toEqual([]);

    // The quiet judgement is spent: an edit's run that calls `cold` tells its recovery.
    await rig.edit({ "src/a.ts": "cold 3 c2\n" });
    rig.loader("test/a.test.ts", {
      closure: ["src/a.ts"],
      key: "key-3",
      record: [sourceOf("src/a.ts", blobOf(rig, "src/a.ts"), 1, [1])],
    });
    rig.step();
    expect(rig.states("crap")).toEqual(["cold pass 8"]);
    expect(rig.transitions("src/a.ts", ["cold"])).toEqual([
      "crap fail-to-pass cold",
      "uncovered fail-to-pass cold",
    ]);
  });
});
