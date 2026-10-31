import { describe, expect, it } from "vitest";
import { formatCodeReport } from "../../../src/cli/code.js";
import { unknownCrapReason } from "../../../src/cli/code-crap-reason.js";
import { readCodeReport } from "../../../src/cli/code-report.js";
import { type FileSummary, readSummary } from "../../../src/core/code/crap/index.js";
import type { CodeKnownState } from "../../../src/core/types/code.js";
import { WT } from "../../state/helpers.js";
import { type CoverageRig, coverageRig, sourceOf } from "./rig.js";

/*
 * Row 015-101 (gh-129, D6/D9): `squeal code <path>` gives an unknown CRAP
 * one short reason, in text and as `crap.reason` in JSON: its file's
 * pending or unknown condition, the function's own join, or "cause
 * unknown". The reason explains; D9's judgements stay as they are, and
 * the lines that ran never make a score.
 */

const POLICY = { threshold: 20, maxFileBytes: 524_288 };
const A = "hot 12 h1\ncold 6 c1\nbig 35 b1\nwide 31 w1\n";
const FUNCTIONS = 4;
const SKIPPED = "a test file that loads this file skipped a test";
const PARSE = "it is in a parse error, so its complexity is not judged";

const blobOf = (rig: CoverageRig) => rig.store.files.list(WT, ["src/a.ts"])[0]?.blob ?? "";
const ran = (rig: CoverageRig, lines: readonly number[]) => [
  sourceOf("src/a.ts", blobOf(rig), FUNCTIONS, lines),
];
const report = (rig: CoverageRig) =>
  readCodeReport(rig.main, rig.store, WT, POLICY, {
    paths: ["src/a.ts"],
    changed: false,
    shell: null,
  });
const coverageOf = (rig: CoverageRig, name: string) =>
  report(rig).functions.find((f) => f.qualifiedName === name)?.coverage;
const lineOf = (rig: CoverageRig, name: string) =>
  formatCodeReport(report(rig))
    .split("\n")
    .find((l) => l.includes(`  ${name}  `));

/** `test/a.test.ts` ran lines 1 and 3; `test/skip.test.ts` ran 2 and 4 and skipped a test. */
async function besideSkip(): Promise<CoverageRig> {
  const rig = coverageRig();
  await rig.edit({ "src/a.ts": A });
  rig.loader("test/a.test.ts", { closure: ["src/a.ts"], record: ran(rig, [1, 3]) });
  rig.loader("test/skip.test.ts", {
    closure: ["src/a.ts"],
    outcomes: ["pass", "skip"],
    record: ran(rig, [2, 4]),
  });
  rig.step();
  return rig;
}

describe("the reason for an unknown CRAP (row 015-101)", () => {
  it("names a skipped loader beside measured lines, in text and JSON, and goes once CRAP is a number", async () => {
    const rig = await besideSkip();
    expect(readSummary(rig.store.meta, WT)?.files["src/a.ts"]).toMatchObject({
      state: "unknown",
      cause: "skipped",
    });
    // `big` ran in test/a.test.ts, so it is tested; its CRAP 35 waits for every record.
    expect(coverageOf(rig, "big")).toEqual({
      crap: { outcome: "unknown", value: null, reason: SKIPPED },
      uncovered: "pass",
      lines: 1,
      covered: 1,
      testFiles: 1,
      first: ["test/a.test.ts"],
    });
    expect(lineOf(rig, "big")).toBe(
      `  src/a.ts:3  big  CC 35 (if 34), over since revision 1; CRAP unknown: ${SKIPPED}`,
    );
    expect(coverageOf(rig, "wide")?.crap).toEqual({
      outcome: "unknown",
      value: null,
      reason: SKIPPED,
    });
    // A proven pass has no reason.
    expect(coverageOf(rig, "hot")?.crap).toEqual({ outcome: "pass", value: 12 });

    // The skip is gone: every record is in, and CRAP is a number with no reason.
    rig.loader("test/skip.test.ts", {
      closure: ["src/a.ts"],
      key: "key-2",
      record: ran(rig, [2, 4]),
    });
    rig.step();
    expect(readSummary(rig.store.meta, WT)?.files["src/a.ts"]).toMatchObject({ state: "judged" });
    expect(coverageOf(rig, "big")?.crap).toEqual({ outcome: "fail", value: 35 });
    expect(lineOf(rig, "big")).toBe(
      "  src/a.ts:3  big  CC 35 (if 34), over since revision 1; CRAP 35, over; 100% of its lines ran in 1 test file",
    );
    expect(formatCodeReport(report(rig))).not.toContain("CRAP unknown");
  });

  it("names the wait of a pending file that keeps an unknown CRAP", async () => {
    const rig = await besideSkip();
    rig.loader("test/skip.test.ts", { closure: ["src/a.ts"], key: "key-2", pending: "queued" });
    rig.step();
    expect(readSummary(rig.store.meta, WT)?.files["src/a.ts"]).toMatchObject({
      state: "pending",
      reason: "run",
    });
    expect(coverageOf(rig, "wide")?.crap).toEqual({
      outcome: "unknown",
      value: null,
      reason: "waits for a test file to run",
    });
  });

  it("names the function's own join in a judged file", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": A });
    const [source] = ran(rig, [2, 3, 4]);
    if (source === undefined) throw new Error("no source");
    // Review 0.1.297 B4: two V8 functions at `hot`'s span with different hits.
    const twice = { ...source, functions: [[1, 0, 1, 78, 1] as const, ...source.functions] };
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], record: [twice] });
    rig.step();
    expect(readSummary(rig.store.meta, WT)?.files["src/a.ts"]).toMatchObject({ state: "judged" });
    expect(coverageOf(rig, "hot")?.crap).toEqual({
      outcome: "unknown",
      value: null,
      reason: "the coverage records cannot tell whether it ran",
    });
    expect(coverageOf(rig, "cold")?.crap).toEqual({ outcome: "pass", value: 6 });
  });

  it("names a parse error, not the join, once a judged file skips the function (review 0.1.381 B1)", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": "hot 12 h1 !\n" });
    const record = [sourceOf("src/a.ts", blobOf(rig), 1, [1])];
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], outcomes: ["pass", "skip"], record });
    rig.step();
    expect(readSummary(rig.store.meta, WT)?.files["src/a.ts"]).toMatchObject({
      state: "unknown",
      cause: "skipped",
    });
    // The skip is gone and the record shows `hot` ran, but its complexity is unknown, so no judgement.
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], key: "key-2", record });
    rig.step();
    expect(readSummary(rig.store.meta, WT)?.files["src/a.ts"]).toMatchObject({ state: "judged" });
    expect(coverageOf(rig, "hot")).toEqual({
      crap: { outcome: "unknown", value: null, reason: PARSE },
      uncovered: "unknown",
      lines: 1,
      covered: 1,
      testFiles: 1,
      first: ["test/a.test.ts"],
    });
    expect(lineOf(rig, "hot")).toMatch(new RegExp(`; CRAP unknown: ${PARSE}$`));
  });
});

describe("unknownCrapReason (row 015-101)", () => {
  const state = { blob: "b1" } as CodeKnownState;
  const unknown = (cause: Extract<FileSummary, { state: "unknown" }>["cause"]): FileSummary => ({
    state: "unknown",
    blob: "b1",
    cause,
  });
  const pending = (reason: Extract<FileSummary, { state: "pending" }>["reason"]): FileSummary => ({
    state: "pending",
    blob: "b1",
    reason,
    waiting: 1,
  });

  it("gives each existing cause its words", () => {
    expect(
      [
        pending("imports"),
        pending("run"),
        pending("record"),
        unknown("no-record"),
        unknown("skipped"),
        unknown("unkeyed"),
        unknown("unread"),
      ].map((f) => unknownCrapReason(f, state)),
    ).toEqual([
      "waits for a test file's imports",
      "waits for a test file to run",
      "waits for a coverage record",
      "a test file that loads this file has no coverage record",
      SKIPPED,
      "Squeal cannot key a test file that loads this file",
      "a coverage record cannot confirm this file's bytes",
    ]);
  });

  it("names a parse error before any file condition", () => {
    const parsed = { outcome: "unknown" } as CodeKnownState;
    const judged: FileSummary = { state: "judged", blob: "b1", signature: "s" };
    expect(
      [judged, pending("run"), unknown("skipped"), undefined].map((f) =>
        unknownCrapReason(f, state, parsed),
      ),
    ).toEqual([PARSE, PARSE, PARSE, PARSE]);
  });

  it("says the cause is unknown with no condition, or a judgement at another blob", () => {
    const judged: FileSummary = { state: "judged", blob: "b2", signature: "s" };
    expect(unknownCrapReason(undefined, state)).toBe("cause unknown");
    expect(unknownCrapReason(judged, state)).toBe("cause unknown");
    expect(unknownCrapReason({ ...judged, blob: "b1" }, state)).toBe(
      "the coverage records cannot tell whether it ran",
    );
  });
});
