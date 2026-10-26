import { describe, expect, it } from "vitest";
import { formatCodeReport } from "../../../src/cli/code.js";
import { readCodeReport } from "../../../src/cli/code-report.js";
import { recountLine, toldOverLine } from "../../../src/core/delivery/code-format.js";
import { createStateSink } from "../../../src/core/state/index.js";
import { check, result, WT } from "../../state/helpers.js";
import { type CoverageRig, consumer, coverageRig, sourceOf } from "./rig.js";

/*
 * Row 015-40 (wording in status.md, 2026-10-24): the told line and
 * `squeal code --told` count the `crap` and `uncovered` states told in
 * full that still fail, each measure apart, and leave out a measure with
 * none. With complexity only, every text is as before.
 */

const S1 = consumer("s1");
const POLICY = { threshold: 20, maxFileBytes: 524_288 };
const A = "hot 12 h1\ncold 6 c1\nbig 35 b1\n";

const blobOf = (rig: CoverageRig) => rig.store.files.list(WT, ["src/a.ts"])[0]?.blob ?? "";

/** `test/a.test.ts` runs `lines` of `src/a.ts` at its current blob, at `key`. */
function ran(rig: CoverageRig, lines: readonly number[], key: string) {
  rig.loader("test/a.test.ts", {
    closure: ["src/a.ts"],
    key,
    record: [sourceOf("src/a.ts", blobOf(rig), 5, lines)],
  });
  rig.step();
}

/**
 * `cold` and `big` fail at S1's registration, by count. Then `fresh`, run
 * by no test, fails CRAP and uncovered, and `sel` complexity, told in full.
 */
async function told(): Promise<CoverageRig> {
  const rig = coverageRig();
  rig.loader("test/b.test.ts", { closure: [] });
  await rig.edit({ "src/a.ts": A });
  ran(rig, [1, 3], "key-1");
  await rig.register(S1);
  await rig.edit({ "src/a.ts": `${A}fresh 8 f1\nsel 25 s1\n` });
  ran(rig, [1, 3, 5], "key-2");
  expect((await rig.told(S1)).filter((l) => l.startsWith("FAIL "))).toHaveLength(3);
  return rig;
}

/** The last line S1 gets with a test of `test/b.test.ts` failing as the news. */
async function testNewsTail(rig: CoverageRig): Promise<string | undefined> {
  const file = { project: "", path: "test/b.test.ts" };
  createStateSink(rig.main, { now: () => rig.clock }).applyResults(
    WT,
    1,
    [result(check("t", file), "fail", { key: "key-test/b.test.ts" })],
    { checkpointId: null },
  );
  return (await rig.told(S1)).at(-1);
}

describe("the told line and squeal code --told with CRAP and uncovered (015-40)", () => {
  it("counts each measure apart on test news", async () => {
    const rig = await told();
    expect(await testNewsTail(rig)).toBe(
      "Complexity: 1 function over 20, 1 over CRAP 30 and 1 no in-process test reaches, that this session was told about; squeal code --told lists them.",
    );
  });

  it("leaves out a measure with none", async () => {
    const rig = await told();
    // `sel` is back under 20; `fresh` stays failing.
    await rig.edit({ "src/a.ts": `${A}fresh 8 f1\nsel 15 s2\n` });
    ran(rig, [1, 3, 5], "key-3");
    await rig.told(S1);
    expect(await testNewsTail(rig)).toBe(
      "Complexity: 1 function over CRAP 30 and 1 no in-process test reaches, that this session was told about; squeal code --told lists them.",
    );
  });

  it("lists with --told the coverage states told in full beside complexity's", async () => {
    const rig = await told();
    const shell = { session: S1.sessionId, agent: null };
    const read = readCodeReport(rig.main, rig.store, WT, POLICY, {
      paths: null,
      changed: false,
      told: true,
      shell,
    });
    expect(read.functions.map((f) => f.qualifiedName)).toEqual(["sel"]);
    expect(read.coverage?.functions.map((f) => `${f.qualifiedName} ${f.measure}`)).toEqual([
      "fresh crap",
      "fresh uncovered",
    ]);
    expect(formatCodeReport(read)).toBe(
      [
        "Complexity: 1 function over 20 that this session was told about",
        "  src/a.ts:5  sel  CC 25 (if 24), over since revision 2",
        "Coverage: 1 function over CRAP 30 and 1 no in-process test reaches, that this session was told about",
        "  src/a.ts  fresh  CRAP 72, fail, since revision 2",
        "  src/a.ts  fresh  untested: no test runs it in its own process, since revision 2",
        "",
      ].join("\n"),
    );
  });

  it("keeps the complexity-only told and recount lines byte-identical", () => {
    expect(toldOverLine({ toldOver: { count: 2, threshold: 20 } }, "squeal")).toBe(
      "Complexity: 2 functions over 20 that this session was told about; squeal code --told lists them.",
    );
    expect(toldOverLine({ toldOver: { count: 1, threshold: 15 } }, "squeal")).toBe(
      "Complexity: 1 function over 15 that this session was told about; squeal code --told lists them.",
    );
    const recount = { revision: 3, at: 1_000, threshold: 15, over: 117 };
    expect(recountLine({ ...recount, reason: "threshold" }, "squeal")).toBe(
      "Complexity threshold is now 15: 117 functions over; squeal code lists them.",
    );
    expect(recountLine({ ...recount, reason: "first" }, "squeal")).toBe(
      "Complexity counted: 117 functions over 15; squeal code lists them.",
    );
    expect(recountLine({ ...recount, reason: "include" }, "squeal")).toBe(
      "Complexity counted again, the included files changed: 117 functions over 15; squeal code lists them.",
    );
    expect(recountLine({ ...recount, reason: "counter" }, "squeal")).toBe(
      "Complexity counted again by a new counter: 117 functions over 15; squeal code lists them.",
    );
  });
});
