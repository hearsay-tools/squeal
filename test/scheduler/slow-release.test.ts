import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { removeCommandHold } from "../../src/core/scheduler/hold-rows.js";
import { SLOW_RELEASE_MS, SlowRelease } from "../../src/core/scheduler/slow-release.js";
import { Wakes } from "../../src/core/scheduler/wakes.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { virtualClock } from "../helpers/virtual-clock.js";
import { catchUpRepo, catchUpSide } from "./catch-up-fixture.js";
import { heldFiles, hold, liveProcess, settle } from "./command-hold-fixture.js";

/*
 * Row 011-211: when `SlowRelease` closes a slow lane's instance whose slow
 * files are still queued, alone and in the scheduler's two orders where an
 * interleaving would close it under a run: the bound passing during a slow
 * selection, and a hold beginning while a slow tier runs. A real instance
 * and its `globalSetup` are `slow-release-setup.test.ts`. The cases alone run
 * on the virtual clock and the wake loop (row 011-352), each step to rest.
 * Row 011-355: the bound's rule cases are the `decideRelease` table
 * (`decide-release.test.ts`); these cases are the apply.
 */

const LANE = "slow:vitest";

/**
 * A `SlowRelease` over a host whose kept lanes the test sets: each tier's
 * in flight and each waiting for its load guard, as the scheduler gives.
 */
let clock = virtualClock();
let wakes = new Wakes(clock);

/** Row 011-352: moves the virtual clock `ms` on, then waits for the close's work to rest. */
async function advance(ms: number): Promise<void> {
  clock.advance(ms);
  await wakes.rest();
}

function open() {
  const released: string[] = [];
  const host = { inFlight: [] as string[], closed: false };
  const release = new SlowRelease({
    release: async (lane) => {
      released.push(lane);
    },
    lanes: () => host.inFlight,
    now: () => clock.now(),
    closed: () => host.closed,
    wakes,
  });
  /** A slow tier of `lane` ran and ended now, its lane left open. */
  const ran = (lane = LANE) => {
    release.opened(lane);
    release.ended(lane);
  };
  return { release, host, released, ran };
}

describe("SlowRelease (row 011-211)", () => {
  beforeEach(() => {
    clock = virtualClock(1_000_000);
    wakes = new Wakes(clock);
  });

  it("closes an open lane once no slow tier started for the bound after the last run", async () => {
    const { released, ran } = open();
    ran();
    await advance(SLOW_RELEASE_MS - 1);
    expect(released).toEqual([]);
    await advance(1);
    expect(released).toEqual([LANE]);
    await advance(SLOW_RELEASE_MS);
    expect(released).toEqual([LANE]);
  });

  it("keeps the instance through a slow selection, the load guard's wait; past the bound its end closes it", async () => {
    const { release, released, ran } = open();
    ran();
    let guard = () => {};
    const selection = release.selecting(
      () => new Promise<void>((resolve) => (guard = () => resolve())),
    );
    await advance(SLOW_RELEASE_MS * 3);
    // A hold that begins now waits for the selection's end too.
    await release.idle();
    expect(released).toEqual([]);
    guard();
    await selection;
    await advance(0);
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
    await advance(SLOW_RELEASE_MS);
    expect(released).toEqual([LANE]);

    ran();
    release.close();
    host.closed = true;
    await advance(SLOW_RELEASE_MS);
    expect(released).toEqual([LANE]);
  });

  it("the bound passes during a slow selection that starts a tier: nothing closes; the tier's end arms it again", async () => {
    const { release, host, released, ran } = open();
    ran();
    let start = () => {};
    const selection = release.selecting(
      () =>
        new Promise<void>((resolve) => {
          start = () => {
            host.inFlight = [LANE];
            resolve();
          };
        }),
    );
    await advance(SLOW_RELEASE_MS * 2);
    start();
    await selection;
    await advance(SLOW_RELEASE_MS * 2);
    expect(released).toEqual([]);
    host.inFlight = [];
    ran();
    await advance(SLOW_RELEASE_MS - 1);
    expect(released).toEqual([]);
    await advance(1);
    expect(released).toEqual([LANE]);
  });
});

const SLOW = {
  ...DEFAULT_POLICY.slow,
  include: ["test/**"],
  quietMs: 0,
  maxDeferMs: 10_000,
  maxParallel: 1,
};

/**
 * `count` slow files of `realMs` each over the fake runner, started; `log`
 * holds each run's start and end and each close of a slow lane, in order.
 */
async function slowSide(
  count: number,
  realMs: number,
  runner: { cancels: boolean; backlogSlot?: () => number },
  releaseMs: number,
) {
  const files = heldFiles(count, realMs);
  const repo = catchUpRepo(files);
  const slotDir = mkdtempSync(join(tmpdir(), "squeal-011-211-slot-"));
  onTestFinished(() => rmSync(slotDir, { recursive: true, force: true }));
  let load = 0;
  const side = catchUpSide(repo, repo.main, {
    files,
    hostSlots: 4,
    ...runner,
    policy: { ...RUN_MISSING, slow: SLOW },
    scheduler: {
      slow: { slotDir, recheckMs: 50, cpus: () => 1, load: () => [load], releaseMs },
    },
  });
  const log: string[] = [];
  const names = (refs: readonly TestFileRef[]) => refs.map((ref) => ref.path).join(" ");
  const run = side.runner.run.bind(side.runner);
  side.runner.run = async (refs, options) => {
    log.push(`start ${names(refs)}`);
    try {
      return await run(refs, options);
    } finally {
      log.push(`end ${names(refs)}`);
    }
  };
  Object.assign(side.runner, {
    releaseLane: async (lane: string) => {
      log.push(`release ${lane}`);
    },
  });
  await side.scheduler.start();
  const kinds = () => log.map((line) => line.split(" ")[0]);
  return { side, log, kinds, setLoad: (next: number) => (load = next) };
}

describe("the scheduler closes no slow instance under a run (row 011-211)", {
  timeout: 60_000,
}, () => {
  it("the bound passes during the load guard's wait: no close; the tier it starts closes it as its pass drains", async () => {
    const { side, kinds, setLoad } = await slowSide(2, 1_000, { cancels: true }, 300);
    await expect.poll(() => side.runner.active, { timeout: 10_000 }).toBe(1);
    setLoad(10);
    await expect.poll(kinds, { timeout: 10_000 }).toEqual(["start", "end"]);
    await settle(1_000);
    expect(kinds()).toEqual(["start", "end"]);

    setLoad(0);
    await expect
      .poll(kinds, { timeout: 10_000 })
      .toEqual(["start", "end", "start", "end", "release"]);
  });

  it.each([
    ["a runner that cancels (Vitest), once the cancel settled", { cancels: true }],
    [
      "a runner that does not (node:test, pytest), once its file ended",
      { cancels: false, backlogSlot: () => 1 },
    ],
  ])("a hold that begins while a slow tier runs closes the instance with %s", async (_, runner) => {
    const { side, log, kinds } = await slowSide(2, 2_000, runner, 60_000);
    await expect.poll(() => side.runner.active, { timeout: 10_000 }).toBe(1);
    const entry = hold(side, (await liveProcess()).identity);
    expect(await side.scheduler.commandHold()).toBe(true);
    await expect.poll(kinds, { timeout: 10_000 }).toEqual(["start", "end", "release"]);
    expect(log.at(-1)).toBe("release slow:");
    await settle(500);
    expect(kinds()).toEqual(["start", "end", "release"]);

    removeCommandHold(side.store, side.worktreeId, entry.token);
    expect(await side.scheduler.commandHold()).toBe(false);
    await expect
      .poll(() => kinds().filter((kind) => kind === "release").length, { timeout: 20_000 })
      .toBe(2);
  });
});
