import { describe, expect, it } from "vitest";
import { codeLines } from "../../../src/core/delivery/code-format.js";
import type { CodeMeasure } from "../../../src/core/types/code.js";
import type {
  CodeCoverageEvidence,
  CodeDeltaEntry,
  CodeNews,
} from "../../../src/core/types/code-delivery.js";
import { WT } from "../../state/helpers.js";
import { type CoverageRig, consumer, coverageRig, sourceOf } from "./rig.js";

/*
 * Row 015-65: spec 015 D9 **Delivery** as amended 2026-10-26. The
 * `uncovered` lines say `untested`, lead with the reason and state what
 * Squeal saw. `delivery.test.ts` holds the blocks of D6 **One function,
 * several changes**.
 */

const A = "hot 12 h1\ncold 6 c1\nbig 35 b1\n";
const S1 = consumer("s1");

const blobOf = (rig: CoverageRig, path: string) => rig.store.files.list(WT, [path])[0]?.blob ?? "";

/** The code lines of a delivery: each line about a function, and a block's head. */
const code = (lines: readonly string[]) =>
  lines.filter((l) => /^(- )?(FAIL|PASS|RESOLVED|STILL FAIL) |^\w+ \(src\/[^)]*\):$/.test(l));

const PROCESS = "They may run it in a process they start, which Squeal does not measure.";
const ONE_PROCESS =
  "The test file may run it in a process it starts, which Squeal does not measure.";
const EXCLUDE = "To stop checking such files, add them to coverage.exclude in squeal.config.json.";

/** `src/a.ts` run by `test/a.test.ts` (`hot` and `big` ran), judged, and a session registered after. */
async function judged(): Promise<CoverageRig> {
  const rig = coverageRig();
  await rig.edit({ "src/a.ts": A });
  rig.loader("test/a.test.ts", {
    closure: ["src/a.ts"],
    record: [sourceOf("src/a.ts", blobOf(rig, "src/a.ts"), 3, [1, 3])],
  });
  rig.step();
  await rig.register(S1);
  return rig;
}

/** An edit of `path` that re-keys each of `loaders`, whose records show `ran` of its functions. */
async function edited(
  rig: CoverageRig,
  path: string,
  text: string,
  loaders: readonly string[],
  ran: readonly number[],
  key: string,
) {
  await rig.edit({ [path]: text });
  const functions = text.trim().split("\n").length;
  for (const loader of loaders) {
    rig.loader(loader, {
      closure: [path],
      key: `${key}-${loader}`,
      record: [sourceOf(path, blobOf(rig, path), functions, ran)],
    });
  }
  rig.step();
}

describe("untested and CRAP lines (row 015-65)", () => {
  it("keeps one line for one change, with the complexity and the CRAP as evidence", async () => {
    const rig = await judged();
    // CC 3 at coverage 0 is CRAP 12, under 30: only `untested` changes.
    await edited(rig, "src/a.ts", `${A}small 3 s1\n`, ["test/a.test.ts"], [1, 3], "k2");
    expect(code(await rig.told(S1))).toEqual([
      "FAIL untested: small (src/a.ts:4): no test runs it in its own process; 1 test file loads this file (complexity 3, CRAP 12)",
    ]);
  });

  it("counts every test file whose closure holds the file", async () => {
    const rig = await judged();
    await edited(
      rig,
      "src/a.ts",
      `${A}small 3 s1\n`,
      ["test/a.test.ts", "test/b.test.ts", "test/c.test.ts"],
      [1, 3],
      "k2",
    );
    expect(code(await rig.told(S1))).toEqual([
      "FAIL untested: small (src/a.ts:4): no test runs it in its own process; 3 test files load this file (complexity 3, CRAP 12)",
    ]);
  });

  it("says when no test file loads the file", async () => {
    const rig = await judged();
    await rig.edit({ "src/b.ts": "lone 2 l1\n" });
    rig.step();
    expect(code(await rig.told(S1))).toEqual([
      "FAIL untested: lone (src/b.ts:1): no test file loads this file (complexity 2, CRAP 6)",
    ]);
  });

  it("adds the process sentence when the file loads and none of its functions ran, and names coverage.exclude once", async () => {
    const rig = await judged();
    await edited(
      rig,
      "src/c.ts",
      "one 2 o1\ntwo 2 t1\n",
      ["test/c.test.ts", "test/d.test.ts"],
      [],
      "k2",
    );
    expect(code(await rig.told(S1))).toEqual([
      `FAIL untested: one (src/c.ts:1): no test runs it in its own process; 2 test files load this file (complexity 2, CRAP 6). ${PROCESS} ${EXCLUDE}`,
      `FAIL untested: two (src/c.ts:2): no test runs it in its own process; 2 test files load this file (complexity 2, CRAP 6). ${PROCESS}`,
    ]);
    // A later line in the session keeps the sentence and leaves out the pointer.
    await edited(
      rig,
      "src/c.ts",
      "one 2 o1\ntwo 2 t1\nthree 2 r1\n",
      ["test/c.test.ts", "test/d.test.ts"],
      [],
      "k3",
    );
    expect(code(await rig.told(S1))).toEqual([
      `FAIL untested: three (src/c.ts:3): no test runs it in its own process; 2 test files load this file (complexity 2, CRAP 6). ${PROCESS}`,
    ]);
  });

  it("words the process sentence for one test file", async () => {
    const rig = await judged();
    await edited(rig, "src/c.ts", "one 2 o1\n", ["test/c.test.ts"], [], "k2");
    expect(code(await rig.told(S1))).toEqual([
      `FAIL untested: one (src/c.ts:1): no test runs it in its own process; 1 test file loads this file (complexity 2, CRAP 6). ${ONE_PROCESS} ${EXCLUDE}`,
    ]);
  });

  it("names coverage.exclude once to each session", async () => {
    const rig = await judged();
    const s2 = consumer("s2");
    await rig.register(s2);
    await edited(rig, "src/c.ts", "one 2 o1\n", ["test/c.test.ts"], [], "k2");
    for (const session of [S1, s2]) {
      expect(code(await rig.told(session))).toEqual([
        `FAIL untested: one (src/c.ts:1): no test runs it in its own process; 1 test file loads this file (complexity 2, CRAP 6). ${ONE_PROCESS} ${EXCLUDE}`,
      ]);
    }
  });

  it("gives no process sentence when a function of the file ran", async () => {
    const rig = await judged();
    await edited(rig, "src/c.ts", "one 2 o1\ntwo 2 t1\n", ["test/c.test.ts"], [2], "k2");
    expect(code(await rig.told(S1))).toEqual([
      "FAIL untested: one (src/c.ts:1): no test runs it in its own process; 1 test file loads this file (complexity 2, CRAP 6)",
    ]);
  });
});

describe("the texts of D6 and D9 (row 015-65)", () => {
  const check = (path: string, qualifiedName: string) =>
    ({ kind: "code", path, qualifiedName, occurrence: 0 }) as const;
  const entry = (
    measure: CodeMeasure,
    value: number | null,
    evidence: CodeCoverageEvidence,
    at = check("test/keys/validity/harness/assemble.ts", "relist"),
  ): CodeDeltaEntry => ({
    check: at,
    measure,
    kind: "first-seen-fail",
    value,
    threshold: 30,
    line: at.qualifiedName === "relist" ? 150 : 12,
    revision: 3,
    evidence,
  });
  const news = (entries: CodeDeltaEntry[]): CodeNews => ({ v: 1, entries, more: 0 });

  it("gives D9's CRAP line", () => {
    const rows = check("src/import/rows.ts", "parseRow");
    const e = { complexity: 9, lines: 10, covered: 4, testFiles: 1, first: ["rows.test.ts"] };
    expect(codeLines(news([entry("crap", 51, e, rows)]), "squeal")).toEqual([
      "FAIL CRAP: parseRow (src/import/rows.ts:12): 51, over 30 (complexity 9; 40% of its lines ran in rows.test.ts)",
    ]);
  });

  it("gives D6's block, whatever order the delivery lists its changes in", () => {
    const e = {
      complexity: 6,
      lines: 5,
      covered: 0,
      testFiles: 0,
      first: [],
      loaders: 5,
      crap: 42,
    };
    expect(codeLines(news([entry("crap", 42, e), entry("uncovered", null, e)]), "squeal")).toEqual([
      "relist (test/keys/validity/harness/assemble.ts:150):",
      "- FAIL untested: no test runs it in its own process; 5 test files load this file",
      "- FAIL CRAP: 42, over 30 (complexity 6)",
    ]);
  });
});
