import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CandidateBatch } from "../../src/core/types/index.js";
import { type ChangeFeed, createChangeFeed } from "../../src/core/watcher/change-feed.js";
import * as gitModule from "../../src/core/watcher/git.js";
import { createWatcherBackend } from "../../src/core/watcher/index.js";
import { BatchLog, delay, makeRepo, PausableBackend, waitFor } from "./helpers.js";

/** Entries `listIgnored` hides, the way git 2.43 hid them below an untracked directory. */
const hidden = { prefix: null as string | null };

vi.mock("../../src/core/watcher/git.js", async (importOriginal) => {
  const real = await importOriginal<typeof gitModule>();
  return {
    ...real,
    listIgnored: vi.fn(async (root: string) => {
      const entries = await real.listIgnored(root);
      const { prefix } = hidden;
      return prefix === null ? entries : entries.filter((e) => !e.startsWith(prefix));
    }),
  };
});

function limitError(code: string): Error {
  return Object.assign(new Error(`${code}: System limit for number of file watchers reached`), {
    code,
    syscall: "watch",
  });
}

/**
 * Task 001-299, R2: no reconciliation or rebuild storms. Research
 * `nested-worktree-watch.md` finding 2: one full reconciliation per ENOSPC
 * error, and one spec rebuild per new directory under an ignored directory git
 * does not list.
 */
describe("ChangeFeed storms", () => {
  let root: string;
  let cleanup: () => void;
  let log: BatchLog;
  let errors: Error[];
  let backend: PausableBackend;
  let feed: ChangeFeed | null;
  let onBatch: (batch: CandidateBatch) => void | Promise<void>;

  const passes = () => log.batches.filter((b) => b.trigger !== "watch").length;
  const startFeed = async () => {
    feed = createChangeFeed({
      root,
      backend,
      onBatch: (batch) => onBatch(batch),
      onError: (error) => errors.push(error),
      timings: { reconcileIntervalMs: 60_000 },
    });
    await feed.start();
  };

  beforeEach(() => {
    ({ root, cleanup } = makeRepo());
    log = new BatchLog();
    onBatch = log.push;
    errors = [];
    backend = new PausableBackend(createWatcherBackend("linux"));
    feed = null;
    hidden.prefix = null;
    vi.mocked(gitModule.listIgnored).mockClear();
  });
  afterEach(async () => {
    await feed?.close();
    cleanup();
  });

  it("queues at most one reconciliation, later requests joining it", async () => {
    await startFeed();
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    onBatch = async (batch) => {
      log.push(batch);
      await held;
    };
    const before = passes();
    const first = feed?.reconcile("dropped-events");
    await waitFor(() => passes() > before);
    // The first pass is delivering; the nine queued behind it join one pass, which keeps "interval".
    const requests = Array.from({ length: 9 }, (_, i) =>
      feed?.reconcile(i % 2 === 0 ? "dropped-events" : "interval"),
    );
    release();
    await Promise.all([first, ...requests]);
    expect(passes() - before).toBe(2);
    expect(log.batches.at(-1)?.trigger).toBe("interval");
    expect(errors).toEqual([]);
  });

  it("gives 200 watch-limit errors one note and at most two passes", async () => {
    await startFeed();
    const before = passes();
    for (let i = 0; i < 200; i++)
      backend.signalError(limitError(i % 2 === 0 ? "ENOSPC" : "EMFILE"));
    await delay(300);
    await waitFor(() => passes() > before);
    await delay(300);
    expect(passes() - before).toBeLessThanOrEqual(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("fs.inotify.max_user_watches");
    expect(errors[0]?.message).toContain("30 s");
  });

  it("still reports every other backend error", async () => {
    await startFeed();
    backend.signalError(new Error("first"));
    backend.signalError(new Error("second"));
    await delay(100);
    expect(errors.map((e) => e.message)).toEqual(["first", "second"]);
  });

  it("rebuilds the spec at most once for 20 new directories under an ignored, unlisted one", async () => {
    writeFileSync(join(root, ".gitignore"), "out/\nnode_modules/\n*.log\nbuild/\ncache/\n");
    mkdirSync(join(root, "cache"));
    writeFileSync(join(root, "cache/keep.txt"), "x\n");
    hidden.prefix = "cache/";
    await startFeed();
    expect(feed?.spec?.excluded).not.toContain(join(root, "cache"));
    const rebuildsBefore = vi.mocked(gitModule.listIgnored).mock.calls.length;
    for (let i = 0; i < 20; i++) {
      mkdirSync(join(root, `cache/t${i}`));
      // Each directory in its own batch: the debounce's quiet period is 100 ms.
      await delay(150);
    }
    await delay(300);
    expect(vi.mocked(gitModule.listIgnored).mock.calls.length - rebuildsBefore).toBeLessThanOrEqual(
      1,
    );
    expect(errors).toEqual([]);
  }, 15_000);
});
