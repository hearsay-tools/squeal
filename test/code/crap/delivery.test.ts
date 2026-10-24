import { describe, expect, it } from "vitest";
import { WT } from "../../state/helpers.js";
import { type CoverageRig, consumer, coverageRig, sourceOf } from "./rig.js";

/*
 * Spec 015 D9 Delivery (row 015-12): `crap` and `uncovered` are told as
 * complexity is (D5, D6), and a FAIL names the CC, the coverage and the
 * test files that ran the function, as evidence.
 */

const A = "hot 12 h1\ncold 6 c1\nbig 35 b1\n";

const blobOf = (rig: CoverageRig) => rig.store.files.list(WT, ["src/a.ts"])[0]?.blob ?? "";

/** The code lines of a delivery: the title and each line about a function. */
const code = (lines: readonly string[]) =>
  lines.filter((l) => /^(FAIL|PASS|RESOLVED|STILL FAIL) |code change|complexity change/.test(l));

/** A worktree whose `src/a.ts` ran `hot` and `big` in `test/a.test.ts`, judged, and a session registered after. */
async function judged(): Promise<CoverageRig> {
  const rig = coverageRig();
  await rig.edit({ "src/a.ts": A });
  rig.loader("test/a.test.ts", {
    closure: ["src/a.ts"],
    record: [sourceOf("src/a.ts", blobOf(rig), 3, [1, 3])],
  });
  rig.step();
  await rig.register(consumer("s1"));
  return rig;
}

/** An edit that re-keys the loader, and its run's record. */
async function edited(rig: CoverageRig, text: string, ran: readonly number[], key: string) {
  await rig.edit({ "src/a.ts": text });
  const functions = text.trim().split("\n").length;
  rig.loader("test/a.test.ts", {
    closure: ["src/a.ts"],
    key,
    record: [sourceOf("src/a.ts", blobOf(rig), functions, ran)],
  });
  rig.step();
}

describe("CRAP and uncovered deliveries", () => {
  it("tells nothing of the states there at registration", async () => {
    const rig = await judged();
    expect(rig.states("crap")).toEqual(["big fail 35", "cold fail 42", "hot pass 12"]);
    expect(code(await rig.told(consumer("s1")))).toEqual([]);
  });

  it("tells a new function no in-process test reaches, as evidence", async () => {
    const rig = await judged();
    await edited(rig, `${A}fresh 8 f1\n`, [1, 3], "key-2");
    expect(code(await rig.told(consumer("s1")))).toEqual([
      "SQUEAL · 2 code changes at revision 0",
      "FAIL CRAP: fresh (src/a.ts:4) is 72, over 30 (CC 8); no in-process test that Squeal runs reaches it",
      "FAIL uncovered: fresh (src/a.ts:4): no in-process test that Squeal runs reaches it (CC 8)",
    ]);
    // Told once.
    expect(code(await rig.told(consumer("s1")))).toEqual([]);
  });

  it("names the CC, the share of lines that ran and the test files that ran it", async () => {
    const rig = await judged();
    rig.loader("test/b.test.ts", { closure: ["src/a.ts"], record: [] });
    // `hot` goes over: CC 31 while it still runs.
    await edited(rig, "hot 31 h2\ncold 6 c1\nbig 35 b1\n", [1, 3], "key-2");
    expect(code(await rig.told(consumer("s1")))).toContain(
      "FAIL CRAP: hot (src/a.ts:1) is 31, over 30: CC 31, 100% of its lines ran in test/a.test.ts",
    );
  });

  it("tells a recovery of a function failing at registration once a test runs it", async () => {
    const rig = await judged();
    await edited(rig, A, [1, 2, 3], "key-2");
    expect(code(await rig.told(consumer("s1")))).toEqual([
      "SQUEAL · 2 code changes at revision 0",
      "PASS CRAP: cold (src/a.ts:2) is 6, at or under 30",
      "PASS uncovered: cold (src/a.ts:2): test/a.test.ts runs it in process",
    ]);
  });

  it("tells a removed function told failing as resolved, and nothing while its file waits", async () => {
    const rig = await judged();
    await edited(rig, `${A}fresh 8 f1\n`, [1, 3], "key-2");
    await rig.told(consumer("s1"));
    await rig.edit({ "src/a.ts": A });
    rig.loader("test/a.test.ts", { closure: ["src/a.ts"], key: "key-3", pending: "queued" });
    rig.step();
    expect(code(await rig.told(consumer("s1")))).toEqual([
      "SQUEAL · 2 code changes at revision 0",
      "RESOLVED CRAP: fresh (src/a.ts) is no longer in the code",
      "RESOLVED uncovered: fresh (src/a.ts) is no longer in the code",
    ]);
  });

  it("with coverage never judged, tells complexity as before", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": "hot 12 h1\n" });
    await rig.register(consumer("s1"));
    await rig.edit({ "src/a.ts": "hot 25 h2\n" });
    const lines = await rig.told(consumer("s1"));
    expect(code(lines)).toEqual([
      "SQUEAL · 1 complexity change at revision 0",
      "FAIL complexity: hot (src/a.ts:1) is 25, over 20 (ESLint rule)",
    ]);
    expect(lines.join("\n")).not.toMatch(/CRAP|uncovered|code change/);
  });
});
