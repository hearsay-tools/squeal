import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WatcherBackend, WatchListener } from "../../src/core/types/watcher.js";
import { type ChangeFeed, createChangeFeed } from "../../src/core/watcher/change-feed.js";
import { git, makeRepo } from "./helpers.js";

/*
 * Row 024-04 (spec 024 D4.2): an idle feed with a healthy watch backs off its full passes
 * (30 s -> 60 s -> 120 s -> 240 s -> 300 s) and keeps its 30 s heartbeat, so the late rule
 * (`FEED_LATE_MS`, 60 s) still holds. Any event, drop, asked pass or moved `HEAD` resets it.
 * Fake `setTimeout` drives the ticks; git runs for real between them.
 */

const TICK = 30_000;

/** A backend that never reports by itself; the test speaks through its listener. */
class QuietBackend implements WatcherBackend {
  readonly name = "chokidar" as const;
  listener: WatchListener | null = null;
  async watch(_spec: unknown, listener: WatchListener) {
    this.listener = listener;
    return { update: async () => {}, close: async () => {} };
  }
}

const macrotask = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Yields to real I/O until `done`, for at most 10 s of real time (`setTimeout` is fake here). */
async function until(done: () => boolean): Promise<void> {
  const end = performance.now() + 10_000;
  while (!done() && performance.now() < end) await macrotask();
}

describe("ChangeFeed idle backoff", () => {
  let root: string;
  let cleanup: () => void;
  let backend: QuietBackend;
  let feed: ChangeFeed | null;
  let clock: number;
  let heartbeats: number;
  let errors: Error[];

  const start = async (timings?: { reconcileIntervalMs: number }) => {
    feed = createChangeFeed({
      root,
      backend,
      onBatch: () => {},
      onError: (error) => errors.push(error),
      onDelivered: () => {
        heartbeats += 1;
      },
      now: () => clock,
      ...(timings === undefined ? {} : { timings }),
    });
    await feed.start();
    await armed();
  };
  /** Waits until the feed's queue settled and its idle timer is set again. */
  const armed = async () => {
    await until(() => vi.getTimerCount() > 0);
    expect(vi.getTimerCount()).toBe(1);
  };
  /** Runs `fn`, then waits for the batch or heartbeat it causes and the idle timer after it. */
  const delivered = async (fn: () => void) => {
    const before = heartbeats;
    fn();
    await until(() => heartbeats !== before);
    expect(heartbeats).toBe(before + 1);
    await macrotask();
    await armed();
  };
  /** One idle tick: the clock and the timer move 30 s, then the tick's work settles. */
  const tick = () =>
    delivered(() => {
      clock += TICK;
      vi.advanceTimersByTime(TICK);
    });
  /** The clock times (seconds after start) of the full passes over `ticks` ticks. */
  const fullPassesOver = async (ticks: number) => {
    const at: number[] = [];
    for (let i = 0; i < ticks; i++) {
      const passes = feed?.passesStarted ?? 0;
      await tick();
      if ((feed?.passesStarted ?? 0) > passes) at.push(clock / 1_000);
    }
    return at;
  };

  beforeEach(() => {
    ({ root, cleanup } = makeRepo());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    backend = new QuietBackend();
    feed = null;
    clock = 0;
    heartbeats = 0;
    errors = [];
  });
  afterEach(async () => {
    await feed?.close();
    vi.useRealTimers();
    cleanup();
    expect(errors).toEqual([]);
  });

  it("doubles the gap between idle full passes up to 5 minutes, with a heartbeat every tick", async () => {
    await start();
    expect(feed?.passesStarted).toBe(1);
    // The pass at 30 s is the first that can match the one before it (the start pass had no
    // `HEAD` before it); from there the gaps are 30, 60, 120, 240 s, then 300 s.
    expect(await fullPassesOver(36)).toEqual([30, 60, 120, 240, 480, 780, 1080]);
    expect(heartbeats).toBe(1 + 36);
  }, 60_000);

  it("runs a full pass on every tick when the caller set the interval", async () => {
    await start({ reconcileIntervalMs: TICK });
    expect(await fullPassesOver(6)).toEqual([30, 60, 90, 120, 150, 180]);
  }, 60_000);

  it("resets to 30 s after a watch event", async () => {
    await start();
    expect(await fullPassesOver(16)).toEqual([30, 60, 120, 240, 480]);
    writeFileSync(join(root, "src", "a.ts"), "edited\n");
    // The watch batch is a heartbeat; the next tick is a full pass.
    await delivered(() => {
      backend.listener?.onHints([{ path: join(root, "src", "a.ts"), kind: "change" }]);
      vi.advanceTimersByTime(500);
    });
    const passes = feed?.passesStarted ?? 0;
    await tick();
    expect(feed?.passesStarted).toBe(passes + 1);
  }, 60_000);

  it("runs a full pass at once when HEAD moved", async () => {
    await start();
    expect(await fullPassesOver(8)).toEqual([30, 60, 120, 240]);
    git(root, "commit", "-q", "--allow-empty", "-m", "moved");
    const passes = feed?.passesStarted ?? 0;
    await tick();
    expect(feed?.passesStarted).toBe(passes + 1);
  }, 60_000);

  it("resets to 30 s after dropped events and after an asked pass", async () => {
    await start();
    expect(await fullPassesOver(8)).toEqual([30, 60, 120, 240]);
    await delivered(() => backend.listener?.onDropped("overflow"));
    const after = await fullPassesOver(3);
    expect(after[0]).toBe(clock / 1_000 - 60);
    await feed?.reconcile("watch");
    await armed();
    const passes = feed?.passesStarted ?? 0;
    await tick();
    expect(feed?.passesStarted).toBe(passes + 1);
  }, 60_000);

  it("runs a full pass on every tick at the system's watch limit", async () => {
    await start();
    const limit = Object.assign(new Error("no watches left"), { code: "ENOSPC" });
    await delivered(() => backend.listener?.onError(limit));
    errors = [];
    expect(await fullPassesOver(4)).toHaveLength(4);
  }, 60_000);
});
