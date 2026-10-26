import { describe, expect, it } from "vitest";
import { WT } from "../../state/helpers.js";
import { COVERED, type CoverageRig, consumer, coverageRig, sourceOf } from "../crap/rig.js";
import { fakeCounter, pass } from "../pass/helpers.js";

/*
 * Spec 015 D6 as amended by 015-38, for D9's measures: a `PASS` of `crap`
 * or `uncovered` judged on a file whose last change git brought is taken
 * in by count for a function the session was told by count only, and told
 * for one it was told failing.
 */

const A = "hot 12 h1\ncold 6 c1\nbig 35 b1\n";
const S1 = consumer("s1");

const blobOf = (rig: CoverageRig) => rig.store.files.list(WT, ["src/a.ts"])[0]?.blob ?? "";

/** The code lines of a delivery, and a block's head (row 015-65). */
const code = (lines: readonly string[]) =>
  lines.filter((l) => /^(- )?(FAIL|PASS|RESOLVED|STILL FAIL) |^\w+ \(src\/[^)]*\):$/.test(l));

/** `src/a.ts` at `text`, by an edit or a pull, then its test's run at `key`, which ran the lines `ran`. */
async function change(
  rig: CoverageRig,
  text: string,
  { ran, key, pull }: { ran: readonly number[]; key: string; pull: boolean },
) {
  rig.tree.write("src/a.ts", text);
  if (pull) rig.tree.commit("src/a.ts");
  rig.tree.revise();
  rig.clock += 1_000;
  const at = rig.clock;
  await pass(rig.tree, rig.store, fakeCounter(), { policy: COVERED, now: () => at });
  rig.loader("test/a.test.ts", {
    closure: ["src/a.ts"],
    key,
    record: [sourceOf("src/a.ts", blobOf(rig), text.trim().split("\n").length, ran)],
  });
  rig.step();
}

/** `cold` and `big` fail `crap` and `big` and `cold` fail `uncovered` when `s1` registers. */
async function judged(): Promise<CoverageRig> {
  const rig = coverageRig();
  await change(rig, A, { ran: [1, 3], key: "key-1", pull: true });
  await rig.register(S1);
  return rig;
}

describe("a coverage PASS git brought (015-38)", () => {
  it("tells nothing of a pull's PASS for a function told by count", async () => {
    const rig = await judged();
    expect(rig.states("crap")).toEqual(["big fail 35", "cold fail 42", "hot pass 12"]);
    await change(rig, "hot 12 h1\ncold 6 c2\nbig 35 b1\n", {
      ran: [1, 2, 3],
      key: "key-2",
      pull: true,
    });
    expect(rig.states("crap")).toEqual(["big fail 35", "cold pass 6", "hot pass 12"]);
    expect(code(await rig.told(S1))).toEqual([]);
  });

  it("tells a pull's PASS for a function the session was told failing", async () => {
    const rig = await judged();
    await change(rig, `${A}fresh 8 f1\n`, { ran: [1, 3], key: "key-2", pull: false });
    expect(code(await rig.told(S1))).toEqual([
      "fresh (src/a.ts:4):",
      expect.stringMatching(/^- FAIL untested: /),
      expect.stringMatching(/^- FAIL CRAP: /),
    ]);
    await change(rig, `${A}fresh 8 f2\n`, { ran: [1, 2, 3, 4], key: "key-3", pull: true });
    expect(code(await rig.told(S1))).toEqual([
      "fresh (src/a.ts:4):",
      "- PASS untested: test/a.test.ts runs it in its own process",
      "- PASS CRAP: 8, at or under 30",
    ]);
  });
});
