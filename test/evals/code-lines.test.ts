import { describe, expect, it } from "vitest";
import { squealEvidence } from "../../evals/lib/index.mjs";
import { createStateSink } from "../../src/core/state/index.js";
import { type CoverageRig, consumer, coverageRig, sourceOf } from "../code/crap/rig.js";
import { check, result, WT } from "../state/helpers.js";

/*
 * Row 015-65: the evals read no code line, and a delivery's code lines come
 * after its last test block, so the eval parser reads them as that block's
 * body. The lines before 015-65 and the lines after it must leave what the
 * parser reads of the test news unchanged, so past results regrade as they
 * did. The delivery is the real formatter's.
 */

const S1 = consumer("s1");

/** The lines of 0.1.335's formatter for a function no test ran, in place of the new block. */
const OLD = [
  "FAIL CRAP: one (src/c.ts:1) is 42, over 30 (CC 6); no in-process test that Squeal runs reaches it",
  "FAIL uncovered: one (src/c.ts:1): no in-process test that Squeal runs reaches it (CC 6)",
  "STILL FAIL uncovered: two (src/c.ts:2): no in-process test that Squeal runs reaches it after the edit; none reached it before it either (CC 6); Squeal stays quiet about it until an in-process test runs it, and squeal code src/c.ts shows its coverage.",
];

/** A code line, or a block's head (row 015-65). */
const isCode = (l: string) =>
  /^(- )?(FAIL|PASS|RESOLVED|STILL FAIL) [a-zA-Z]+: |^\w+ \(src\/[^)]*\):$/.test(l);

/** `path`'s blob now. */
const blobOf = (rig: CoverageRig, path: string) => rig.store.files.list(WT, [path])[0]?.blob ?? "";

/**
 * Coverage judged, then S1 registers; then its delivery with a test of
 * `test/b.test.ts` failing and a new `src/c.ts` whose functions no test ran.
 */
async function delivery(): Promise<string[]> {
  const rig = coverageRig();
  rig.loader("test/b.test.ts", { closure: [] });
  await rig.edit({ "src/a.ts": "hot 2 h1\n" });
  rig.loader("test/a.test.ts", {
    closure: ["src/a.ts"],
    record: [sourceOf("src/a.ts", blobOf(rig, "src/a.ts"), 1, [1])],
  });
  rig.step();
  await rig.register(S1);
  await rig.edit({ "src/c.ts": "one 6 o1\ntwo 2 t1\n" });
  rig.loader("test/c.test.ts", {
    closure: ["src/c.ts"],
    record: [sourceOf("src/c.ts", blobOf(rig, "src/c.ts"), 2, [])],
  });
  rig.step();
  const file = { project: "", path: "test/b.test.ts" };
  createStateSink(rig.main, { now: () => rig.clock }).applyResults(
    WT,
    1,
    [result(check("t", file), "fail", { key: "key-test/b.test.ts" })],
    { checkpointId: null },
  );
  return rig.told(S1);
}

describe("the evals' reading of a delivery's code lines (row 015-65)", () => {
  it("reads the same test news with the new code lines, the old ones or none", async () => {
    const lines = await delivery();
    const code = lines.filter(isCode);
    // The new lines are there: one block, the process sentence and the pointer.
    expect(code).toEqual([
      "one (src/c.ts:1):",
      "- FAIL untested: no test runs it in its own process; 1 test file loads this file. The test file may run it in a process it starts, which Squeal does not measure. To stop checking such files, add them to coverage.exclude in squeal.config.json.",
      "- FAIL CRAP: 42, over 30 (complexity 6)",
      "FAIL untested: two (src/c.ts:2): no test runs it in its own process; 1 test file loads this file (complexity 2, CRAP 6). The test file may run it in a process it starts, which Squeal does not measure.",
    ]);
    const without = lines.filter((l) => !isCode(l));
    const read = (text: readonly string[]) => squealEvidence(text.join("\n"), "push");
    const none = read(without);
    expect(none?.checks).toEqual([
      expect.objectContaining({ file: "test/b.test.ts", to: "fail", validity: "current" }),
    ]);
    expect(read(lines)).toEqual(none);
    expect(read([...without, ...OLD])).toEqual(none);
  });

  it("reads the same from a Claude Code hook's context", async () => {
    const lines = await delivery();
    const hooked = (text: readonly string[]) =>
      squealEvidence(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PostToolBatch",
            additionalContext: text.join("\n"),
          },
        }),
        "push",
      );
    const without = lines.filter((l) => !isCode(l));
    const none = hooked(without);
    expect(none?.checks).toEqual([
      expect.objectContaining({ file: "test/b.test.ts", to: "fail", validity: "current" }),
    ]);
    expect(hooked(lines)).toEqual(none);
    expect(hooked([...without, ...OLD])).toEqual(none);
  });
});
