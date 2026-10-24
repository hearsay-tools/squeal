import { appendFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  WatcherBackend,
  WatchListener,
  WatchSpec,
  WatchSubscription,
} from "../../src/core/types/index.js";
import { type ChangeFeed, createChangeFeed } from "../../src/core/watcher/change-feed.js";
import { createWatcherBackend } from "../../src/core/watcher/index.js";
import { BatchLog, makeRepo, waitFor } from "./helpers.js";

/*
 * Row 011-183: a new ignored directory, Vitest's `node_modules/.vite` among
 * them, makes the feed rebuild its spec, and the chokidar backend replaces
 * its watcher. An edit whose event reached the old watcher while the new one
 * scanned was lost: the old one closed before its stat of the event returned,
 * and the new one attached after the event. Only the idle pass, 30 s later,
 * found it (`hold.test.ts` case 2 on CI 40107613445).
 */

/** The Linux backend whose `update` writes `path` and drops its hints from then on, as that swap did. */
class SwapLosesEdit implements WatcherBackend {
  private readonly inner = createWatcherBackend("linux");
  readonly name = this.inner.name;
  edited = false;

  constructor(private readonly path: string) {}

  async watch(spec: WatchSpec, listener: WatchListener): Promise<WatchSubscription> {
    const sub = await this.inner.watch(spec, {
      onHints: (hints) => {
        const kept = hints.filter((hint) => !this.edited || hint.path !== this.path);
        if (kept.length > 0) listener.onHints(kept);
      },
      onDropped: (reason) => listener.onDropped(reason),
      onError: (error) => listener.onError(error),
    });
    return {
      update: async (next) => {
        this.edited = true;
        appendFileSync(this.path, "// edited while the watch is replaced\n");
        await sub.update(next);
      },
      close: () => sub.close(),
    };
  }
}

describe("ChangeFeed: a watch update (row 011-183)", () => {
  let root: string;
  let cleanup: () => void;
  let log: BatchLog;
  let errors: Error[];
  let feed: ChangeFeed | null;

  beforeEach(() => {
    ({ root, cleanup } = makeRepo());
    log = new BatchLog();
    errors = [];
    feed = null;
  });
  afterEach(async () => {
    await feed?.close();
    cleanup();
    expect(errors).toEqual([]);
  });

  it("is followed by a reconciliation, which finds an edit whose hint the update lost", async () => {
    const backend = new SwapLosesEdit(join(root, "src/a.ts"));
    feed = createChangeFeed({
      root,
      backend,
      onBatch: log.push,
      onError: (error) => errors.push(error),
      trackedPaths: () => ["README.md", "src/a.ts", "src/lib/b.ts"],
      // Far beyond the wait below: only the pass after the update can find the edit.
      timings: { reconcileIntervalMs: 60_000 },
    });
    await feed.start();
    const from = log.batches.length;

    // `build/` is ignored and not there yet: its appearance rebuilds the spec.
    mkdirSync(join(root, "build/cache"), { recursive: true });
    writeFileSync(join(root, "build/cache/results.json"), "{}");

    const edited = () =>
      log.batches
        .slice(from)
        .flatMap((batch) => batch.paths)
        .find((candidate) => candidate.path === "src/a.ts");
    await waitFor(() => edited() !== undefined, 10_000);
    expect(backend.edited).toBe(true);
    expect(edited()?.stat?.size).toBe(statSync(join(root, "src/a.ts")).size);
  }, 20_000);
});
