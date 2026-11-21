import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commitWorktreeCeiling } from "../../src/core/checkout/commit-places.js";
import {
  claimCommitWorktree,
  ensureCommitWorktree,
  readCommitWorktree,
  removeCommitWorktree,
} from "../../src/core/checkout/commit-worktree.js";
import { gitCheckoutsDir } from "../../src/core/checkout/location.js";
import { readMarker, writeMarker } from "../../src/core/checkout/marker.js";
import { sweepCheckouts } from "../../src/core/checkout/sweep.js";
import {
  type CommitFixture,
  commitFixture,
  countingInstall,
  deadLease,
  git,
  liveChild,
} from "./commit-fixture.js";

/*
 * Row 023-38 (spec 023 D7.1, D7.2's removal, D7.4): one commit worktree per
 * (repository, commit, environment), found by every caller, installed once,
 * removed by its daemon or by the sweep once its owner is gone, and a
 * ceiling that makes a new commit's creator wait for a place.
 */

let fx: CommitFixture;
let calls: string[];

beforeEach(() => {
  fx = commitFixture();
  calls = [];
});

afterEach(() => {
  rmSync(fx.base, { recursive: true, force: true });
});

const ensure = (commit: string, extra: Partial<Parameters<typeof ensureCommitWorktree>[0]> = {}) =>
  ensureCommitWorktree({
    root: fx.repo,
    commit,
    dir: fx.dir,
    cacheRoot: fx.cacheRoot,
    install: countingInstall(calls, 100),
    ...extra,
  });

const worktrees = () =>
  git(fx.repo, "worktree", "list", "--porcelain")
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));

describe("the commit worktree's identity and reuse", () => {
  it("is one worktree for two callers at once, installed once, at the commit", async () => {
    const [a, b] = await Promise.all([ensure("HEAD~1"), ensure(fx.first)]);

    expect(b.tree).toBe(a.tree);
    expect(calls).toEqual([a.tree]);
    expect(a.commit).toBe(fx.first);
    expect(git(a.tree, "rev-parse", "HEAD").trim()).toBe(fx.first);
    expect(readFileSync(join(a.tree, "a.txt"), "utf8")).toBe("first\n");
    expect(readMarker(a.folder)).toMatchObject({
      owner: { pid: process.pid },
      commit: fx.first,
      commonDir: fx.commonDir,
      fingerprint: a.fingerprint,
      installed: true,
    });
    expect(readCommitWorktree(a.tree)).toEqual({
      commit: fx.first,
      fingerprint: a.fingerprint,
      commonDir: fx.commonDir,
      createdAt: expect.any(Number),
    });

    // A later caller finds it installed and installs nothing.
    expect((await ensure(fx.first)).tree).toBe(a.tree);
    expect(calls).toHaveLength(1);
  });

  it("is another worktree for another commit or another environment", async () => {
    const a = await ensure(fx.first);
    const other = await ensure(fx.second);
    const env = await ensure(fx.first, { environment: { NODE_ENV: "test" } });

    expect(new Set([a.tree, other.tree, env.tree]).size).toBe(3);
    expect(env.fingerprint).not.toBe(a.fingerprint);
    expect(calls).toHaveLength(3);
  });

  it("is taken over, not installed again, when its creator is gone", async () => {
    const a = await ensure(fx.first);
    const marker = readMarker(a.folder);
    if (marker === null) throw new Error("no marker");
    writeMarker(a.folder, { ...marker, owner: deadLease() });

    expect((await ensure(fx.first)).tree).toBe(a.tree);
    expect(readMarker(a.folder)?.owner.pid).toBe(process.pid);
    expect(calls).toHaveLength(1);
  });

  it("is removed when its frozen install fails, and the call says why", async () => {
    await expect(ensure(fx.first, { install: countingInstall(calls, 0, false) })).rejects.toThrow(
      /install .* failed: npm ci: exit 1/,
    );
    expect(worktrees()).toEqual([fx.repo]);
    expect(existsSync(fx.dir) ? readdirSync(fx.dir) : []).toEqual([]);
  });

  it("is not a commit worktree when the root is a user's worktree", () => {
    expect(readCommitWorktree(fx.repo)).toBeNull();
  });
});

describe("the ceiling (D7.4)", () => {
  it("follows free memory at 1 GB a daemon, at least 1, unless configured", () => {
    expect(commitWorktreeCeiling({ freeBytes: 6.5 * 1024 ** 3 })).toBe(6);
    expect(commitWorktreeCeiling({ freeBytes: 100 })).toBe(1);
    expect(commitWorktreeCeiling({ configured: 3, freeBytes: 100 })).toBe(3);
    expect(commitWorktreeCeiling({ configured: 0, freeBytes: 2 * 1024 ** 3 })).toBe(2);
  });

  it("makes a new commit's creator wait, say so, and go on once a place frees", async () => {
    const a = await ensure(fx.first, { limit: 1 });
    const notes: string[] = [];
    const waiting = ensure(fx.second, { limit: 1, pollMs: 20, note: (t) => notes.push(t) });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(notes).toEqual([expect.stringMatching(/^squeal: waiting for a place: 1 of 1 commit/)]);
    expect(notes[0]).toContain(fx.first.slice(0, 12));

    await removeCommitWorktree(a.tree);
    const b = await waiting;
    expect(git(b.tree, "rev-parse", "HEAD").trim()).toBe(fx.second);
    expect(notes).toHaveLength(1);
  });

  it("does not wait for the commit it already has, and gives up after the wait", async () => {
    await ensure(fx.first, { limit: 1 });
    await expect(ensure(fx.first, { limit: 1, placeWaitMs: 0 })).resolves.toBeDefined();
    await expect(ensure(fx.second, { limit: 1, placeWaitMs: 100, pollMs: 20 })).rejects.toThrow(
      /waiting for a place.*gave up/,
    );
  });

  it("does not count a worktree whose owner is gone", async () => {
    const a = await ensure(fx.first, { limit: 1 });
    const marker = readMarker(a.folder);
    if (marker === null) throw new Error("no marker");
    writeMarker(a.folder, { ...marker, owner: deadLease() });
    await expect(ensure(fx.second, { limit: 1, placeWaitMs: 0 })).resolves.toBeDefined();
  });
});

describe("removal (D7.2) and the sweep (D6)", () => {
  it("is done by its daemon, which claimed it, and is a no-op once gone", async () => {
    const a = await ensure(fx.first);
    claimCommitWorktree(a.tree);
    expect(readCommitWorktree(a.tree)?.daemon?.pid).toBe(process.pid);

    await removeCommitWorktree(a.tree);
    expect(existsSync(a.folder)).toBe(false);
    expect(worktrees()).toEqual([fx.repo]);
    await expect(removeCommitWorktree(a.tree)).resolves.toBeUndefined();
    await expect(removeCommitWorktree(fx.repo)).resolves.toBeUndefined();
  });

  it("keeps a worktree another live process owns now", async () => {
    const a = await ensure(fx.first);
    const other = liveChild();
    try {
      const marker = readMarker(a.folder);
      if (marker === null) throw new Error("no marker");
      writeMarker(a.folder, { ...marker, daemon: other.lease });
      const notes: string[] = [];
      await removeCommitWorktree(a.tree, { note: (t) => notes.push(t) });
      expect(existsSync(a.tree)).toBe(true);
      expect(notes).toEqual([`squeal: kept ${a.tree}: pid ${other.lease.pid} owns it now`]);
    } finally {
      await other.end();
    }
    await removeCommitWorktree(a.tree);
    expect(existsSync(a.folder)).toBe(false);
  });

  it("is swept once its daemon is dead, and kept while its daemon lives though its creator is gone", async () => {
    const dead = await ensure(fx.first);
    const kept = await ensure(fx.second);
    claimCommitWorktree(kept.tree);
    const owned = readMarker(kept.folder);
    const orphan = readMarker(dead.folder);
    if (owned === null || orphan === null) throw new Error("no marker");
    writeMarker(kept.folder, { ...owned, owner: deadLease() });
    writeMarker(dead.folder, { ...orphan, daemon: deadLease() });

    const swept = await sweepCheckouts({
      commonDir: fx.commonDir,
      dirs: [fx.dir, gitCheckoutsDir(fx.commonDir)],
    });

    expect(swept.map((s) => s.tree)).toEqual([dead.tree]);
    expect(existsSync(dead.folder)).toBe(false);
    expect(existsSync(kept.tree)).toBe(true);
    expect(worktrees()).toEqual([fx.repo, kept.tree]);
  });
});
