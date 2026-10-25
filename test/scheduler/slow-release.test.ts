import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SLOW_RELEASE_MS, SlowRelease } from "../../src/core/scheduler/slow-release.js";
import type { EpochMs } from "../../src/core/types/index.js";

/*
 * Row 011-211: when `SlowRelease` closes a slow lane's instance whose slow
 * files are still queued. The scheduler's side, a real instance and its
 * `globalSetup`, is `slow-release-setup.test.ts`.
 */

const LANE = "slow:vitest";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** A `SlowRelease` over a host whose lanes in flight and last slow end the test sets. */
function open() {
  const released: string[] = [];
  const host = {
    inFlight: [] as string[],
    endedAt: null as EpochMs | null,
    closed: false,
  };
  const release = new SlowRelease({
    release: async (lane) => {
      released.push(lane);
    },
    lanes: () => host.inFlight,
    endedAt: () => host.endedAt,
    now: () => Date.now(),
    closed: () => host.closed,
  });
  /** A slow tier of `LANE` ran and ended now, its lane left open. */
  const ran = () => {
    release.opened(LANE);
    host.endedAt = Date.now();
    release.arm();
  };
  return { release, host, released, ran };
}

describe("SlowRelease (row 011-211)", () => {
  it("closes an open lane once no slow tier started for the bound after the last run", async () => {
    const { released, ran } = open();
    ran();
    await vi.advanceTimersByTimeAsync(SLOW_RELEASE_MS - 1);
    expect(released).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(released).toEqual([LANE]);
    await vi.advanceTimersByTimeAsync(SLOW_RELEASE_MS);
    expect(released).toEqual([LANE]);
  });

  it("counts from the latest slow run's end", async () => {
    const { released, ran } = open();
    ran();
    await vi.advanceTimersByTimeAsync(SLOW_RELEASE_MS / 2);
    ran();
    await vi.advanceTimersByTimeAsync(SLOW_RELEASE_MS / 2);
    expect(released).toEqual([]);
    await vi.advanceTimersByTimeAsync(SLOW_RELEASE_MS / 2);
    expect(released).toEqual([LANE]);
  });

  it("keeps a lane whose tier is in flight; its end arms the count again", async () => {
    const { host, released, ran } = open();
    ran();
    host.inFlight = [LANE];
    await vi.advanceTimersByTimeAsync(SLOW_RELEASE_MS * 2);
    expect(released).toEqual([]);
    host.inFlight = [];
    ran();
    await vi.advanceTimersByTimeAsync(SLOW_RELEASE_MS);
    expect(released).toEqual([LANE]);
  });

  it("keeps the instance through a slow selection, the load guard's wait; past the bound its end closes it", async () => {
    const { release, released, ran } = open();
    ran();
    let guard = () => {};
    const selection = release.selecting(
      () => new Promise<void>((resolve) => (guard = () => resolve())),
    );
    await vi.advanceTimersByTimeAsync(SLOW_RELEASE_MS * 3);
    // A hold that begins now waits for the selection's end too.
    await release.idle();
    expect(released).toEqual([]);
    guard();
    await selection;
    await vi.advanceTimersByTimeAsync(0);
    expect(released).toEqual([LANE]);
  });

  it("a hold's close takes every open lane no tier runs in, once", async () => {
    const { release, host, released } = open();
    release.opened(LANE);
    release.opened("slow:other");
    host.inFlight = ["slow:other"];
    await Promise.all([release.idle(), release.idle()]);
    expect(released).toEqual([LANE]);
  });

  it("a drained pass's release is not repeated by the count, and the close stops it", async () => {
    const { release, host, released, ran } = open();
    ran();
    await release.release(LANE);
    await vi.advanceTimersByTimeAsync(SLOW_RELEASE_MS);
    expect(released).toEqual([LANE]);

    ran();
    release.close();
    host.closed = true;
    await vi.advanceTimersByTimeAsync(SLOW_RELEASE_MS);
    expect(released).toEqual([LANE]);
  });
});
