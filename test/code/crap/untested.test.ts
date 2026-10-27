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

const PROCESS =
  "They may run it in a worker thread or a process they start, which Squeal does not measure.";
const ONE_PROCESS =
  "The test file may run it in a worker thread or a process it starts, which Squeal does not measure.";
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
      "FAIL untested: small (src/a.ts:4): no test runs it in the test's own thread; 1 test file loads this file (complexity 3, CRAP 12). Squeal does not measure worker threads or child processes.",
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
      "FAIL untested: small (src/a.ts:4): no test runs it in the test's own thread; 3 test files load this file (complexity 3, CRAP 12). Squeal does not measure worker threads or child processes.",
    ]);
  });

  it("says when no test file loads the file", async () => {
    const rig = await judged();
    await rig.edit({ "src/b.ts": "lone 2 l1\n" });
    rig.step();
    expect(code(await rig.told(S1))).toEqual([
      "FAIL untested: lone (src/b.ts:1): no test file loads this file (complexity 2, CRAP 6). Squeal does not measure worker threads or child processes.",
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
      `FAIL untested: one (src/c.ts:1): no test runs it in the test's own thread; 2 test files load this file (complexity 2, CRAP 6). ${PROCESS} ${EXCLUDE}`,
      `FAIL untested: two (src/c.ts:2): no test runs it in the test's own thread; 2 test files load this file (complexity 2, CRAP 6). ${PROCESS}`,
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
      `FAIL untested: three (src/c.ts:3): no test runs it in the test's own thread; 2 test files load this file (complexity 2, CRAP 6). ${PROCESS}`,
    ]);
  });

  it("words the process sentence for one test file", async () => {
    const rig = await judged();
    await edited(rig, "src/c.ts", "one 2 o1\n", ["test/c.test.ts"], [], "k2");
    expect(code(await rig.told(S1))).toEqual([
      `FAIL untested: one (src/c.ts:1): no test runs it in the test's own thread; 1 test file loads this file (complexity 2, CRAP 6). ${ONE_PROCESS} ${EXCLUDE}`,
    ]);
  });

  it("names coverage.exclude once to each session", async () => {
    const rig = await judged();
    const s2 = consumer("s2");
    await rig.register(s2);
    await edited(rig, "src/c.ts", "one 2 o1\n", ["test/c.test.ts"], [], "k2");
    for (const session of [S1, s2]) {
      expect(code(await rig.told(session))).toEqual([
        `FAIL untested: one (src/c.ts:1): no test runs it in the test's own thread; 1 test file loads this file (complexity 2, CRAP 6). ${ONE_PROCESS} ${EXCLUDE}`,
      ]);
    }
  });

  it("gives no process sentence when a function of the file ran", async () => {
    const rig = await judged();
    await edited(rig, "src/c.ts", "one 2 o1\ntwo 2 t1\n", ["test/c.test.ts"], [2], "k2");
    expect(code(await rig.told(S1))).toEqual([
      "FAIL untested: one (src/c.ts:1): no test runs it in the test's own thread; 1 test file loads this file (complexity 2, CRAP 6). Squeal does not measure worker threads or child processes.",
    ]);
  });
});

const check = (path: string, qualifiedName: string) =>
  ({ kind: "code", path, qualifiedName, occurrence: 0 }) as const;
const entry = (
  measure: CodeMeasure,
  value: number | null,
  evidence: CodeCoverageEvidence,
  at = check("test/keys/validity/harness/assemble.ts", "relist"),
  line = at.qualifiedName === "relist" ? 150 : 12,
): CodeDeltaEntry => ({
  check: at,
  measure,
  kind: "first-seen-fail",
  value,
  threshold: 30,
  line,
  revision: 3,
  evidence,
});
const news = (entries: CodeDeltaEntry[], excludeHint = false): CodeNews => ({
  v: 1,
  entries,
  more: 0,
  ...(excludeHint ? { excludeHint } : {}),
});

describe("the texts of D6 and D9 (row 015-65)", () => {
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
      "- FAIL untested: no test runs it in the test's own thread; 5 test files load this file. Squeal does not measure worker threads or child processes.",
      "- FAIL CRAP: 42, over 30 (complexity 6)",
    ]);
  });
});

describe("the thread limit (row 015-80)", () => {
  // `lessons.md` Round 2 C3: the lint provider runs in a worker thread, which Squeal does not measure.
  const lint = check("src/core/lint/provider/session.ts", "EslintSession.lint");
  const LIMIT = "Squeal does not measure worker threads or child processes.";

  it("says a CRAP line's function ran in no test's own thread, and what Squeal does not measure", () => {
    const e = { complexity: 13, lines: 40, covered: 0, testFiles: 0, first: [] };
    expect(codeLines(news([entry("crap", 182, e, lint, 207)]), "squeal")).toEqual([
      `FAIL CRAP: EslintSession.lint (src/core/lint/provider/session.ts:207): 182, over 30 (complexity 13; no test runs it in the test's own thread). ${LIMIT}`,
    ]);
  });

  it("says a worker thread the loaders start may run an untested function", () => {
    const e = { complexity: 13, lines: 40, covered: 0, testFiles: 0, first: [] };
    const told = { ...e, loaders: 3, processes: true as const, crap: 182 };
    expect(
      codeLines(
        news([entry("crap", 182, e, lint, 207), entry("uncovered", null, told, lint, 207)], true),
        "squeal",
      ),
    ).toEqual([
      "EslintSession.lint (src/core/lint/provider/session.ts:207):",
      `- FAIL untested: no test runs it in the test's own thread; 3 test files load this file. They may run it in a worker thread or a process they start, which Squeal does not measure. ${EXCLUDE}`,
      "- FAIL CRAP: 182, over 30 (complexity 13)",
    ]);
  });

  it("states the limit on an untested line whose file's other functions ran", () => {
    const e = {
      complexity: 3,
      lines: 4,
      covered: 0,
      testFiles: 0,
      first: [],
      loaders: 1,
      crap: 12,
    };
    expect(codeLines(news([entry("uncovered", null, e, lint, 90)]), "squeal")).toEqual([
      `FAIL untested: EslintSession.lint (src/core/lint/provider/session.ts:90): no test runs it in the test's own thread; 1 test file loads this file (complexity 3, CRAP 12). ${LIMIT}`,
    ]);
  });

  it("states the limit when no test file loads the file a worker thread runs from a bundle", () => {
    // `test/lint/provider/helpers.ts` bundles `worker.ts` and runs the bundle in the thread.
    const e = {
      complexity: 13,
      lines: 40,
      covered: 0,
      testFiles: 0,
      first: [],
      loaders: 0,
      crap: 182,
    };
    expect(codeLines(news([entry("uncovered", null, e, lint, 207)]), "squeal")).toEqual([
      `FAIL untested: EslintSession.lint (src/core/lint/provider/session.ts:207): no test file loads this file (complexity 13, CRAP 182). ${LIMIT}`,
    ]);
  });

  it("says a passing function runs in the test's own thread", () => {
    const e = { complexity: 3, lines: 4, covered: 4, testFiles: 2, first: ["test/lint.test.ts"] };
    const pass = { ...entry("uncovered", null, e, lint, 90), kind: "fail-to-pass" as const };
    expect(codeLines(news([pass]), "squeal")).toEqual([
      "PASS untested: EslintSession.lint (src/core/lint/provider/session.ts:90): test/lint.test.ts and 1 more test file run it in their own threads",
    ]);
  });
});
