import { describe, expect, it } from "vitest";
import { WT } from "../../state/helpers.js";
import { type CoverageRig, consumer, coverageRig, sourceOf } from "./rig.js";

/*
 * Row 015-40: D6's first edit to a standing failure holds for `crap` and
 * `uncovered` as for complexity. The coverage step marks the edit the
 * complexity pass saw in the function's body, so a change git brought is
 * no edit here either (015-19), and 015-21's STILL FAIL text applies.
 */

const S1 = consumer("s1");
const A = "hot 12 h1\ncold 6 c1\nbig 35 b1\n";

const blobOf = (rig: CoverageRig) => rig.store.files.list(WT, ["src/a.ts"])[0]?.blob ?? "";

/** The title and each line about a function. */
const code = (lines: readonly string[]) =>
  lines.filter((l) => /^(FAIL|PASS|RESOLVED|STILL FAIL) |^SQUEAL · /.test(l));

/** `test/a.test.ts` runs `ran` lines of `src/a.ts` at its current blob, at `key`. */
function ran(rig: CoverageRig, lines: readonly number[], key: string) {
  const functions = 4;
  rig.loader("test/a.test.ts", {
    closure: ["src/a.ts"],
    key,
    record: [sourceOf("src/a.ts", blobOf(rig), functions, lines)],
  });
  rig.step();
}

/** `cold` fails CRAP and uncovered, `big` CRAP and complexity, judged; then S1 registers. */
async function judged(): Promise<CoverageRig> {
  const rig = coverageRig();
  await rig.edit({ "src/a.ts": A });
  ran(rig, [1, 3], "key-1");
  await rig.register(S1);
  return rig;
}

const STILL_CRAP =
  "STILL FAIL CRAP: cold (src/a.ts:2) is 42 after the edit; it was already over 30 before it (CC 6); no in-process test that Squeal runs reaches it; Squeal stays quiet about it until it is at or under 30, and squeal code src/a.ts shows its CRAP.";
const STILL_UNCOVERED =
  "STILL FAIL uncovered: cold (src/a.ts:2): no in-process test that Squeal runs reaches it after the edit; none reached it before it either (CC 6); Squeal stays quiet about it until an in-process test runs it, and squeal code src/a.ts shows its coverage.";

describe("the first edit to a standing CRAP or uncovered failure (015-40)", () => {
  it("tells STILL FAIL once for each measure the edit left failing, then is quiet", async () => {
    const rig = await judged();
    await rig.edit({ "src/a.ts": "hot 12 h1\ncold 6 c2\nbig 35 b1\n" });
    ran(rig, [1, 3], "key-2");
    expect(code(await rig.told(S1))).toEqual([
      "SQUEAL · 1 function still failing a code check at revision 0",
      STILL_CRAP,
      STILL_UNCOVERED,
    ]);
    expect(await rig.told(S1)).toEqual([]);
    await rig.edit({ "src/a.ts": "hot 12 h1\ncold 6 c3\nbig 35 b1\n" });
    ran(rig, [1, 3], "key-3");
    expect(await rig.told(S1)).toEqual([]);
  });

  it("tells the edit after a FAIL told in full as still over", async () => {
    const rig = await judged();
    await rig.edit({ "src/a.ts": `${A}fresh 8 f1\n` });
    ran(rig, [1, 3], "key-2");
    expect(code(await rig.told(S1))).toContain(
      "FAIL CRAP: fresh (src/a.ts:4) is 72, over 30 (CC 8); no in-process test that Squeal runs reaches it",
    );
    await rig.edit({ "src/a.ts": `${A}fresh 8 f2\n` });
    ran(rig, [1, 3], "key-3");
    expect(code(await rig.told(S1))).toEqual([
      "SQUEAL · 1 function still failing a code check at revision 0",
      "STILL FAIL CRAP: fresh (src/a.ts:4) is 72 after the edit, over 30 (CC 8); no in-process test that Squeal runs reaches it; Squeal stays quiet about it until it is at or under 30, and squeal code src/a.ts shows its CRAP.",
      "STILL FAIL uncovered: fresh (src/a.ts:4): no in-process test that Squeal runs reaches it after the edit (CC 8); Squeal stays quiet about it until an in-process test runs it, and squeal code src/a.ts shows its coverage.",
    ]);
  });

  it("tells nothing for a body git brought, and the session's own edit after it (015-19)", async () => {
    const rig = await judged();
    await rig.pull({ "src/a.ts": "hot 12 h1\ncold 6 c2\nbig 35 b1\n" });
    ran(rig, [1, 3], "key-2");
    expect(await rig.told(S1)).toEqual([]);
    await rig.edit({ "src/a.ts": "hot 12 h1\ncold 6 c3\nbig 35 b1\n" });
    ran(rig, [1, 3], "key-3");
    expect(code(await rig.told(S1))).toEqual([
      "SQUEAL · 1 function still failing a code check at revision 0",
      STILL_CRAP,
      STILL_UNCOVERED,
    ]);
  });

  it("tells nothing for an edit the coverage step judged before the session registered", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": A });
    ran(rig, [1, 3], "key-1");
    await rig.edit({ "src/a.ts": "hot 12 h1\ncold 6 c2\nbig 35 b1\n" });
    ran(rig, [1, 3], "key-2");
    await rig.register(S1);
    expect(await rig.told(S1)).toEqual([]);
  });

  it("keeps a complexity STILL FAIL's text and title as before, beside judged coverage", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": "hot 12 h1\ncold 6 c1\nmid 25 m1\n" });
    ran(rig, [1, 3], "key-1");
    await rig.register(S1);
    await rig.edit({ "src/a.ts": "hot 12 h1\ncold 6 c1\nmid 25 m2\n" });
    ran(rig, [1, 3], "key-2");
    expect(code(await rig.told(S1))).toEqual([
      "SQUEAL · 1 function still over the complexity threshold at revision 0",
      "STILL FAIL complexity: mid (src/a.ts:3) is 25 after the edit; it was already over 20 before it (ESLint rule); Squeal stays quiet about it until it is at or under 20, and squeal code src/a.ts shows its count.",
    ]);
  });

  it("titles a function still over complexity and CRAP once", async () => {
    const rig = await judged();
    await rig.edit({ "src/a.ts": "hot 12 h1\ncold 6 c1\nbig 35 b2\n" });
    ran(rig, [1, 3], "key-2");
    expect(code(await rig.told(S1))).toEqual([
      "SQUEAL · 1 function still failing a code check at revision 0",
      "STILL FAIL complexity: big (src/a.ts:3) is 35 after the edit; it was already over 20 before it (ESLint rule); Squeal stays quiet about it until it is at or under 20, and squeal code src/a.ts shows its count.",
      "STILL FAIL CRAP: big (src/a.ts:3) is 35 after the edit; it was already over 30 before it: CC 35, 100% of its lines ran in test/a.test.ts; Squeal stays quiet about it until it is at or under 30, and squeal code src/a.ts shows its CRAP.",
    ]);
  });
});
