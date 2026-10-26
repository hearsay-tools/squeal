import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFsHasher, StatCache, seedStatCache } from "../../src/core/hash/index.js";
import { reconcile } from "../../src/core/revision/index.js";
import type {
  AbsolutePath,
  CandidateBatch,
  Revision,
  WatcherBackend,
} from "../../src/core/types/index.js";
import { type ChangeFeed, createChangeFeed } from "../../src/core/watcher/index.js";
import { FakeStore } from "../hash/fakes.js";
import { git, initRepo, tempDir, writeFile } from "../hash/git-repo.js";

/** Row 011-201: while `unreadable.head` holds, the git dir reader gives `null`, as in a reftable repository. */
const unreadable = vi.hoisted(() => ({ head: false }));
vi.mock("../../src/core/status/git-head.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/status/git-head.js")>();
  return {
    ...actual,
    readGitHead: (root: AbsolutePath) => (unreadable.head ? null : actual.readGitHead(root)),
  };
});

/** Why this Git cannot create a reftable repository (`--ref-format` came with 2.45), or `null`. */
function reftableUnsupported(): string | null {
  const probe = tempDir();
  const env = { ...process.env };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR"]) delete env[name];
  try {
    const init = ["init", "-q", "--ref-format=reftable", join(probe.path, "repo")];
    if (spawnSync("git", init, { env, stdio: "ignore" }).status === 0) return null;
    const version = spawnSync("git", ["--version"], { env, encoding: "utf8" }).stdout.trim();
    return `${version} cannot create a reftable repository`;
  } finally {
    probe.cleanup();
  }
}
const noReftable = reftableUnsupported();

/** A backend whose watch never reports: every hint is held, as a lost or queued event is. */
const held: WatcherBackend = {
  name: "chokidar",
  watch: async () => ({ update: async () => {}, close: async () => {} }),
};

const ADDED = "test/added.test.ts";

/**
 * Row 011-199 (`tasks/011-197/findings.md`, recommendation 3): a file added
 * and committed while its event is held is in neither `git status` nor the
 * stat cache. A pass also checks what changed between the `HEAD` of the last
 * pass and this one, and the files git tracks on the first pass.
 */
describe("a reconciliation pass after a commit", () => {
  let dir: ReturnType<typeof tempDir>;
  let root: string;
  let cache: StatCache;
  let feed: ChangeFeed | null;
  let batches: CandidateBatch[];
  let revisions: (Revision | null)[];
  let errors: Error[];
  /** The next batch fails, as one the store refused does; the feed reports it and goes on. */
  let failNext: boolean;

  beforeEach(async () => {
    dir = tempDir();
    root = join(realpathSync(dir.path), "repo");
    initRepo(root, { "src/a.ts": "export const a = 1;\n" });
    const tracked = git(root, ["ls-files", "-z"]).split("\0").filter(Boolean);
    cache = new StatCache();
    await seedStatCache(cache, root, tracked, { objectFormat: "sha1" });
    feed = null;
    batches = [];
    revisions = [];
    errors = [];
    failNext = false;
    unreadable.head = false;
  });
  afterEach(async () => {
    await feed?.close();
    dir.cleanup();
    expect(errors).toEqual([]);
  });

  /** The daemon loop in miniature: every batch goes straight into `reconcile`. */
  const startFeed = async (): Promise<void> => {
    const hasher = createFsHasher(root, "sha1");
    const store = new FakeStore();
    feed = createChangeFeed({
      root,
      backend: held,
      onBatch: async (batch) => {
        if (failNext) {
          failNext = false;
          throw new Error("store busy");
        }
        batches.push(batch);
        revisions.push(
          await reconcile(batch, cache, hasher, {
            worktreeId: "wt",
            store,
            head: async () => ({ head: "abc123", dirty: false }),
          }),
        );
      },
      onError: (error) => errors.push(error),
      trackedPaths: () => cache.paths(),
      timings: { reconcileIntervalMs: 60_000 },
    });
    await feed.start();
  };

  const commit = (path: string, content: string): void => {
    writeFile(root, path, content);
    git(root, ["add", "--", path]);
    git(root, ["commit", "-q", "-m", `add ${path}`]);
  };
  const candidates = (batch: CandidateBatch | undefined) => batch?.paths.map((p) => p.path) ?? [];
  const added = (path: string) =>
    revisions.flatMap((r) => r?.changes ?? []).filter((c) => c.path === path && c.oldHash === null);

  it("names a file added and committed since the last pass", async () => {
    await startFeed();
    expect(revisions).toEqual([null]);

    commit(ADDED, "it('x', () => {});\n");
    await feed?.reconcile("interval");

    expect(candidates(batches.at(-1))).toContain(ADDED);
    expect(added(ADDED)).toHaveLength(1);
  });

  it("names a file committed before the first pass that the stat cache never saw", async () => {
    // The daemon's start: the scheduler seeded the cache, then the feed starts, with no watch between.
    commit(ADDED, "it('x', () => {});\n");
    await startFeed();

    expect(candidates(batches[0])).toContain(ADDED);
    expect(added(ADDED)).toHaveLength(1);
  });

  it("names a file committed after the last pass's commit was rewritten and pruned", async () => {
    await startFeed();
    commit("src/gone.ts", "export const gone = 1;\n");
    await feed?.reconcile("interval");
    // The pass's `HEAD` leaves the history and the object store, so no diff can start from it.
    git(root, ["reset", "-q", "--hard", "HEAD~1"]);
    commit(ADDED, "it('x', () => {});\n");
    git(root, ["reflog", "expire", "--expire=now", "--all"]);
    git(root, ["gc", "-q", "--prune=now"]);
    await feed?.reconcile("interval");

    expect(candidates(batches.at(-1))).toContain(ADDED);
    expect(added(ADDED)).toHaveLength(1);
  });

  it("names a file of the first commit when the pass before saw no commit", async () => {
    dir.cleanup();
    dir = tempDir();
    root = join(realpathSync(dir.path), "repo");
    git(dir.path, ["init", "-q", "-b", "main", "repo"]);
    cache = new StatCache();
    await startFeed();

    commit(ADDED, "it('x', () => {});\n");
    await feed?.reconcile("interval");

    expect(candidates(batches.at(-1))).toContain(ADDED);
    expect(added(ADDED)).toHaveLength(1);
  });

  it("names a file added and committed since the last pass in a reftable repository", async (ctx) => {
    // The git dir reader finds no ref there (`refs/heads` is a file), so the pass asks git.
    if (noReftable !== null) ctx.skip(noReftable);
    dir.cleanup();
    dir = tempDir();
    root = join(realpathSync(dir.path), "repo");
    git(dir.path, ["init", "-q", "--ref-format=reftable", "-b", "main", "repo"]);
    commit("src/a.ts", "export const a = 1;\n");
    cache = new StatCache();
    await seedStatCache(cache, root, ["src/a.ts"], { objectFormat: "sha1" });
    await startFeed();

    commit(ADDED, "it('x', () => {});\n");
    await feed?.reconcile("interval");

    expect(candidates(batches.at(-1))).toContain(ADDED);
    expect(added(ADDED)).toHaveLength(1);
  });

  it("names the file again on the pass after one whose batch failed", async () => {
    await startFeed();
    commit(ADDED, "it('x', () => {});\n");
    failNext = true;
    await feed?.reconcile("interval");
    expect(errors.map((e) => e.message)).toEqual(["store busy"]);
    errors.length = 0;

    await feed?.reconcile("interval");
    expect(candidates(batches.at(-1))).toContain(ADDED);
    expect(added(ADDED)).toHaveLength(1);
  });

  it.each([
    ["the git dir files", false],
    ["git, when the git dir reader gives null", true],
  ])("lists no committed file again while HEAD stays, read from %s", async (_, nullHead) => {
    // A path git tracks and the caller left out of its tracked paths is a candidate only when a
    // commit could have added it: on the first pass, and after `HEAD` moves.
    unreadable.head = nullHead;
    feed = createChangeFeed({
      root,
      backend: held,
      onBatch: (batch) => {
        batches.push(batch);
      },
      onError: (error) => errors.push(error),
      trackedPaths: () => [],
      timings: { reconcileIntervalMs: 60_000 },
    });
    await feed.start();
    expect(candidates(batches[0])).toEqual(["src/a.ts"]);

    await feed.reconcile("interval");
    expect(candidates(batches.at(-1))).toEqual([]);

    commit(ADDED, "it('x', () => {});\n");
    await feed.reconcile("interval");
    expect(candidates(batches.at(-1))).toEqual([ADDED]);
  });
});
