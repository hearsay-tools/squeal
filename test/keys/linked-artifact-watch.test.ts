import { appendFileSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ignoredInputs } from "../../src/core/keys/index.js";
import { type ChangeFeed, createChangeFeed } from "../../src/core/watcher/change-feed.js";
import { createWatcherBackend } from "../../src/core/watcher/index.js";
import { BatchLog, git, makeRepo, waitFor } from "../watcher/helpers.js";

/*
 * reviews/wave-4.md B3: a declared build beyond `dist -> real-build`, both
 * ignored, is listed under its declared paths, and the real change feed
 * watches it there as extra files: a rebuild through the link's target is
 * reported as `dist/index.js`, the path its key holds.
 */

let feed: ChangeFeed | null = null;
let cleanup: (() => void) | null = null;
afterEach(async () => {
  await feed?.close();
  feed = null;
  cleanup?.();
  cleanup = null;
});

// Linux's chokidar only: macOS's @parcel/watcher subscribes to the extra's parent, here the
// link, which parcel refuses on Linux ("Not a directory"); its macOS behaviour is unverified.
describe("a declared build beyond a symlinked ignored directory", () => {
  it("is watched under its declared path when the build is rewritten", async () => {
    const repo = makeRepo();
    cleanup = repo.cleanup;
    const { root } = repo;
    appendFileSync(join(root, ".gitignore"), "dist\nreal-build/\n");
    git(root, "commit", "-qam", "ignore the build");
    mkdirSync(join(root, "real-build"));
    writeFileSync(join(root, "real-build/index.js"), "export const build = 'a';\n");
    symlinkSync("real-build", join(root, "dist"));

    const extraFiles = await ignoredInputs(root, ["dist/**"]);
    expect(extraFiles).toEqual(["dist/index.js"]);
    const log = new BatchLog();
    const errors: Error[] = [];
    feed = createChangeFeed({
      root,
      backend: createWatcherBackend("linux"),
      onBatch: log.push,
      onError: (error) => errors.push(error),
      onDropped: () => {},
      trackedPaths: () => [],
      extraFiles,
      timings: { reconcileIntervalMs: 60_000 },
    });
    await feed.start();
    const watched = () =>
      log.batches.some(
        (b) => b.trigger === "watch" && b.paths.some((p) => p.path === "dist/index.js"),
      );

    writeFileSync(join(root, "real-build/index.js"), "export const build = 'a2';\n");
    await waitFor(watched);
    expect(log.find("dist/index.js")?.candidate.stat?.size).toBe(
      "export const build = 'a2';\n".length,
    );
    expect(errors).toEqual([]);
  });
});
