import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claimCommitWorktree,
  ensureCommitWorktree,
} from "../../src/core/checkout/commit-worktree.js";
import { gitCheckoutsDir } from "../../src/core/checkout/location.js";
import { readMarker, writeMarker } from "../../src/core/checkout/marker.js";
import { sweepCheckouts } from "../../src/core/checkout/sweep.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import {
  type CommitFixture,
  commitFixture,
  countingInstall,
  deadLease,
  git,
} from "./commit-fixture.js";

/*
 * Review wave-23 N1: a folder with a commit worktree's marker whose tree
 * fails the identity check (git no longer holds it locked, or a removal
 * left part of it) is kept whole. Neither the sweep nor a new worktree at
 * the same commit removes it recursively: it may hold files Squeal did not
 * make, and tree contents git did not remove. The sweep names it each run.
 */

let fx: CommitFixture;

beforeEach(() => {
  fx = commitFixture();
});

afterEach(() => {
  rmSync(fx.base, { recursive: true, force: true });
});

const LOCATIONS = {
  cache: (f: CommitFixture) => f.dir,
  "git folder": (f: CommitFixture) => gitCheckoutsDir(f.commonDir),
};

function ensure(dir: AbsolutePath) {
  return ensureCommitWorktree({
    root: fx.repo,
    commit: fx.first,
    dir,
    cacheRoot: fx.cacheRoot,
    install: countingInstall([]),
  });
}

/** The reviewer's probe: a claimed worktree, `user-file.txt` beside its tree, unlocked, its daemon dead. */
async function unlockedBesideUserFile(dir: AbsolutePath) {
  const worktree = await ensure(dir);
  claimCommitWorktree(worktree.tree);
  writeFileSync(join(worktree.folder, "user-file.txt"), "mine\n");
  git(fx.repo, "worktree", "unlock", worktree.tree);
  const marker = readMarker(worktree.folder);
  if (marker === null) throw new Error("no marker");
  writeMarker(worktree.folder, { ...marker, daemon: deadLease() });
  return worktree;
}

function keptNote(folder: AbsolutePath): string {
  return `squeal: kept ${folder}: its tree is not a commit worktree Squeal made; check it and remove it by hand`;
}

async function sweep(dir: AbsolutePath): Promise<string[]> {
  const notes: string[] = [];
  await sweepCheckouts({ commonDir: fx.commonDir, dirs: [dir], note: (t) => notes.push(t) });
  return notes;
}

describe.each(Object.entries(LOCATIONS))(
  "an identity-failed folder in the %s location (N1)",
  (_, dirOf) => {
    it("survives every sweep whole, and each sweep names it", async () => {
      const { folder, tree } = await unlockedBesideUserFile(dirOf(fx));

      expect(await sweep(dirOf(fx))).toEqual([keptNote(folder)]);
      expect(await sweep(dirOf(fx))).toEqual([keptNote(folder)]);

      expect(readFileSync(join(folder, "user-file.txt"), "utf8")).toBe("mine\n");
      expect(readFileSync(join(tree, "a.txt"), "utf8")).toBe("first\n");
      expect(existsSync(join(tree, ".git"))).toBe(true);
    });

    it("survives a tree git left half removed: no .git, its files still there", async () => {
      const { folder, tree } = await unlockedBesideUserFile(dirOf(fx));
      rmSync(join(tree, ".git"));

      expect(await sweep(dirOf(fx))).toEqual([keptNote(folder)]);
      await expect(ensure(dirOf(fx))).rejects.toThrow(`squeal: ${tree} is in the way`);

      expect(readFileSync(join(folder, "user-file.txt"), "utf8")).toBe("mine\n");
      expect(readdirSync(tree)).toEqual(["a.txt"]);
    });

    it("stops a new worktree at the same commit and stays whole", async () => {
      const { folder, tree } = await unlockedBesideUserFile(dirOf(fx));

      await expect(ensure(dirOf(fx))).rejects.toThrow(`squeal: ${tree} is in the way`);

      expect(readFileSync(join(folder, "user-file.txt"), "utf8")).toBe("mine\n");
      expect(existsSync(join(tree, ".git"))).toBe(true);
    });

    it("stops a new worktree beside a half-removed tree and keeps its files", async () => {
      const { folder, tree } = await unlockedBesideUserFile(dirOf(fx));
      rmSync(join(tree, ".git"));

      await expect(ensure(dirOf(fx))).rejects.toThrow(`squeal: ${tree} is in the way`);

      expect(readFileSync(join(folder, "user-file.txt"), "utf8")).toBe("mine\n");
      expect(readdirSync(tree)).toEqual(["a.txt"]);
    });
  },
);
