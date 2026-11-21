import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claimCommitWorktree,
  ensureCommitWorktree,
  removeCommitWorktree,
} from "../../src/core/checkout/commit-worktree.js";
import { gitCheckoutsDir } from "../../src/core/checkout/location.js";
import { readMarker, writeMarker } from "../../src/core/checkout/marker.js";
import { sweepCheckouts } from "../../src/core/checkout/sweep.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { type CommitFixture, commitFixture, countingInstall, deadLease } from "./commit-fixture.js";

/*
 * Review wave-22 N2, N3: a removal that keeps a file Squeal did not make
 * keeps the folder Squeal's, so no later sweep or create deletes that file;
 * and a removal never says a tree it cannot read is gone.
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

async function made(dir: AbsolutePath) {
  const worktree = await ensureCommitWorktree({
    root: fx.repo,
    commit: fx.first,
    dir,
    cacheRoot: fx.cacheRoot,
    install: countingInstall([]),
  });
  claimCommitWorktree(worktree.tree);
  return worktree;
}

/** The commit worktree removed by a daemon that then died, with `user-file.txt` beside its tree. */
async function removedBesideUserFile(dir: AbsolutePath) {
  const worktree = await made(dir);
  writeFileSync(join(worktree.folder, "user-file.txt"), "mine\n");
  expect(await removeCommitWorktree(worktree.tree)).toBe("removed");
  const marker = readMarker(worktree.folder);
  expect(marker?.fingerprint).toBe(worktree.fingerprint);
  // Its daemon exits after the removal.
  if (marker !== null) writeMarker(worktree.folder, { ...marker, daemon: deadLease() });
  return worktree;
}

describe.each(Object.entries(LOCATIONS))("a kept file in the %s location (N2)", (_, dirOf) => {
  it("survives the later sweep, which keeps the folder and says so", async () => {
    const { folder } = await removedBesideUserFile(dirOf(fx));

    const notes: string[] = [];
    await sweepCheckouts({
      commonDir: fx.commonDir,
      dirs: [dirOf(fx)],
      note: (t) => notes.push(t),
    });

    expect(readFileSync(join(folder, "user-file.txt"), "utf8")).toBe("mine\n");
    expect(readdirSync(folder)).toEqual(["marker.json", "user-file.txt"]);
    expect(notes).toEqual([
      `squeal: kept ${folder}: it holds files Squeal did not make: user-file.txt`,
    ]);
  });

  it("survives a new worktree at the same commit, made beside it", async () => {
    const { folder } = await removedBesideUserFile(dirOf(fx));

    const again = await made(dirOf(fx));

    expect(again.folder).toBe(folder);
    expect(existsSync(join(again.tree, ".git"))).toBe(true);
    expect(readFileSync(join(folder, "user-file.txt"), "utf8")).toBe("mine\n");
  });

  it("goes with its folder once the user removed it", async () => {
    const { folder } = await removedBesideUserFile(dirOf(fx));
    rmSync(join(folder, "user-file.txt"));

    await sweepCheckouts({ commonDir: fx.commonDir, dirs: [dirOf(fx)] });

    expect(existsSync(folder)).toBe(false);
  });
});

/** Whether this process can read a folder with no permissions: root and CAP_DAC_* can. */
function permissionsBind(): boolean {
  const probe = mkdtempSync(join(tmpdir(), "squeal-perm-"));
  mkdirSync(join(probe, "closed"));
  writeFileSync(join(probe, "closed", "f"), "");
  chmodSync(join(probe, "closed"), 0o000);
  try {
    readdirSync(join(probe, "closed"));
    return false;
  } catch {
    return true;
  } finally {
    chmodSync(join(probe, "closed"), 0o700);
    rmSync(probe, { recursive: true, force: true });
  }
}

describe("a tree it cannot read (N3)", () => {
  // Skipped where permissions do not bind: under root or a capability that bypasses them.
  it.skipIf(!permissionsBind())("is never reported removed", async () => {
    const worktree = await made(fx.dir);
    chmodSync(worktree.folder, 0o000);
    const notes: string[] = [];
    try {
      const said = await removeCommitWorktree(worktree.tree, { note: (t) => notes.push(t) });
      expect(said).toBe("unknown");
    } finally {
      chmodSync(worktree.folder, 0o700);
    }
    expect(notes).toEqual([`squeal: could not read ${worktree.tree}: it may still be there`]);
    expect(existsSync(join(worktree.tree, ".git"))).toBe(true);
  });

  it("says gone for a tree that is gone", async () => {
    const worktree = await made(fx.dir);
    expect(await removeCommitWorktree(worktree.tree)).toBe("removed");
    expect(await removeCommitWorktree(worktree.tree)).toBe("removed");
  });
});
