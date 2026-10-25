import { describe, expect, it } from "vitest";
import { crapScore, readSummary, writeSummary } from "../../../src/core/code/crap/index.js";
import { WT } from "../../state/helpers.js";
import { type CoverageRig, consumer, coverageRig, sourceOf } from "./rig.js";

/*
 * Spec 015 D9, A pass proven early (row 015-57, the human): more records
 * only add covered lines, so while a source is pending or unknown the
 * records in hand can prove a pass, told at once, and never a failure,
 * which still waits for every record.
 */

const S1 = consumer("s1");
const A = "hot 12 h1\ncold 6 c1\nbig 35 b1\nwide 31 w1\n";
const FUNCTIONS = 4;

const blobOf = (rig: CoverageRig) => rig.store.files.list(WT, ["src/a.ts"])[0]?.blob ?? "";

/** The title and each line about a function. */
const code = (lines: readonly string[]) =>
  lines.filter((l) => /^(FAIL|PASS|RESOLVED|STILL FAIL) |^SQUEAL · /.test(l));

/** A record entry for `src/a.ts` at its current blob that ran `lines`. */
const ran = (rig: CoverageRig, lines: readonly number[], blob = blobOf(rig)) => [
  sourceOf("src/a.ts", blob, FUNCTIONS, lines),
];

/**
 * `test/a.test.ts` ran `hot` and `big`, judged: `cold` and `wide` fail
 * both measures, `big` fails CRAP; then S1 registers.
 */
async function judged(): Promise<CoverageRig> {
  const rig = coverageRig();
  await rig.edit({ "src/a.ts": A });
  rig.loader("test/a.test.ts", { closure: ["src/a.ts"], record: ran(rig, [1, 3]) });
  rig.step();
  await rig.register(S1);
  return rig;
}

/** `test/a.test.ts` runs again at `key`: its record is not in yet. */
const rerun = (rig: CoverageRig, key: string) =>
  rig.loader("test/a.test.ts", { closure: ["src/a.ts"], key, pending: "queued" });

/** The agent writes a new test file, `test/new.test.ts`, whose record ran `lines`. */
async function added(rig: CoverageRig, lines: readonly number[], blob?: string) {
  await rig.edit({ "test/new.test.ts": "it\n" });
  rig.loader("test/new.test.ts", { closure: ["src/a.ts"], record: ran(rig, lines, blob) });
}

const fileState = (rig: CoverageRig) => readSummary(rig.store.meta, WT)?.files["src/a.ts"];

describe("a pass proven early (015-57)", () => {
  it("tells FAIL -> PASS when a new test's record proves it, with another loader still to run", async () => {
    const rig = await judged();
    rerun(rig, "key-2");
    await added(rig, [2]);
    rig.step();
    expect(fileState(rig)).toMatchObject({ state: "pending", reason: "run", waiting: 1 });
    expect(code(await rig.told(S1))).toEqual([
      "SQUEAL · 2 code changes at revision 0",
      "PASS CRAP: cold (src/a.ts:2) is 6, at or under 30",
      "PASS uncovered: cold (src/a.ts:2): test/new.test.ts runs it in process",
    ]);
    // `hot` is not proven by the record in hand, and keeps its last judged states.
    expect(rig.states("crap")).toEqual([
      "big fail 35",
      "cold pass 6",
      "hot pass 12",
      `wide fail ${crapScore(31, 0)}`,
    ]);
    expect(rig.states("uncovered")).toEqual([
      "big pass -",
      "cold pass -",
      "hot pass -",
      "wide fail -",
    ]);

    // Every record in: the judgement is the one with every record, and tells nothing told already.
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], key: "key-2", record: ran(rig, [1, 3]) });
    rig.step();
    expect(fileState(rig)).toMatchObject({ state: "judged" });
    expect(fileState(rig)).not.toHaveProperty("early");
    expect(await rig.told(S1)).toEqual([]);
    expect(rig.states("crap")).toEqual([
      "big fail 35",
      "cold pass 6",
      "hot pass 12",
      `wide fail ${crapScore(31, 0)}`,
    ]);
    expect(rig.transitions("src/a.ts", ["cold"])).toEqual([
      "crap fail-to-pass cold",
      "uncovered fail-to-pass cold",
    ]);
  });

  it("tells a function's uncovered PASS alone while its CRAP stays over", async () => {
    const rig = await judged();
    rerun(rig, "key-2");
    await added(rig, [4]);
    rig.step();
    expect(code(await rig.told(S1))).toEqual([
      "SQUEAL · 1 code change at revision 0",
      "PASS uncovered: wide (src/a.ts:4): test/new.test.ts runs it in process",
    ]);
    expect(rig.states("crap")).toContain(`wide fail ${crapScore(31, 0)}`);
  });

  it("tells a new failure only once every record is in", async () => {
    const rig = await judged();
    rerun(rig, "key-2");
    await added(rig, []);
    rig.step();
    expect(await rig.told(S1)).toEqual([]);
    expect(rig.states("uncovered")).toEqual([
      "big pass -",
      "cold fail -",
      "hot pass -",
      "wide fail -",
    ]);

    // The run no longer calls `hot`.
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], key: "key-2", record: ran(rig, [3]) });
    rig.step();
    expect(code(await rig.told(S1))).toEqual([
      "SQUEAL · 2 code changes at revision 0",
      `FAIL CRAP: hot (src/a.ts:1) is ${crapScore(12, 0)}, over 30 (CC 12); no in-process test that Squeal runs reaches it`,
      "FAIL uncovered: hot (src/a.ts:1): no in-process test that Squeal runs reaches it (CC 12)",
    ]);
  });

  it("tells a first-seen failure only once every record is in", async () => {
    const rig = await judged();
    await rig.edit({ "src/a.ts": `${A}fresh 8 f1\nsmall 3 s1\n` });
    const blob = blobOf(rig);
    const five = (lines: readonly number[]) => [sourceOf("src/a.ts", blob, 6, lines)];
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], key: "key-2", record: five([1, 3]) });
    rig.loader("test/b.test.ts", { closure: ["src/a.ts"], pending: "queued" });
    rig.step();
    expect(await rig.told(S1)).toEqual([]);
    // `small` passes CRAP unrun; whether a test runs it waits for every record.
    expect(rig.states("crap")).toContain(`small pass ${crapScore(3, 0)}`);
    expect(rig.states("uncovered").some((s) => /^(fresh|small) /.test(s))).toBe(false);

    rig.loader("test/b.test.ts", { closure: ["src/a.ts"], record: [] });
    rig.step();
    expect(code(await rig.told(S1))).toEqual([
      "SQUEAL · 3 code changes at revision 0",
      `FAIL CRAP: fresh (src/a.ts:5) is ${crapScore(8, 0)}, over 30 (CC 8); no in-process test that Squeal runs reaches it`,
      "FAIL uncovered: fresh (src/a.ts:5): no in-process test that Squeal runs reaches it (CC 8)",
      "FAIL uncovered: small (src/a.ts:6): no in-process test that Squeal runs reaches it (CC 3)",
    ]);
  });

  it("tells a STILL FAIL only once every record is in", async () => {
    const rig = await judged();
    await rig.edit({ "src/a.ts": "hot 12 h1\ncold 6 c2\nbig 35 b1\nwide 31 w1\n" });
    rerun(rig, "key-2");
    await added(rig, [1]);
    rig.step();
    expect(await rig.told(S1)).toEqual([]);

    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], key: "key-2", record: ran(rig, [1, 3]) });
    rig.step();
    expect(code(await rig.told(S1))).toEqual([
      "SQUEAL · 1 function still failing a code check at revision 0",
      "STILL FAIL CRAP: cold (src/a.ts:2) is 42 after the edit; it was already over 30 before it (CC 6); no in-process test that Squeal runs reaches it; Squeal stays quiet about it until it is at or under 30, and squeal code src/a.ts shows its CRAP.",
      "STILL FAIL uncovered: cold (src/a.ts:2): no in-process test that Squeal runs reaches it after the edit; none reached it before it either (CC 6); Squeal stays quiet about it until an in-process test runs it, and squeal code src/a.ts shows its coverage.",
    ]);
  });

  it.each([
    ["of other bytes of the source", { blob: "0".repeat(40) }],
    ["that cannot confirm the source's bytes", { unread: ["src/a.ts"] }],
  ] as const)("proves nothing from a record %s", async (_, spec) => {
    const rig = await judged();
    rerun(rig, "key-2");
    await rig.edit({ "test/new.test.ts": "it\n" });
    rig.loader("test/new.test.ts", {
      closure: ["src/a.ts"],
      record: ran(rig, [2, 4], "blob" in spec ? spec.blob : undefined),
      ...("unread" in spec ? { unread: spec.unread } : {}),
    });
    rig.step();
    expect(await rig.told(S1)).toEqual([]);
    expect(rig.states("uncovered")).toContain("cold fail -");
  });

  it("proves a pass while the source is unknown", async () => {
    const rig = await judged();
    rig.loader("test/a.test.ts", {
      closure: ["src/a.ts"],
      key: "key-2",
      outcomes: ["pass", "skip"],
      record: ran(rig, [1, 3]),
    });
    await added(rig, [2]);
    rig.step();
    expect(fileState(rig)).toMatchObject({ state: "unknown", cause: "skipped" });
    expect(code(await rig.told(S1))).toContain("PASS CRAP: cold (src/a.ts:2) is 6, at or under 30");
  });

  it("judges an early file once while the records in hand stay, and once more after an older Squeal's summary", async () => {
    const rig = await judged();
    rerun(rig, "key-2");
    await added(rig, [2]);
    rig.step();
    const early = fileState(rig);
    expect(early).toMatchObject({ state: "pending", early: expect.any(String) });
    expect(rig.step()).toMatchObject({ judged: 0, transitions: 0, more: false });

    // A summary an older Squeal wrote has no `early`: it is read, and the file judged early once.
    const summary = readSummary(rig.store.meta, WT);
    if (summary === null || early === undefined) throw new Error("no summary");
    const { early: _, ...older } = early as { early?: string };
    const files = { ...summary.files, "src/a.ts": older as typeof early };
    writeSummary(rig.store.meta, WT, { ...summary, files });
    expect(rig.step()).toMatchObject({ judged: 1, transitions: 0, more: false });
    expect(fileState(rig)).toEqual(early);
    expect(rig.step()).toMatchObject({ judged: 0, transitions: 0, more: false });
  });

  it("keeps a failure a crap.threshold change alone would pass, as a judgement with every record does", async () => {
    const rig = await judged();
    rerun(rig, "key-2");
    await added(rig, [3]);
    rig.step({ threshold: 40 });
    // `big` is 35 by the record in hand: under 40, and over the 30 it failed at.
    expect(rig.states("crap")).toContain("big fail 35");
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], key: "key-2", record: ran(rig, [1, 3]) });
    rig.step({ threshold: 40 });
    expect(rig.states("crap")).toContain("big pass 35");
    expect(rig.transitions("src/a.ts", ["big"])).toEqual([]);
  });
});
