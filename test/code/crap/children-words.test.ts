import { describe, expect, it } from "vitest";
import {
  coverageByFunction,
  coverageLines,
  coverageReport,
  coverageWords,
} from "../../../src/cli/code-coverage.js";
import { ALL_CHECKS } from "../../../src/core/code/crap/checks.js";
import { summaryKey } from "../../../src/core/code/crap/summary.js";
import { WT } from "../../state/helpers.js";
import { type CoverageRig, consumer, coverageRig, sourceOf } from "./rig.js";

/*
 * Spec 020 D12.7 (row 020-10b, request 7f914e71): where the coverage step
 * judged with `coverage.children`, the summary says so, and the delivery
 * lines and `squeal code` say that what the processes and threads a test
 * starts run counts, as a lower bound. With the key off, the summary and
 * every text are byte for byte as before.
 */

const A = "hot 12 h1\ncold 6 c1\nbig 35 b1\n";
const S1 = consumer("s1");
const CHILDREN = { ...ALL_CHECKS, children: true };

const blobOf = (rig: CoverageRig, path: string) => rig.store.files.list(WT, [path])[0]?.blob ?? "";
const code = (lines: readonly string[]) =>
  lines.filter((l) => /^(- )?(FAIL|PASS|RESOLVED|STILL FAIL) /.test(l));

/** `src/a.ts` run by `test/a.test.ts` (`hot` and `big` ran), judged, and a session registered after. */
async function judged(children: boolean) {
  const rig = coverageRig();
  const step = () => rig.step(children ? { checks: CHILDREN } : {});
  await rig.edit({ "src/a.ts": A });
  rig.loader("test/a.test.ts", {
    closure: ["src/a.ts"],
    record: [sourceOf("src/a.ts", blobOf(rig, "src/a.ts"), 3, [1, 3])],
  });
  step();
  await rig.register(S1);
  /** An edit of `path` whose loaders' records show `ran` of its functions. */
  const edited = async (path: string, text: string, ran: readonly number[], key: string) => {
    await rig.edit({ [path]: text });
    const functions = text.trim().split("\n").length;
    rig.loader("test/a.test.ts", {
      closure: [path],
      key,
      record: [sourceOf(path, blobOf(rig, path), functions, ran)],
    });
    step();
  };
  return { rig, edited };
}

/** `squeal code src/a.ts`'s words for `name`, and the coverage part's lines without paths. */
function squealCode(rig: CoverageRig, name: string) {
  const by = coverageByFunction(rig.store, WT, ["src/a.ts"]);
  const id = [...by.keys()].find((k) => k.split("\0")[1]?.startsWith(name));
  const part = coverageLines(
    coverageReport(rig.store, WT, () => true, undefined),
    false,
    "squeal",
  );
  return { words: coverageWords(id === undefined ? undefined : by.get(id)), part };
}

const OLD_UNMEASURED = "Squeal does not measure worker threads or child processes.";
const LOWER_BOUND =
  "Squeal counts what the processes and threads a test starts run as a lower bound: a process that is killed, outlives its test file or gets an environment without NODE_V8_COVERAGE is not counted.";

describe("the words with coverage.children off: as before (020 D12.7)", () => {
  it("keeps the summary and every text byte for byte", async () => {
    const { rig, edited } = await judged(false);
    await edited("src/a.ts", `${A}small 3 s1\n`, [1, 3], "k2");

    expect(rig.store.meta.get(summaryKey(WT))).not.toContain("children");
    expect(code(await rig.told(S1))).toEqual([
      `FAIL untested: small (src/a.ts:4): no test runs it in the test's own thread; 1 test file loads this file (complexity 3, CRAP 12). ${OLD_UNMEASURED}`,
    ]);
    const { words, part } = squealCode(rig, "small");
    expect(words).toBe("; CRAP 12; untested: no test runs it in the test's own thread");
    expect(part).toContain(
      `  Coverage counts what ran in the test's own thread. ${OLD_UNMEASURED}`,
    );

    await edited("src/a.ts", `${A}small 3 s1\n`, [1, 3, 4], "k3");
    expect(code(await rig.told(S1))).toEqual([
      "PASS untested: small (src/a.ts:4): test/a.test.ts runs it in its own thread",
    ]);
    expect(squealCode(rig, "small").words).toBe("; CRAP 3; 100% of its lines ran in 1 test file");

    await edited("src/c.ts", "one 2 o1\n", [], "k4");
    expect(code(await rig.told(S1))).toEqual([
      "FAIL untested: one (src/c.ts:1): no test runs it in the test's own thread; 1 test file loads this file (complexity 2, CRAP 6). The test file may run it in a worker thread or a process it starts, which Squeal does not measure. To stop checking such files, add them to coverage.exclude in squeal.config.json.",
    ]);
  });
});

describe("the words with coverage.children on (020 D12.7)", () => {
  it("say the processes and threads a test starts count, as a lower bound", async () => {
    const { rig, edited } = await judged(true);
    await edited("src/a.ts", `${A}small 3 s1\n`, [1, 3], "k2");

    expect(JSON.parse(rig.store.meta.get(summaryKey(WT)) ?? "{}")).toMatchObject({
      children: true,
    });
    expect(code(await rig.told(S1))).toEqual([
      `FAIL untested: small (src/a.ts:4): no test runs it, in the test's own thread or in a process or thread the test starts; 1 test file loads this file (complexity 3, CRAP 12). ${LOWER_BOUND}`,
    ]);
    const { words, part } = squealCode(rig, "small");
    expect(words).toBe(
      "; CRAP 12; untested: no test runs it, in the test's own thread or in a process or thread the test starts",
    );
    expect(part).toContain(
      `  Coverage counts what ran in the test's own thread and in the processes and threads it started. ${LOWER_BOUND}`,
    );

    await edited("src/a.ts", `${A}small 3 s1\n`, [1, 3, 4], "k3");
    expect(code(await rig.told(S1))).toEqual([
      "PASS untested: small (src/a.ts:4): test/a.test.ts runs it",
    ]);

    await edited("src/c.ts", "one 2 o1\n", [], "k4");
    expect(code(await rig.told(S1))).toEqual([
      "FAIL untested: one (src/c.ts:1): no test runs it, in the test's own thread or in a process or thread the test starts; 1 test file loads this file (complexity 2, CRAP 6). The test file may run it in a process it starts that Squeal misses: one that is killed, outlives its test file or gets an environment without NODE_V8_COVERAGE. To stop checking such files, add them to coverage.exclude in squeal.config.json.",
    ]);
  });
});
