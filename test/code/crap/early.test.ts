import { describe, expect, it } from "vitest";
import {
  crapScore,
  readSummary,
  StepCache,
  writeSummary,
} from "../../../src/core/code/crap/index.js";
import { WT } from "../../state/helpers.js";
import { type CoverageRig, consumer, coverageRig, sourceOf } from "./rig.js";

/*
 * Spec 015 D9, A pass proven early (row 015-57, the human): more records
 * only add covered lines, so while a source is pending or unknown the
 * records in hand can prove a failing function passes, told at once, and
 * never a failure, which still waits for every record. Every other state
 * keeps its last judgement.
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
      "cold (src/a.ts:2):",
      "- PASS untested: test/new.test.ts runs it in its own process",
      "- PASS CRAP: 6, at or under 30",
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
      "PASS untested: wide (src/a.ts:4): test/new.test.ts runs it in its own process",
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
      "hot (src/a.ts:1):",
      "- FAIL untested: no test runs it in its own process; 2 test files load this file",
      `- FAIL CRAP: ${crapScore(12, 0)}, over 30 (complexity 12)`,
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
    // Only a failure is judged early: `small`, at most CRAP 12 unrun, waits too.
    const added = (s: string) => /^(fresh|small) /.test(s);
    expect([...rig.states("crap"), ...rig.states("uncovered")].some(added)).toBe(false);

    rig.loader("test/b.test.ts", { closure: ["src/a.ts"], record: [] });
    rig.step();
    expect(code(await rig.told(S1))).toEqual([
      "SQUEAL · 3 code changes at revision 0",
      "fresh (src/a.ts:5):",
      "- FAIL untested: no test runs it in its own process; 2 test files load this file",
      `- FAIL CRAP: ${crapScore(8, 0)}, over 30 (complexity 8)`,
      "FAIL untested: small (src/a.ts:6): no test runs it in its own process; 2 test files load this file (complexity 3, CRAP 12)",
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
      "cold (src/a.ts:2):",
      "- STILL FAIL untested: no test runs it in its own process after the edit, nor did one before it; 2 test files load this file; Squeal stays quiet about it until a test runs it in its own process, and squeal code src/a.ts shows its coverage.",
      "- STILL FAIL CRAP: 42 after the edit; it was already over 30 before it (complexity 6); Squeal stays quiet about it until it is at or under 30, and squeal code src/a.ts shows its CRAP.",
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

  it.each([
    ["skipped", { outcomes: ["pass", "skip"] as const }],
    ["unread", { unread: ["src/a.ts"] }],
  ] as const)("proves a pass while the source is unknown: %s", async (cause, spec) => {
    const rig = await judged();
    rig.loader("test/a.test.ts", {
      closure: ["src/a.ts"],
      key: "key-2",
      record: ran(rig, [1, 3]),
      ...spec,
    });
    await added(rig, [2]);
    rig.step();
    expect(fileState(rig)).toMatchObject({ state: "unknown", cause });
    expect(code(await rig.told(S1))).toContain("- PASS CRAP: 6, at or under 30");
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

  it("judges no file early that has no failure", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": "hot 12 h1\ntiny 1 t1\n" });
    const record = [sourceOf("src/a.ts", blobOf(rig), 2, [1, 2])];
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], record });
    rig.step();
    rig.loader("test/b.test.ts", { closure: ["src/a.ts"], pending: "queued" });
    expect(rig.step()).toMatchObject({ judged: 0 });
    expect(fileState(rig)).toEqual({
      state: "pending",
      blob: blobOf(rig),
      reason: "run",
      waiting: 1,
    });
  });

  it("reads again whether a file fails once a judgement with every record wrote its states", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": "hot 12 h1\ntiny 1 t1\n" });
    const record = (lines: readonly number[]) => [sourceOf("src/a.ts", blobOf(rig), 2, lines)];
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], record: record([1, 2]) });
    rig.loader("test/b.test.ts", { closure: ["src/a.ts"], record: [] });
    const cache = new StepCache();
    const step = () => {
      cache.invalidate();
      return rig.step({ cache });
    };
    step();
    await rig.register(S1);
    // Pending with no failure: the chain's cache holds that `src/a.ts` has none.
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], key: "key-2", pending: "queued" });
    await rig.edit({ "test/a.test.ts": "it\n" });
    step();
    // Its run no longer calls `hot`: judged with every record, `hot` fails.
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], key: "key-2", record: record([2]) });
    step();
    expect(rig.states("uncovered")).toEqual(["hot fail -", "tiny pass -"]);
    expect(code(await rig.told(S1))).toContain(
      "- FAIL untested: no test runs it in its own process; 2 test files load this file",
    );
    // A new test runs `hot` while `test/a.test.ts` runs again: told at once.
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], key: "key-3", pending: "queued" });
    await rig.edit({ "test/new.test.ts": "it\n" });
    rig.loader("test/new.test.ts", { closure: ["src/a.ts"], record: record([1]) });
    step();
    expect(code(await rig.told(S1))).toContain(
      "- PASS untested: test/new.test.ts runs it in its own process",
    );
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
