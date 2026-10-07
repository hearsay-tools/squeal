import { appendFileSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ChangeFeed, createChangeFeed } from "../../src/core/watcher/change-feed.js";
import { createWatcherBackend } from "../../src/core/watcher/index.js";
import { BatchLog, git, makeRepo, waitFor } from "./helpers.js";

function write(root: string, path: string, content = "x\n"): void {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), content);
}

/*
 * Task 001-118 (review wave 11f, B1): a symlinked directory git does not
 * ignore is observed like any project directory, under the link's path.
 */
describe("ChangeFeed over a symlinked source directory", () => {
  let root: string;
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
  const watched = (path: string, present: boolean) =>
    log.batches.some(
      (b) =>
        b.trigger === "watch" &&
        b.paths.some((p) => p.path === path && (p.stat !== null) === present),
    );

  beforeEach(() => {
    ({ root, cleanup } = makeRepo());
    write(root, "../linked-source/a.ts");
    write(root, "../linked-source/deep/b.ts");
    write(root, "../shared/.package-lock.json", "{}\n");
    symlinkSync("../linked-source", join(root, "lib"));
    git(root, "add", "lib");
    git(root, "commit", "-qm", "link");
    symlinkSync("../shared", join(root, "node_modules"));
    log = new BatchLog();
    errors = [];
    feed = null;
  });
  afterEach(async () => {
    await feed?.close();
    cleanup();
    expect(errors).toEqual([]);
  });

  it("lists the files behind the link at start and not those behind a linked node_modules", async () => {
    await startFeed();
    const paths = log.batches[0]?.paths.map((p) => p.path) ?? [];
    expect(paths).toContain("lib/a.ts");
    expect(paths).toContain("lib/deep/b.ts");
    expect(paths.filter((p) => p.startsWith("node_modules/"))).toEqual([]);
  });

  it("reports an added, an edited and a deleted file behind the link within the debounce", async () => {
    await startFeed();
    const started = log.batches.length;
    write(root, "lib/added.test.ts", "it('x', () => {});\n");
    await waitFor(() => watched("lib/added.test.ts", true), 3_000);
    appendFileSync(join(root, "lib/a.ts"), "y\n");
    await waitFor(() => watched("lib/a.ts", true), 3_000);
    unlinkSync(join(root, "lib/added.test.ts"));
    await waitFor(() => watched("lib/added.test.ts", false), 3_000);
    // The linked install is not watched: a write there reports nothing under it.
    appendFileSync(join(root, "node_modules/.package-lock.json"), "\n");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(log.paths().filter((p) => p.startsWith("node_modules/"))).toEqual([]);
    // `fs.watch` follows the link, so each write also reports `lib`; that is no new link to
    // walk, so no reconciliation pass (one would re-stat the tracked README.md) ran.
    const reconciled = log.batches
      .slice(started)
      .filter((b) => b.paths.some((p) => p.path === "README.md"));
    expect(reconciled.length).toBe(0);
  });

  it("observes a link that appears, and drops its files when it goes", async () => {
    write(root, "../other/c.ts");
    await startFeed();
    symlinkSync("../other", join(root, "more"));
    await waitFor(() => log.has("more/c.ts"), 3_000);
    write(root, "more/d.ts");
    await waitFor(() => watched("more/d.ts", true), 3_000);
    rmSync(join(root, "more"));
    await waitFor(() => watched("more", false), 3_000);
  });

  it("does not walk a link to the root or above it", async () => {
    symlinkSync("..", join(root, "up"));
    symlinkSync(".", join(root, "self"));
    await startFeed();
    const paths = log.batches[0]?.paths.map((p) => p.path) ?? [];
    expect(paths.filter((p) => p.startsWith("up/") || p.startsWith("self/"))).toEqual([]);
  });
});
