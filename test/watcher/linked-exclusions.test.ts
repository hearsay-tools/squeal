import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ChangeFeed, createChangeFeed } from "../../src/core/watcher/change-feed.js";
import { createWatcherBackend } from "../../src/core/watcher/index.js";
import { linkedExclusions } from "../../src/core/watcher/linked-exclusions.js";
import { BatchLog, git, makeRepo, waitFor } from "./helpers.js";

function write(root: string, path: string, content = "x\n"): void {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), content);
}

/** An install of 2,000 paths: 100 package directories of 19 files each. */
function install(dir: string): void {
  for (let p = 0; p < 100; p++) {
    mkdirSync(join(dir, `pkg${p}`), { recursive: true });
    for (let f = 0; f < 19; f++) writeFileSync(join(dir, `pkg${p}`, `f${f}.js`), "x\n");
  }
}

/** This process's inotify watches, one `inotify wd:` line each in `/proc/self/fdinfo`. */
function inotifyWatches(): number {
  let count = 0;
  for (const fd of readdirSync("/proc/self/fdinfo")) {
    let info: string;
    try {
      info = readFileSync(join("/proc/self/fdinfo", fd), "utf8");
    } catch {
      continue;
    }
    count += info.split("\n").filter((line) => line.startsWith("inotify wd:")).length;
  }
  return count;
}

/** Files and directories under `dir`, `.git` and `skip` left out, `dir` itself counted. */
function ownPaths(dir: string, skip: readonly string[] = []): number {
  let count = 1;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || skip.includes(entry.name)) continue;
    count += entry.isDirectory() ? ownPaths(join(dir, entry.name), skip) : 1;
  }
  return count;
}

/*
 * Task 001-300 (research/nested-worktree-watch.md R3): the target of an
 * observed symlinked directory is watched without the directories git would
 * ignore under the link, were the link a directory, and without nested
 * repositories, as the root's own watch is.
 */
describe.runIf(process.platform === "linux")("the watch of a linked directory's target", () => {
  let root: string;
  let target: string;
  let cleanup: () => void;
  let log: BatchLog;
  let errors: Error[];
  let feed: ChangeFeed | null;

  const startFeed = async () => {
    feed = createChangeFeed({
      root,
      backend: createWatcherBackend("linux"),
      onBatch: log.push,
      onError: (error) => errors.push(error),
      trackedPaths: () => ["README.md", "lib"],
      timings: { reconcileIntervalMs: 60_000 },
    });
    await feed.start();
  };
  const watched = (path: string) =>
    log.batches.some((b) => b.trigger === "watch" && b.paths.some((p) => p.path === path));
  const bound = () =>
    ownPaths(root, ["out"]) + ownPaths(target, ["node_modules", "dist", "cache", "vendor"]) + 10;

  beforeEach(() => {
    ({ root, cleanup } = makeRepo());
    target = join(root, "../ext/lib");
    write(target, "index.ts");
    write(target, "src/a.ts");
    write(target, "src/deep/b.ts");
    symlinkSync("../ext/lib", join(root, "lib"));
    git(root, "add", "lib");
    git(root, "commit", "-qm", "link");
    log = new BatchLog();
    errors = [];
    feed = null;
  });
  afterEach(async () => {
    await feed?.close();
    cleanup();
    expect(errors).toEqual([]);
  });

  it("leaves out an install the root's ignore rules name and still reports its sources", async () => {
    install(join(target, "node_modules"));
    const before = inotifyWatches();
    await startFeed();
    expect(inotifyWatches() - before).toBeLessThanOrEqual(bound());
    appendFileSync(join(root, "lib/src/a.ts"), "y\n");
    await waitFor(() => watched("lib/src/a.ts"), 3_000);
  });

  it("leaves out the directories the target's own .gitignore files name", async () => {
    write(target, ".gitignore", "dist/\n");
    install(join(target, "dist"));
    write(target, "src/.gitignore", "cache/\n");
    install(join(target, "src/cache"));
    const before = inotifyWatches();
    await startFeed();
    expect(inotifyWatches() - before).toBeLessThanOrEqual(bound());
  });

  it("leaves out a repository inside the target", async () => {
    install(join(target, "vendor"));
    git(join(target, "vendor"), "init", "-q");
    const before = inotifyWatches();
    await startFeed();
    expect(inotifyWatches() - before).toBeLessThanOrEqual(bound());
  });

  it("stops watching an install made after the watch started", async () => {
    const before = inotifyWatches();
    await startFeed();
    install(join(target, "node_modules"));
    // The install's directories are reported, so the watch saw it appear.
    await waitFor(() => log.paths().some((p) => p.startsWith("lib/node_modules/")), 3_000);
    await waitFor(() => inotifyWatches() - before <= bound(), 5_000);
    appendFileSync(join(root, "lib/index.ts"), "y\n");
    await waitFor(() => watched("lib/index.ts"), 3_000);
  }, 15_000);

  it("watches a directory again once the target's .gitignore stops naming it", async () => {
    write(target, ".gitignore", "gen/\n");
    write(target, "gen/out.ts");
    await startFeed();
    writeFileSync(join(target, ".gitignore"), "\n");
    await waitFor(() => watched("lib/gen/out.ts"), 3_000);
    const seen = log.batches.length;
    appendFileSync(join(root, "lib/gen/out.ts"), "y\n");
    await waitFor(
      () =>
        log.batches
          .slice(seen)
          .some((b) => b.trigger === "watch" && b.paths.some((p) => p.path === "lib/gen/out.ts")),
      3_000,
    );
  });
});

describe("linkedExclusions", () => {
  let root: string;
  let target: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeRepo());
    target = join(root, "../ext/lib");
    write(target, "src/a.ts");
    write(target, "gen/out.ts");
    write(target, "node_modules/dep/index.js");
    write(target, "vendor/dep/index.js");
    git(join(target, "vendor/dep"), "init", "-q");
    write(root, "pkg/.gitignore", "gen/\n");
  });
  afterEach(() => cleanup());

  it("names the ignored directories and nested repositories, and nothing below them", async () => {
    expect(await linkedExclusions(root, ["pkg/lib"], target)).toEqual([
      join(target, "gen"),
      join(target, "node_modules"),
      join(target, "vendor/dep"),
    ]);
  });

  it("leaves out only what every link to the target ignores", async () => {
    expect(await linkedExclusions(root, ["pkg/lib", "lib"], target)).toEqual([
      join(target, "node_modules"),
      join(target, "vendor/dep"),
    ]);
  });

  it("checks only the directories it is given, and those below them", async () => {
    expect(await linkedExclusions(root, ["lib"], target, [join(target, "vendor")])).toEqual([
      join(target, "vendor/dep"),
    ]);
  });
});
