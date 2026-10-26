import { describe, expect, it } from "vitest";
import { readPulled } from "../../../src/core/code/pass/pulled.js";
import { codeSeenUpTo } from "../../../src/core/delivery/code-since.js";
import { WT } from "../../state/helpers.js";
import { type CoverageRig, consumer, coverageRig, sourceOf } from "./rig.js";

/*
 * Review 0.1.299 B1 (repair R7): a coverage STILL FAIL comes only for a
 * body the session wrote. An own edit whose coverage is still pending
 * when git replaces the function's file does not qualify the judgement of
 * git's body, though the complexity pass keeps its mark; an own edit
 * after it does, and so does one judged after unrelated revisions.
 */

const S1 = consumer("s1");

const blobOf = (rig: CoverageRig) => rig.store.files.list(WT, ["src/a.ts"])[0]?.blob ?? "";

/** The title, each line about a function and a block's head (row 015-65). */
const code = (lines: readonly string[]) =>
  lines.filter((l) =>
    /^(- )?(FAIL|PASS|RESOLVED|STILL FAIL) |^\w+ \(src\/[^)]*\):$|^SQUEAL · /.test(l),
  );

/** Row 015-65: no function of the file ran, so the line says its one loader may start a process, and the session's first such line names coverage.exclude. */
const PROCESS =
  "The test file may run it in a process it starts, which Squeal does not measure. To stop checking such files, add them to coverage.exclude in squeal.config.json.";

/** Stores the main store's revisions up to the tree's, so a registration counts from them. */
function mirror(rig: CoverageRig): void {
  const n = rig.tree.source.latestRevision();
  while ((rig.main.revisions.latest(WT)?.number ?? 0) < n) {
    rig.main.revisions.append({
      worktreeId: WT,
      createdAt: n,
      head: null,
      dirty: true,
      trigger: "watch",
      changes: [],
    });
  }
}

/** A current record at `key` for `src/a.ts`'s blob now, in which no line ran, then a step. */
function judgeNoHit(rig: CoverageRig, key: string, functions = 1): void {
  rig.loader("test/a.test.ts", {
    closure: ["src/a.ts"],
    key,
    record: [sourceOf("src/a.ts", blobOf(rig), functions, [])],
  });
  rig.step();
}

/** Revision 1: `text` committed and judged with no test reaching it; S1 registers. */
async function committed(text: string, functions = 1): Promise<CoverageRig> {
  const rig = coverageRig();
  await rig.pull({ "src/a.ts": text });
  judgeNoHit(rig, "key-1", functions);
  mirror(rig);
  await rig.register(S1);
  expect(codeSeenUpTo(rig.main, S1)).toEqual({ since: 1, gaps: [] });
  return rig;
}

/** An own edit whose test file is re-keyed and queued: its coverage waits. */
async function ownEditPending(rig: CoverageRig, files: Record<string, string>, key: string) {
  await rig.edit(files);
  mirror(rig);
  rig.loader("test/a.test.ts", {
    closure: ["src/a.ts"],
    key,
    pending: "queued",
    outcomes: [],
    record: null,
  });
  rig.step();
}

const still = (cc: number, crap: number, revision: number) => [
  `SQUEAL · 1 function still failing a code check at revision ${revision}`,
  "cold (src/a.ts:1):",
  `- STILL FAIL untested: no test runs it in its own process after the edit, nor did one before it; 1 test file loads this file. ${PROCESS} Squeal stays quiet about it until a test runs it in its own process, and squeal code src/a.ts shows its coverage.`,
  `- STILL FAIL CRAP: ${crap} after the edit; it was already over 30 before it (complexity ${cc}); Squeal stays quiet about it until it is at or under 30, and squeal code src/a.ts shows its CRAP.`,
];

describe("a coverage STILL FAIL for a body git brought after an own edit (review 0.1.299 B1)", () => {
  it("tells none for git's body, and STILL FAIL at the own edit after it", async () => {
    const rig = await committed("cold 6 c1\n");
    expect(rig.states("crap")).toEqual(["cold fail 42"]);
    // Revision 2: the own edit, CRAP 30 if judged; its coverage waits.
    await ownEditPending(rig, { "src/a.ts": "cold 5 c2\n" }, "key-2");
    expect(rig.states("crap")).toEqual(["cold fail 42"]);
    // Revision 3: git brings another body.
    await rig.pull({ "src/a.ts": "cold 8 c3\n" });
    mirror(rig);
    expect([...readPulled(rig.store.meta, WT)]).toEqual([["src/a.ts", 3]]);
    expect(rig.store.states.edits(WT, "complexity").map((e) => e.revision)).toEqual([2]);
    // Only revision 3's record comes.
    judgeNoHit(rig, "key-3");
    expect(rig.states("crap")).toEqual(["cold fail 72"]);
    expect(code(await rig.told(S1))).toEqual([]);
    // Revision 4: the session edits git's body.
    await rig.edit({ "src/a.ts": "cold 8 c4\n" });
    mirror(rig);
    judgeNoHit(rig, "key-4");
    expect(code(await rig.told(S1))).toEqual(still(8, 72, 4));
  });

  it("tells none for git's body when the session then edits another function of the file", async () => {
    const rig = await committed("cold 6 c1\nhot 3 h1\n", 2);
    await ownEditPending(rig, { "src/a.ts": "cold 5 c2\nhot 3 h1\n" }, "key-2");
    await rig.pull({ "src/a.ts": "cold 8 c3\nhot 3 h1\n" });
    mirror(rig);
    // The daemon's step after the pass; the file's coverage still waits.
    rig.step();
    // The own edit to `hot` leaves git's `cold` as it was, and the file out of the pulled record.
    await rig.edit({ "src/a.ts": "cold 8 c3\nhot 3 h2\n" });
    mirror(rig);
    expect([...readPulled(rig.store.meta, WT)]).toEqual([]);
    judgeNoHit(rig, "key-4", 2);
    const lines = code(await rig.told(S1));
    expect(lines.filter((l) => l.includes("cold ("))).toEqual([]);
    expect(lines.filter((l) => l.includes("hot ("))).toEqual([
      `STILL FAIL untested: hot (src/a.ts:2): no test runs it in its own process after the edit, nor did one before it; 1 test file loads this file (complexity 3, CRAP 12). ${PROCESS} Squeal stays quiet about it until a test runs it in its own process, and squeal code src/a.ts shows its coverage.`,
    ]);
  });

  it("keeps an own edit whose record comes after unrelated revisions", async () => {
    const rig = await committed("cold 6 c1\n");
    await ownEditPending(rig, { "src/a.ts": "cold 8 c2\n" }, "key-2");
    // Files Squeal does not count, one of them committed.
    await rig.edit({ "README.md": "readme\n" });
    await rig.pull({ "docs/notes.md": "notes\n" });
    mirror(rig);
    judgeNoHit(rig, "key-3");
    expect(code(await rig.told(S1))).toEqual(still(8, 72, 4));
  });
});
