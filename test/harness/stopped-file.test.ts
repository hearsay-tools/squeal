import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stopTree } from "../../src/cli/stopped-mark.js";
import { stopHolds } from "../../src/core/delivery/stopped.js";
import { markStopped } from "../../src/core/presence/events.js";
import { removeStopFile, writeStopFile } from "../../src/core/presence/lock-events.js";
import { readStopFile } from "../../src/core/presence/marks.js";
import { readLegacyStop, readStop, type StopMark } from "../../src/core/presence/stored.js";
import { lockFileFor } from "../../src/core/store/paths.js";
import type { AbsolutePath, EpochMs } from "../../src/core/types/common.js";
import { type SquealRepo, squealRepo } from "./helpers.js";
import { gitRepo } from "./stopped-repo.js";

/*
 * Row 021-39 (#285): a boundary's `stopHolds` changes a stop mark kept beside
 * the lock file in that file, with no store write: it fills a mark's missing
 * tree print and an edit removes it. A `squeal stop` or `squeal start` while
 * git prints the tree still wins (review wave-1.10 R2), and a legacy `meta`
 * mark changes in the store, as before.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function repo() {
  const r = squealRepo(gitRepo(cleanups));
  const lockFile = lockFileFor(r.repo.commonDir as AbsolutePath, r.worktreeId);
  const writes: string[] = [];
  const write = async <T>(work: () => T): Promise<T> => {
    writes.push("write");
    return work();
  };
  const holds = () =>
    stopHolds(
      r.store,
      { id: r.worktreeId, root: r.root as AbsolutePath },
      readStop(r.store, r.worktreeId),
      write,
    );
  return { r, lockFile, writes, holds };
}

const AT = 1_000 as EpochMs;

function legacy(r: SquealRepo, tree: string | null): void {
  r.store.transaction(() => markStopped(r.store, r.worktreeId, AT, tree));
}

describe("stopHolds over a stop mark beside the lock file (row 021-39)", () => {
  it("takes the first print as a null tree's, in the file, with no store write", async () => {
    const { r, lockFile, writes, holds } = repo();
    writeStopFile(lockFile, { at: AT, tree: null });

    expect(await holds()).toBe(true);

    expect(readStopFile(lockFile)).toEqual({
      at: AT,
      tree: await stopTree(r.root as AbsolutePath),
    });
    expect(writes).toEqual([]);
    expect(readLegacyStop(r.store, r.worktreeId)).toBeNull();
  });

  it("is removed by an edit, with no store write", async () => {
    const { r, lockFile, writes, holds } = repo();
    writeStopFile(lockFile, { at: AT, tree: await stopTree(r.root as AbsolutePath) });
    writeFileSync(join(r.root, "a.txt"), "edited\n");

    expect(await holds()).toBe(false);

    expect(readStopFile(lockFile)).toBeNull();
    expect(writes).toEqual([]);
  });

  it("holds when a new stop replaced the file while git printed the tree (review wave-1.10 R2)", async () => {
    const { r, lockFile, holds } = repo();
    writeStopFile(lockFile, { at: AT, tree: "an older print" });
    const held = holds();
    const replaced: StopMark = { at: (AT + 1) as EpochMs, tree: "another print" };
    writeStopFile(lockFile, replaced);

    expect(await held).toBe(true);
    expect(readStopFile(lockFile)).toEqual(replaced);
    expect(readLegacyStop(r.store, r.worktreeId)).toBeNull();
  });

  it("lets a `squeal start` that removed the file while git printed the tree win, with no store write", async () => {
    const { lockFile, writes, holds } = repo();
    writeStopFile(lockFile, { at: AT, tree: "an older print" });
    const held = holds();
    removeStopFile(lockFile);

    expect(await held).toBe(false);
    expect(writes).toEqual([]);
  });

  it("removes a legacy row beside the file on an edit, through the write", async () => {
    const { r, lockFile, writes, holds } = repo();
    legacy(r, "an older print");
    writeStopFile(lockFile, { at: AT, tree: "an older print" });

    expect(await holds()).toBe(false);

    expect(readStopFile(lockFile)).toBeNull();
    expect(readLegacyStop(r.store, r.worktreeId)).toBeNull();
    expect(writes).toEqual(["write"]);
  });
});

describe("stopHolds over a legacy `meta` stop mark (row 021-39)", () => {
  it("fills a null tree in the store", async () => {
    const { r, lockFile, writes, holds } = repo();
    legacy(r, null);

    expect(await holds()).toBe(true);

    const tree = await stopTree(r.root as AbsolutePath);
    expect(readLegacyStop(r.store, r.worktreeId)).toEqual({ at: AT, tree });
    expect(readStopFile(lockFile)).toBeNull();
    expect(writes).toEqual(["write"]);
  });

  it("clears on an edit in the store", async () => {
    const { r, writes, holds } = repo();
    legacy(r, "an older print");

    expect(await holds()).toBe(false);

    expect(readLegacyStop(r.store, r.worktreeId)).toBeNull();
    expect(writes).toEqual(["write"]);
  });
});
