import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { candidatesForReconcile } from "../../src/core/watcher/candidates.js";
import { type ChangeFeed, createChangeFeed } from "../../src/core/watcher/change-feed.js";
import { Exclusions } from "../../src/core/watcher/exclusions.js";
import { createWatcherBackend } from "../../src/core/watcher/index.js";
import { BatchLog, delay, git, makeRepo } from "./helpers.js";

function write(dir: string, path: string, content = "x\n"): void {
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), content);
}

function initRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "squeal@example.com");
  git(dir, "config", "user.name", "Squeal Test");
  git(dir, "config", "commit.gpgsign", "false");
}

/*
 * Task 001-120 (`reviews/wave-11g.md` S1): spec 001 D2, "a link to the root
 * or above it, or to another repository, is not observed", decided by the
 * repository holding the link's resolved target, not by the link's own path.
 */
describe("a link into another repository", () => {
  let root: string;
  let parent: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeRepo());
    parent = join(root, "..");
    initRepo(join(parent, "other"));
    write(join(parent, "other"), "sub/o.ts");
    git(join(parent, "other"), "add", ".");
    git(join(parent, "other"), "commit", "-qm", "other");
    symlinkSync("../other", join(root, "foreign"));
    symlinkSync("../other/sub", join(root, "foreign-sub"));
  });
  afterEach(() => cleanup());

  const reconcile = (links: string[]) =>
    candidatesForReconcile(
      {
        root,
        exclusions: new Exclusions({ root, excluded: [], extraFiles: [] }),
        extraFiles: new Set(),
        trackedPaths: () => ["README.md"],
      },
      links,
    );
  const observed = async (links: string[]) => {
    const { paths, linkedDirs } = await reconcile(links);
    return { paths: paths.map((p) => p.path), linked: [...linkedDirs.keys()].sort() };
  };

  it("is not observed at the other repository's root or below it", async () => {
    const { paths, linked } = await observed(["foreign", "foreign-sub"]);
    expect(linked).toEqual([]);
    expect(paths.filter((p) => p.startsWith("foreign"))).toEqual(["foreign", "foreign-sub"]);
  });

  it("is not observed below a linked worktree of the other repository", async () => {
    git(join(parent, "other"), "worktree", "add", "-q", "../other-wt");
    symlinkSync("../other-wt/sub", join(root, "wt-sub"));
    expect((await observed(["wt-sub"])).linked).toEqual([]);
  });

  it("is not observed below a repository nested in this worktree", async () => {
    initRepo(join(root, "vendor/inner"));
    write(join(root, "vendor/inner"), "sub/v.ts");
    symlinkSync("vendor/inner/sub", join(root, "inner-sub"));
    expect((await observed(["inner-sub"])).linked).toEqual([]);
  });

  it("still observes a plain outside directory, also one under a repository enclosing both", async () => {
    write(parent, "plain/p.ts");
    symlinkSync("../plain", join(root, "plain"));
    expect(await observed(["plain"])).toMatchObject({ linked: ["plain"] });
    initRepo(parent);
    const { paths, linked } = await observed(["plain"]);
    expect(linked).toEqual(["plain"]);
    expect(paths).toContain("plain/p.ts");
  });

  it("still observes a directory within this worktree", async () => {
    symlinkSync("src", join(root, "alias"));
    const { paths, linked } = await observed(["alias"]);
    expect(linked).toEqual(["alias"]);
    expect(paths.some((p) => p.startsWith("alias/"))).toBe(true);
  });

  describe("under a running ChangeFeed", () => {
    let feed: ChangeFeed | null = null;
    const errors: Error[] = [];
    afterEach(async () => {
      await feed?.close();
      feed = null;
      expect(errors.splice(0)).toEqual([]);
    });

    it("lists nothing behind either link and reports no write behind them", async () => {
      const log = new BatchLog();
      feed = createChangeFeed({
        root,
        backend: createWatcherBackend("linux"),
        onBatch: log.push,
        onError: (error) => errors.push(error),
        trackedPaths: () => ["README.md"],
        timings: { reconcileIntervalMs: 60_000 },
      });
      await feed.start();
      const behind = () => log.paths().filter((p) => /^foreign(-sub)?\//.test(p));
      expect(behind()).toEqual([]);
      write(join(parent, "other"), "sub/new.ts");
      await delay(1_000);
      expect(behind()).toEqual([]);
    });
  });
});
