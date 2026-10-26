import { describe, expect, it } from "vitest";
import { COUNTER_VERSION, countFile } from "../../../src/core/code/count/index.js";
import type { CoverageSource } from "../../../src/core/code/coverage/index.js";
import { WT } from "../../state/helpers.js";
import { type CoverageRig, consumer, counterV2, coverageRig, sourceOf } from "./rig.js";

/*
 * Repair R12 (review 0.1.324) of row 015-57: an early CRAP value is an
 * upper bound, so the records still to come never raise it (B1), and a
 * failure is judged early only when the threshold it failed at passes it,
 * quiet or not (B2).
 */

const S1 = consumer("s1");

/** The title and each line about a function. */
const code = (lines: readonly string[]) =>
  lines.filter((l) =>
    /^(- )?(FAIL|PASS|RESOLVED|STILL FAIL) |^\w+ \(src\/[^)]*\):$|^SQUEAL · /.test(l),
  );

const blobOf = (rig: CoverageRig) => rig.store.files.list(WT, ["src/a.ts"])[0]?.blob ?? "";

/** B1's source: `f` has CC 10, and two transforms map different lines of it as code. */
const F = `globalThis.__reviewF = function f(x) {
  if (FEATURE) {
    if (x === 1) return 1;
    if (x === 2) return 2;
    if (x === 3) return 3;
    if (x === 4) return 4;
    if (x === 5) return 5;
    if (x === 6) return 6;
    if (x === 7) return 7;
    if (x === 8) return 8;
  }
  return 0;
};
`;

/**
 * The records the review's probe built from these bytes (esbuild, Node's
 * precise coverage, `buildRecord`): with `FEATURE` false and `f(0)` called,
 * lines 1 and 12 map and ran; with it true and `f` not called, lines 1, 3
 * to 10 and 12 map, and only line 1 ran.
 */
const featureOff = (blob: string): CoverageSource => ({
  path: "src/a.ts",
  blob,
  lines: "AQg=",
  covered: "AQg=",
  functions: [[1, 23, 13, 0, 1]],
});
const featureOn = (blob: string): CoverageSource => ({
  path: "src/a.ts",
  blob,
  lines: "/Qs=",
  covered: "AQ==",
  functions: [[1, 23, 13, 0, 0]],
});

describe("an early CRAP value is an upper bound (review 0.1.324 B1)", () => {
  it("is never raised, nor the function failed again, by a record of another transform", async () => {
    const rig = coverageRig();
    await rig.recount({
      version: COUNTER_VERSION,
      count: (text, language) => countFile(text, language),
    });
    await rig.edit({ "src/a.ts": F });
    const blob = blobOf(rig);
    rig.loader("test/full.test.ts", { closure: ["src/a.ts"], record: [featureOn(blob)] });
    rig.step();
    expect(rig.states("crap")).toEqual(["f fail 110"]);
    await rig.register(S1);

    // `test/full.test.ts` runs again; a new test file calls `f` with `FEATURE` false.
    rig.loader("test/full.test.ts", { closure: ["src/a.ts"], key: "key-2", pending: "queued" });
    await rig.edit({ "test/new.test.ts": "it\n" });
    rig.loader("test/new.test.ts", { closure: ["src/a.ts"], record: [featureOff(blob)] });
    rig.step();
    const early = code(await rig.told(S1));
    // One confirmed hit is enough for "no test runs it".
    expect(early).toContain(
      "PASS untested: f (src/a.ts:1): test/new.test.ts runs it in its own process",
    );
    const [earlyCrap] = rig.states("crap");
    const value = (state: string | undefined) => Number(state?.split(" ")[2]);

    // Every record in: the CRAP is no higher, and no failure is told again.
    rig.loader("test/full.test.ts", {
      closure: ["src/a.ts"],
      key: "key-2",
      record: [featureOn(blob)],
    });
    rig.step();
    expect(rig.states("crap")).toEqual(["f fail 61.20000000000001"]);
    expect(value(rig.states("crap")[0])).toBeLessThanOrEqual(value(earlyCrap));
    const late = code(await rig.told(S1));
    expect(late.filter((l) => /^(- )?FAIL /.test(l))).toEqual([]);
    expect([...early, ...late].filter((l) => /^(- )?PASS CRAP/.test(l))).toEqual([]);
  });

  it("still passes early a function whose own lines the records in hand show run", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": "cold 6 c1\n" });
    const record = (lines: readonly number[]) => [sourceOf("src/a.ts", blobOf(rig), 1, lines)];
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], record: record([]) });
    rig.step();
    await rig.register(S1);
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], key: "key-2", pending: "queued" });
    await rig.edit({ "test/new.test.ts": "it\n" });
    rig.loader("test/new.test.ts", { closure: ["src/a.ts"], record: record([1]) });
    rig.step();
    expect(code(await rig.told(S1))).toContain("- PASS CRAP: 6, at or under 30");
  });
});

describe("an early judgement checks the threshold a failure failed at (review 0.1.324 B2)", () => {
  it("keeps a failure a threshold change alone passes through a quiet recount, until every record is in", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": "big 35 b1\n" });
    const record = [sourceOf("src/a.ts", blobOf(rig), 1, [1])];
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], record });
    rig.step();
    expect(rig.states("crap")).toEqual(["big fail 35"]);
    // The same CC from a new counter version: a recount, whose judgement is quiet.
    await rig.recount(counterV2({}));
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], key: "waiting", pending: "queued" });
    rig.loader("test/b.test.ts", { closure: ["src/a.ts"], record });
    rig.step({ threshold: 40, reseed: true });
    expect(rig.states("crap")).toEqual(["big fail 35"]);

    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], key: "waiting", record });
    rig.step({ threshold: 40 });
    expect(rig.states("crap")).toEqual(["big pass 35"]);
    expect(rig.transitions("src/a.ts", ["big"])).toEqual([]);
  });
});
