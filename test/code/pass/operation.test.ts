import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { git } from "../../hash/git-repo.js";
import { consumer, type Rig, rig } from "./rig.js";

/*
 * Spec 015 D6 as amended by 015-34 (lessons.md "Round 1 (015-10)" B1):
 * while a merge, cherry-pick, revert or rebase is under way, a file whose
 * blob is its blob at the commit the operation brings marks no first
 * edit, as 015-19 does for a moved `HEAD`. An edit to that file after it
 * is the agent's.
 */

const C1 = consumer("s1");
const still = (cc: number) =>
  `STILL FAIL complexity: settle (src/a.ts:1) is ${cc} after the edit; it was already over 20 before it (ESLint rule); Squeal stays quiet about it until it is at or under 20, and squeal code src/a.ts shows its count.`;
const TOPIC = { "src/a.ts": "settle 25 B4\npay 20 B2\n", "notes.md": "topic\n" };
const PATHS = ["src/a.ts", "notes.md"];

let r: Rig;
const left = (name: string) => existsSync(join(r.tree.root, ".git", name));

/** The session's edit after the operation: still its own. */
async function editAfter() {
  const edited = await r.edit({ "src/a.ts": "settle 26 B5\npay 20 B2\n" });
  expect(edited?.edited.map((c) => c.qualifiedName)).toEqual(["settle"]);
  expect(await r.told(C1)).toEqual([still(26)]);
}

beforeEach(async () => {
  r = rig();
  await r.pull({ "src/a.ts": "settle 23 B1\npay 20 B2\n", "notes.md": "base\n" });
});

describe("an operation git stopped, with HEAD where it was (015-34)", () => {
  it("a merge stopped by a conflict marks no edit for a body it brought", async () => {
    r.tree.branch("topic", TOPIC);
    await r.pull({ "notes.md": "main\n" });
    await r.register(C1);
    r.tree.run(["merge", "-q", "topic"], ...PATHS).revise();
    expect(left("MERGE_HEAD")).toBe(true);
    expect(await r.pass()).toMatchObject({ edited: [] });
    expect(await r.told(C1)).toEqual([]);
    await editAfter();
  });

  it("a cherry-pick stopped by a conflict marks no edit for a body it brought", async () => {
    const topic = r.tree.branch("topic", TOPIC);
    await r.pull({ "notes.md": "main\n" });
    await r.register(C1);
    r.tree.run(["cherry-pick", topic], ...PATHS).revise();
    expect(left("CHERRY_PICK_HEAD")).toBe(true);
    expect(await r.pass()).toMatchObject({ edited: [] });
    expect(await r.told(C1)).toEqual([]);
    await editAfter();
  });

  it("a revert stopped by a conflict marks no edit for the body it brought back", async () => {
    await r.pull(TOPIC);
    const reverted = git(r.tree.root, ["rev-parse", "HEAD"]).trim();
    await r.pull({ "notes.md": "main\n" });
    await r.register(C1);
    r.tree.run(["revert", "--no-edit", reverted], ...PATHS).revise();
    expect(left("REVERT_HEAD")).toBe(true);
    expect(await r.pass()).toMatchObject({ edited: [] });
    expect(await r.told(C1)).toEqual([]);
  });

  it("a rebase step stopped by a conflict marks no edit for a body it brought", async () => {
    r.tree.branch("topic", TOPIC);
    await r.pull({ "notes.md": "main\n" });
    await r.register(C1);
    // Checks out topic, then main's tip again, and stops picking topic's commit: HEAD is where it was.
    r.tree.run(["rebase", "main", "topic"], ...PATHS).revise();
    expect(left("REBASE_HEAD")).toBe(true);
    expect(await r.pass()).toMatchObject({ edited: [] });
    expect(await r.told(C1)).toEqual([]);
    await editAfter();
  });

  it("a rebase under way marks no edit for a body at HEAD that a revision saw after HEAD", async () => {
    r.tree.branch("topic", { "src/a.ts": "settle 25 B4\npay 20 B2\n" });
    await r.pull({ "notes.md": "main\n" });
    await r.register(C1);
    // `break` after the pick: the rebase stops with HEAD at the picked commit, no REBASE_HEAD.
    r.tree.run(["-c", "sequence.editor=sed -i -e '$a break'", "rebase", "-i", "main", "topic"]);
    // A revision that read HEAD before it saw the file the step wrote.
    r.tree.revise();
    await r.pass();
    r.tree.reread("src/a.ts").revise();
    expect(left("rebase-merge")).toBe(true);
    expect(left("REBASE_HEAD")).toBe(false);
    expect(await r.pass()).toMatchObject({ edited: [] });
    expect(await r.told(C1)).toEqual([]);
    await editAfter();
  });

  it("marks the edit once the operation is over, as before", async () => {
    r.tree.branch("topic", TOPIC);
    await r.pull({ "notes.md": "main\n" });
    r.tree.run(["merge", "-q", "topic"], ...PATHS);
    r.tree.run(["merge", "--abort"], ...PATHS).revise();
    await r.pass();
    await r.register(C1);
    // `git checkout topic -- src/a.ts` with no merge under way: the agent's own change.
    r.tree.run(["checkout", "topic", "--", "src/a.ts"], "src/a.ts").revise();
    expect((await r.pass())?.edited.map((c) => c.qualifiedName)).toEqual(["settle"]);
    expect(await r.told(C1)).toEqual([still(25)]);
  });
});
