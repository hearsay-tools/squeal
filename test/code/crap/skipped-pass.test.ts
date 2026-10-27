import { describe, expect, it } from "vitest";
import { crapScore, readSummary } from "../../../src/core/code/crap/index.js";
import { WT } from "../../state/helpers.js";
import { type CoverageRig, consumer, coverageRig, sourceOf } from "./rig.js";

/*
 * Spec 015 D9, A pass beside skipped tests (row 015-78, the human): a
 * source unknown because a loading test skipped reads `pass` for each
 * function the current records in hand prove, a judgement before or not,
 * and `unknown` for the rest. It is quiet but for a real FAIL -> PASS, told
 * once, and never judges a failure.
 */

const S1 = consumer("s1");
const A = "hot 12 h1\ncold 6 c1\nbig 35 b1\nwide 31 w1\n";
const FUNCTIONS = 4;

const blobOf = (rig: CoverageRig) => rig.store.files.list(WT, ["src/a.ts"])[0]?.blob ?? "";

/** The title, each line about a function and a block's head (row 015-65). */
const code = (lines: readonly string[]) =>
  lines.filter((l) =>
    /^(- )?(FAIL|PASS|RESOLVED|STILL FAIL) |^\w+ \(src\/[^)]*\):$|^SQUEAL · /.test(l),
  );

/** A record entry for `src/a.ts` at its current blob that ran `lines`. */
const ran = (rig: CoverageRig, lines: readonly number[]) => [
  sourceOf("src/a.ts", blobOf(rig), FUNCTIONS, lines),
];

/** `test/skip.test.ts` loads `src/a.ts` and skipped one of its tests; its record ran `lines`. */
const skipping = (rig: CoverageRig, lines: readonly number[], key?: string) =>
  rig.loader("test/skip.test.ts", {
    closure: ["src/a.ts"],
    outcomes: ["pass", "skip"],
    record: ran(rig, lines),
    ...(key === undefined ? {} : { key }),
  });

const fileState = (rig: CoverageRig) => readSummary(rig.store.meta, WT)?.files["src/a.ts"];

describe("a pass beside skipped tests (015-78)", () => {
  it("passes the functions a current record proves, with no judgement before, and leaves the rest unknown", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": A });
    await rig.register(S1);
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], record: ran(rig, [1, 3]) });
    skipping(rig, [2, 4]);
    rig.step();
    expect(fileState(rig)).toMatchObject({ state: "unknown", cause: "skipped" });
    // `hot` ran, CRAP 12; `big` ran but its CRAP 35 is over 30, which only every record can tell.
    expect(rig.states("crap")).toEqual([
      "big unknown -",
      "cold unknown -",
      "hot pass 12",
      "wide unknown -",
    ]);
    expect(rig.states("uncovered")).toEqual([
      "big pass -",
      "cold unknown -",
      "hot pass -",
      "wide unknown -",
    ]);
    // A first judgement: quiet.
    expect(code(await rig.told(S1))).toEqual([]);
    expect(rig.transitions("src/a.ts", ["hot", "cold", "big", "wide"])).toEqual([]);
    // The records in hand stay: judged once.
    expect(rig.step()).toMatchObject({ judged: 0, transitions: 0, more: false });
  });

  it("passes later a function a new record of the passing loader proves, quietly", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": A });
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], record: ran(rig, [1, 3]) });
    skipping(rig, [2, 4]);
    rig.step();
    await rig.register(S1);
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], key: "key-2", record: ran(rig, [1, 2]) });
    rig.step();
    // `big`'s run is no longer in hand, and a pass is kept as last judged.
    expect(rig.states("crap")).toEqual([
      "big unknown -",
      "cold pass 6",
      "hot pass 12",
      "wide unknown -",
    ]);
    expect(rig.states("uncovered")).toContain("cold pass -");
    expect(code(await rig.told(S1))).toEqual([]);
  });

  it("proves from records that cannot confirm the source's bytes only a CRAP no coverage raises over 30", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": `${A}tiny 2 t1\n` });
    const all = [1, 2, 3, 4, 5];
    rig.loader("test/a.test.ts", {
      closure: ["src/a.ts"],
      record: [sourceOf("src/a.ts", "0".repeat(40), 5, all)],
    });
    rig.loader("test/b.test.ts", {
      closure: ["src/a.ts"],
      record: [sourceOf("src/a.ts", blobOf(rig), 5, all)],
      unread: ["src/a.ts"],
    });
    skipping(rig, all);
    rig.step();
    expect(fileState(rig)).toMatchObject({ state: "unknown", cause: "skipped" });
    // CC 2 unrun: CRAP 2² + 2, whatever the records still to come show.
    expect(rig.states("crap")).toEqual([
      "big unknown -",
      "cold unknown -",
      "hot unknown -",
      `tiny pass ${crapScore(2, 0)}`,
      "wide unknown -",
    ]);
    expect(rig.states("uncovered").every((s) => s.endsWith(" unknown -"))).toBe(true);
  });

  it("tells a real FAIL -> PASS once, and nothing again once every record is in", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": A });
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], record: ran(rig, [1, 3]) });
    rig.step();
    await rig.register(S1);
    expect(rig.states("uncovered")).toContain("cold fail -");

    // The agent writes a test of `cold`; `test/a.test.ts` runs again and skips one test.
    await rig.edit({ "test/new.test.ts": "it\n" });
    rig.loader("test/new.test.ts", { closure: ["src/a.ts"], record: ran(rig, [1, 2]) });
    rig.loader("test/a.test.ts", {
      closure: ["src/a.ts"],
      key: "key-2",
      outcomes: ["pass", "skip"],
      record: ran(rig, [1, 3]),
    });
    rig.step();
    expect(fileState(rig)).toMatchObject({ state: "unknown", cause: "skipped" });
    expect(code(await rig.told(S1))).toEqual([
      "SQUEAL · 2 code changes at revision 0",
      "cold (src/a.ts:2):",
      "- PASS untested: test/new.test.ts runs it in its own thread",
      "- PASS CRAP: 6, at or under 30",
    ]);
    // `hot`, judged before with other loaders, is proven again; `big` and `wide` are not.
    expect(rig.states("crap")).toEqual([
      "big unknown -",
      "cold pass 6",
      "hot pass 12",
      "wide unknown -",
    ]);
    expect(rig.step()).toMatchObject({ judged: 0, transitions: 0 });
    expect(await rig.told(S1)).toEqual([]);

    // The skip is gone: judged with every record, and nothing told twice.
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], key: "key-3", record: ran(rig, [1, 3]) });
    rig.step();
    expect(fileState(rig)).toMatchObject({ state: "judged" });
    expect(rig.states("crap")).toEqual([
      "big fail 35",
      "cold pass 6",
      "hot pass 12",
      `wide fail ${crapScore(31, 0)}`,
    ]);
    expect(code(await rig.told(S1))).toEqual([]);
    expect(rig.transitions("src/a.ts", ["cold"])).toEqual([
      "crap fail-to-pass cold",
      "uncovered fail-to-pass cold",
    ]);
  });

  it("keeps a pass proven while pending once a rerun skips, and tells it once", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": A });
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], record: ran(rig, [1, 3]) });
    rig.step();
    await rig.register(S1);
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], key: "key-2", pending: "queued" });
    await rig.edit({ "test/new.test.ts": "it\n" });
    rig.loader("test/new.test.ts", { closure: ["src/a.ts"], record: ran(rig, [2]) });
    rig.step();
    expect(fileState(rig)).toMatchObject({ state: "pending" });
    expect(code(await rig.told(S1))).toContain("- PASS CRAP: 6, at or under 30");

    // The rerun skipped a test: a new loader set, and the same records in hand.
    rig.loader("test/a.test.ts", {
      closure: ["src/a.ts"],
      key: "key-2",
      outcomes: ["pass", "skip"],
      record: ran(rig, [1, 3]),
    });
    rig.step();
    expect(fileState(rig)).toMatchObject({ state: "unknown", cause: "skipped" });
    expect(rig.states("crap")).toEqual([
      "big unknown -",
      "cold pass 6",
      "hot unknown -",
      "wide unknown -",
    ]);
    expect(rig.states("uncovered")).toContain("cold pass -");
    expect(await rig.told(S1)).toEqual([]);
  });
});
