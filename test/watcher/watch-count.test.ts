import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ChangeFeed, createChangeFeed } from "../../src/core/watcher/change-feed.js";
import { createWatcherBackend } from "../../src/core/watcher/index.js";
import { delay, git, makeRepo } from "./helpers.js";

/** Inotify watches this process holds: one `inotify wd:` line per watched inode. */
function inotifyWatches(): number {
  let count = 0;
  for (const fd of readdirSync("/proc/self/fdinfo")) {
    let info: string;
    try {
      info = readFileSync(`/proc/self/fdinfo/${fd}`, "utf8");
    } catch {
      continue;
    }
    count += info.split("\n").filter((line) => line.startsWith("inotify wd:")).length;
  }
  return count;
}

/** Files and directories under `dir`, itself included, skipping the named relative paths. */
function countPaths(dir: string, skip: readonly string[], rel = ""): number {
  let count = 1;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (skip.includes(path)) continue;
    count += entry.isDirectory() ? countPaths(join(dir, entry.name), skip, path) : 1;
  }
  return count;
}

function writeMany(dir: string, files: number): void {
  for (let i = 0; i < files; i++) {
    const sub = join(dir, `d${Math.floor(i / 50)}`);
    if (i % 50 === 0) mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, `f${i}.txt`), `${i}\n`);
  }
}

/**
 * Task 001-299: a main checkout's daemon watched every file of the worktrees
 * Cezar nests under `.ai/cezar/worktrees/`, git-ignored, 74,121 watches against
 * 3,365 own paths. Real watches, counted in `/proc/self/fdinfo`; each test file
 * runs in its own process.
 */
describe.runIf(process.platform === "linux")("watch count", () => {
  let root: string;
  let cleanup: () => void;
  let feed: ChangeFeed | null;
  let errors: Error[];

  const startFeed = async () => {
    feed = createChangeFeed({
      root,
      backend: createWatcherBackend("linux"),
      onBatch: () => {},
      onError: (error) => errors.push(error),
      timings: { reconcileIntervalMs: 60_000 },
    });
    await feed.start();
  };

  beforeEach(() => {
    ({ root, cleanup } = makeRepo());
    feed = null;
    errors = [];
  });
  afterEach(async () => {
    await feed?.close();
    cleanup();
    expect(errors).toEqual([]);
  });

  it("does not watch a nested worktree under an ignored directory of an untracked one", async () => {
    mkdirSync(join(root, ".ai/cezar"), { recursive: true });
    writeFileSync(join(root, ".ai/cezar/.gitignore"), "worktrees/\nruns/\ntmp/\n");
    writeFileSync(join(root, ".ai/cezar/config.json"), "{}\n");
    git(root, "worktree", "add", "-q", "--detach", ".ai/cezar/worktrees/w1");
    writeMany(join(root, ".ai/cezar/worktrees/w1/gen"), 5_000);
    const own = countPaths(root, [".git", ".ai/cezar/worktrees"]);

    const before = inotifyWatches();
    await startFeed();
    expect(inotifyWatches() - before).toBeLessThanOrEqual(own + 20);
  });

  it("never watches a worktree added into a watched directory while git checks it out", async () => {
    // An orphan branch of 5,000 files: the checkout's own tree stays the small fixture.
    const big = join(root, "../big");
    git(root, "worktree", "add", "-q", "--orphan", "-b", "big", big);
    writeMany(join(big, "gen"), 5_000);
    git(big, "add", ".");
    git(big, "commit", "-q", "-m", "big");
    git(root, "worktree", "remove", big);
    mkdirSync(join(root, "nested"));
    const own = countPaths(root, [".git"]) + 1;

    const before = inotifyWatches();
    await startFeed();
    let peak = inotifyWatches() - before;
    const add = spawn("git", ["worktree", "add", "-q", "nested/w2", "big"], { cwd: root });
    const done = new Promise<number | null>((resolve) => add.on("exit", resolve));
    let exited = false;
    void done.then(() => {
      exited = true;
    });
    while (!exited) {
      peak = Math.max(peak, inotifyWatches() - before);
      await delay(5);
    }
    expect(await done).toBe(0);
    for (let i = 0; i < 20; i++) {
      peak = Math.max(peak, inotifyWatches() - before);
      await delay(25);
    }
    expect(peak).toBeLessThanOrEqual(own + 20);
  });
});
