import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commitFolderName } from "../../src/core/checkout/commit-identity.js";
import {
  claimCommitWorktree,
  ensureCommitWorktree,
  readCommitWorktree,
  removeCommitWorktree,
} from "../../src/core/checkout/commit-worktree.js";
import { gitCheckoutsDir } from "../../src/core/checkout/location.js";
import { markerPath, readMarker, writeMarker } from "../../src/core/checkout/marker.js";
import { leaseProcess } from "../../src/core/daemon/lease-process.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { type CommitFixture, commitFixture, countingInstall, git } from "./commit-fixture.js";

/*
 * Review wave-22 B1 (spec 023 D7.1, D7.2): read, claim and removal share one
 * identity check. A marker beside a tree is not enough: the tree must be a
 * worktree Squeal made in one of the repository's checkout locations. And
 * removal deletes only what Squeal made in the folder.
 */

let fx: CommitFixture;

beforeEach(() => {
  fx = commitFixture();
});

afterEach(() => {
  rmSync(fx.base, { recursive: true, force: true });
});

/** A valid commit worktree marker for `fx`, written beside `tree`. */
function markerBeside(tree: AbsolutePath, commonDir: AbsolutePath = fx.commonDir): string {
  const folder = join(tree, "..");
  writeMarker(folder, {
    v: 1,
    owner: leaseProcess(),
    commit: fx.first,
    commonDir,
    createdAt: Date.now(),
    fingerprint: "0123456789abcdef",
  });
  return readFileSync(markerPath(folder), "utf8");
}

/** Read, claim and removal of `tree` leave the folder exactly as it was. */
async function untouched(tree: AbsolutePath, marker: string): Promise<void> {
  const folder = join(tree, "..");
  const before = readdirSync(folder).sort();
  expect(readCommitWorktree(tree)).toBeNull();
  expect(() => claimCommitWorktree(tree)).toThrow(/is not a commit worktree/);
  await removeCommitWorktree(tree);
  expect(readdirSync(folder).sort()).toEqual(before);
  expect(readFileSync(markerPath(folder), "utf8")).toBe(marker);
  expect(readFileSync(join(folder, "user-sibling.txt"), "utf8")).toBe("mine\n");
  expect(existsSync(join(tree, ".git"))).toBe(true);
}

describe("a commit worktree's identity (review wave-22 B1)", () => {
  it("is not a normal repository at <ws>/tree with a valid marker beside it", async () => {
    const ws = join(fx.base, "ws");
    const tree = join(ws, "tree");
    mkdirSync(tree, { recursive: true });
    git(tree, "init", "-q", "-b", "main");
    writeFileSync(join(tree, "work.txt"), "user work\n");
    writeFileSync(join(ws, "user-sibling.txt"), "mine\n");
    const marker = markerBeside(tree);

    await untouched(tree, marker);
    expect(readFileSync(join(tree, "work.txt"), "utf8")).toBe("user work\n");
  });

  it("is not a user's worktree of the repository, even in the checkout location by name", async () => {
    // The right folder name in the git-folder location, but a worktree the user made.
    const folder = join(
      gitCheckoutsDir(fx.commonDir),
      commitFolderName(fx.first, "0123456789abcdef"),
    );
    const tree = join(folder, "tree");
    mkdirSync(folder, { recursive: true });
    git(fx.repo, "worktree", "add", "-q", "--detach", tree, fx.first);
    writeFileSync(join(folder, "user-sibling.txt"), "mine\n");
    const marker = markerBeside(tree);

    await untouched(tree, marker);
  });

  it("is not a repository's main worktree with its own marker beside it", async () => {
    const ws = join(fx.base, "main");
    const tree = join(ws, "tree");
    mkdirSync(tree, { recursive: true });
    git(tree, "init", "-q", "-b", "main");
    writeFileSync(join(ws, "user-sibling.txt"), "mine\n");
    const marker = markerBeside(tree, realpathSync(join(tree, ".git")));

    await untouched(tree, marker);
  });

  it("refuses a checkouts dir outside the repository's checkout locations", async () => {
    await expect(
      ensureCommitWorktree({
        root: fx.repo,
        commit: fx.first,
        dir: join(fx.base, "elsewhere"),
        cacheRoot: fx.cacheRoot,
        install: countingInstall([]),
      }),
    ).rejects.toThrow(/is not a checkout location/);
    expect(existsSync(join(fx.base, "elsewhere"))).toBe(false);
  });
});

describe("removal deletes only what Squeal made (review wave-22 B1)", () => {
  it("removes the tree and its own files, keeps a file it did not make, and says so", async () => {
    const made = await ensureCommitWorktree({
      root: fx.repo,
      commit: fx.first,
      dir: fx.dir,
      cacheRoot: fx.cacheRoot,
      install: countingInstall([]),
    });
    claimCommitWorktree(made.tree);
    writeFileSync(join(made.folder, "user-file.txt"), "mine\n");
    writeFileSync(join(made.folder, "run", "scratch.txt"), "a run's\n");

    const notes: string[] = [];
    await removeCommitWorktree(made.tree, { note: (text) => notes.push(text) });

    expect(existsSync(made.tree)).toBe(false);
    expect(readdirSync(made.folder)).toEqual(["user-file.txt"]);
    expect(notes).toEqual([
      `squeal: kept ${made.folder}: it holds files Squeal did not make: user-file.txt`,
    ]);
    expect(readMarker(made.folder)).toBeNull();
  });
});
