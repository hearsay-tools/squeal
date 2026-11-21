import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { commitPolicy } from "../../src/core/daemon/commit-mode.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { DEFAULT_POLICY, type Policy } from "../../src/core/types/policy.js";
import { git } from "../hash/git-repo.js";
import { claimRepo, fileName, type Side, side } from "./claims-fixture.js";

/*
 * Row 023-46 (`tasks/023-46-notes.md`): a start keys each listed file from
 * the stored closure list, and walks a miss again only when the store holds
 * no walk of that file at the key the list gives here. A walk row exists
 * only where a real walk keyed the file; equal keys are equal closure paths
 * and bytes, so that walk's answer is this one's. A commit daemon at a
 * commit near HEAD then walks only the files the diff reaches.
 */

const COUNT = 4;
const [F0, F1, F2, F3] = [0, 1, 2, 3].map(fileName) as [string, string, string, string];
const LOOKUP_ONLY: Pick<Policy, "baseline"> = { baseline: { onStart: "lookup-only" } };
/** The policy a commit daemon runs (D7.2): lookup-only whatever the file says. */
const COMMIT: Pick<Policy, "baseline"> = { baseline: commitPolicy(DEFAULT_POLICY).baseline };
/** Real schedulers, a real store and git: a loaded host needs headroom. */
const SLOW = { timeout: 60_000 } as const;

/** A closure as the Vitest adapter gives one: with its walk's imports, so a walk row is stored. */
const walked = (testFile: TestFileRef) => ({
  testFile,
  paths: [testFile.path],
  imports: [{ path: testFile.path, sha1: "0".repeat(40), static: [], dynamic: [] }],
});

/** A side over `root` whose runner walks as the Vitest adapter does, and the files it walked. */
function walking(root: string, policy: Pick<Policy, "baseline">): { s: Side; asked: string[] } {
  const s = side(root, { count: COUNT, policy, rerunCap: 0 });
  const asked: string[] = [];
  s.runner.closure = async (testFile) => {
    asked.push(testFile.path);
    return walked(testFile);
  };
  return { s, asked };
}

/** The repository with the main checkout started: it walked and stored every file, ran none. */
async function walkedRepo() {
  const repo = claimRepo(COUNT);
  const a = walking(repo.main, LOOKUP_ONLY);
  await a.s.scheduler.start();
  await a.s.quiet();
  expect(a.asked.sort()).toEqual([F0, F1, F2, F3]);
  expect(a.s.runner.runs).toEqual([]);
  return { ...repo, a: a.s };
}

describe("a start walks no miss whose walk the store holds at its key (023-46)", SLOW, () => {
  it("a worktree daemon with the same bytes walks nothing and keys as the walker did", async () => {
    const { other, a } = await walkedRepo();
    const b = walking(other, LOOKUP_ONLY);
    await b.s.scheduler.start();
    await b.s.quiet();

    expect(b.asked).toEqual([]);
    for (const path of [F0, F1, F2, F3]) {
      expect(b.s.keyOf(path)).not.toBeNull();
      expect(b.s.keyOf(path)).toBe(a.keyOf(path));
      // The closure rows are this worktree's, as the walk would have left them.
      const record = b.s.store.testFiles.get({ project: "", path });
      expect(record?.updatedBy).toBe(b.s.worktreeId);
      expect(record?.closure.paths).toEqual([path]);
    }
  });

  it("a commit daemon at the parent commit walks only the file the later commit changed", async () => {
    const { main } = claimRepo(COUNT);
    writeFileSync(join(main, F1), "// file 1, changed\n");
    git(main, ["commit", "-qam", "change f1"]);
    const a = walking(main, LOOKUP_ONLY);
    await a.s.scheduler.start();
    await a.s.quiet();
    const tree = join(dirname(main), "commit");
    git(main, ["worktree", "add", "-q", "--detach", tree, "HEAD~1"]);

    const c = walking(tree, COMMIT);
    await c.s.scheduler.start();
    await c.s.quiet();

    expect(c.asked).toEqual([F1]);
    expect(c.s.keyOf(F1)).not.toBe(a.s.keyOf(F1));
    for (const path of [F0, F2, F3]) expect(c.s.keyOf(path)).toBe(a.s.keyOf(path));
  });

  it("a walk at another key proves nothing: a file whose bytes differ here is walked", async () => {
    const { other, a } = await walkedRepo();
    writeFileSync(join(other, F2), "// file 2, edited here\n");
    const b = walking(other, LOOKUP_ONLY);
    await b.s.scheduler.start();
    await b.s.quiet();

    expect(b.asked).toEqual([F2]);
    expect(b.s.keyOf(F2)).not.toBe(a.keyOf(F2));
    expect(b.s.keyOf(F0)).toBe(a.keyOf(F0));
  });
});
