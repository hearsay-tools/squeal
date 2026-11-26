import { describe, expect, it } from "vitest";
import { CLOSURE_CONCURRENCY, mapBounded } from "../../src/core/scheduler/refinement.js";
import { readUnknownFiles } from "../../src/core/scheduler/unknown-files.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { RunnerAdapter } from "../../src/core/types/runner.js";
import type { RefinementProgress, Scheduler } from "../../src/core/types/scheduler.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpRunner,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
  testFiles,
} from "./catch-up-fixture.js";
import { SLOW } from "./cleanup.js";

/*
 * Row 026-32 (gh-283): a runner part asked for each closure one after
 * another, so over a remote runner 2,000 round trips held a revision for
 * minutes. It asks `CLOSURE_CONCURRENCY` at a time, keeps their order and
 * their failures' order, and tells each step and the closures' progress.
 */

const SOURCE = "src/lib.ts";
/** A source with a namesake test file: edited beside `SOURCE`, the edit cut asks for `SOURCE` alone. */
const UTIL = "src/util.ts";
const FILES = [
  ...testFiles(32, [SOURCE], () => 1),
  { path: "test/util.test.ts", ms: 1, imports: [UTIL] },
];

/** Closure calls held until released one by one, oldest first, with how many are in flight. */
class HeldClosures {
  readonly #waiting: (() => void)[] = [];
  held = false;
  inFlight = 0;
  most = 0;
  calls = 0;
  /** Rejects the call for a path, after its release when `heldToo`. */
  readonly fails = new Map<string, { message: string; heldToo: boolean }>();

  async call<T>(ref: TestFileRef, answer: () => Promise<T>): Promise<T> {
    this.calls += 1;
    this.inFlight += 1;
    this.most = Math.max(this.most, this.inFlight);
    try {
      const fail = this.fails.get(ref.path);
      if (fail !== undefined && !fail.heldToo) throw new Error(fail.message);
      if (this.held) await new Promise<void>((resolve) => this.#waiting.push(resolve));
      if (fail !== undefined) throw new Error(fail.message);
      return await answer();
    } finally {
      this.inFlight -= 1;
    }
  }

  get waiting(): number {
    return this.#waiting.length;
  }

  release(count = Number.POSITIVE_INFINITY): void {
    for (let i = 0; i < count && this.#waiting.length > 0; i += 1) this.#waiting.shift()?.();
  }

  releaseAll(): void {
    this.held = false;
    this.release();
  }
}

interface Watched {
  readonly side: CatchUpSide;
  readonly closures: HeldClosures;
  /** The step the scheduler named as each runner call began. */
  readonly stages: string[];
  /** The next `invalidate` reports the project recreated: every file's closure is asked again. */
  recreate: boolean;
}

/** A side whose runner reports its step at each call, and whose closure calls `closures` holds. */
function watchedSide(): Watched {
  const closures = new HeldClosures();
  const stages: string[] = [];
  let scheduler: Scheduler | null = null;
  const watched = { closures, stages, recreate: false } as Omit<Watched, "side"> & {
    side?: CatchUpSide;
  };
  const stage = () => scheduler?.refinementProgress?.()?.stage ?? "none";
  const wrap = (runner: CatchUpRunner): RunnerAdapter =>
    new Proxy(runner, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver) as unknown;
        if (typeof value !== "function") return value;
        const method = value as (...args: unknown[]) => Promise<unknown>;
        return async (...args: unknown[]) => {
          if (prop !== "run" && prop !== "releaseLane") stages.push(`${String(prop)}@${stage()}`);
          if (prop === "invalidate" && watched.recreate) {
            watched.recreate = false;
            await method.apply(target, args);
            return { recreatedProjects: [""] };
          }
          if (prop === "closure")
            return closures.call(args[0] as TestFileRef, () => method.apply(target, args));
          return method.apply(target, args);
        };
      },
    });
  const repo = catchUpRepo(FILES);
  const side = catchUpSide(repo, repo.main, {
    files: FILES,
    hostSlots: 1,
    policy: RUN_MISSING,
    wrapRunner: wrap,
  });
  scheduler = side.scheduler;
  watched.side = side;
  return watched as Watched;
}

async function started(): Promise<Watched> {
  const watched = watchedSide();
  await watched.side.scheduler.start();
  await watched.side.quiet();
  for (const file of FILES) expect(watched.side.current(file.path)).toBe(true);
  watched.stages.splice(0);
  watched.closures.calls = 0;
  watched.closures.most = 0;
  return watched;
}

const progress = (w: Watched): RefinementProgress | null =>
  w.side.scheduler.refinementProgress?.() ?? null;

describe("mapBounded (row 026-32)", () => {
  it("runs at most `limit` at once and keeps the items' order whatever order they settle in", async () => {
    let inFlight = 0;
    let most = 0;
    const items = Array.from({ length: 40 }, (_, i) => i);
    const answers = await mapBounded(items, 16, async (i) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      // Later items settle first.
      await new Promise((resolve) => setTimeout(resolve, 40 - i));
      inFlight -= 1;
      return i * 2;
    });
    expect(most).toBe(16);
    expect(answers).toEqual(items.map((i) => i * 2));
  });

  it("starts no item once `stop` is true; those have no answer", async () => {
    let started = 0;
    const answers = await mapBounded(
      [1, 2, 3, 4, 5, 6],
      2,
      async (i) => {
        started += 1;
        return i;
      },
      () => started >= 3,
    );
    expect(started).toBe(3);
    expect(answers.filter((a) => a !== undefined)).toHaveLength(3);
  });

  it("handles no items and a limit above their count", async () => {
    expect(await mapBounded([], 16, async () => 1)).toEqual([]);
    expect(await mapBounded([1, 2], 16, async (i) => i + 1)).toEqual([2, 3]);
  });
});

describe("a runner part's closures (row 026-32, gh-283)", SLOW, () => {
  it(
    `asks ${CLOSURE_CONCURRENCY} closures at a time, tells each step and the closures' progress`,
    SLOW,
    async () => {
      const w = await started();
      w.recreate = true;
      w.closures.held = true;
      await w.side.edit("watch", SOURCE, UTIL);

      // The first wave: 16 in flight, none more until one settles.
      await expect.poll(() => w.closures.waiting).toBe(CLOSURE_CONCURRENCY);
      expect(w.closures.calls).toBe(CLOSURE_CONCURRENCY);
      expect(progress(w)).toMatchObject({ stage: "closures", done: 0, total: FILES.length });
      // The lock is free while the closures are asked: `listing` names the revision too.
      expect(w.side.scheduler.listing?.()).toBe(progress(w)?.revision);

      w.closures.release(4);
      await expect.poll(() => progress(w)?.done).toBe(4);
      await expect.poll(() => w.closures.waiting).toBe(CLOSURE_CONCURRENCY);
      expect(w.closures.calls).toBe(CLOSURE_CONCURRENCY + 4);

      w.closures.releaseAll();
      await w.side.quiet();
      expect(w.closures.most).toBe(CLOSURE_CONCURRENCY);
      expect(w.closures.calls).toBe(FILES.length);
      expect(progress(w)).toBeNull();
      expect(w.side.scheduler.listing?.()).toBeNull();

      // Each runner call began at its own step, in order.
      const order = [...new Set(w.stages)];
      expect(order).toEqual([
        "invalidate@invalidating",
        "environment@environment",
        "testFiles@listing",
        "affected@affected",
        "closure@closures",
        "affected@edit-cut",
      ]);
      for (const file of FILES) expect(w.side.current(file.path)).toBe(true);
    },
  );

  it("keeps the first failure in the order asked, whichever settles first", SLOW, async () => {
    const w = await started();
    w.recreate = true;
    w.closures.held = true;
    // f003 fails only once released; f020, asked later, fails at once.
    w.closures.fails.set("test/f003.test.ts", { message: "first asked", heldToo: true });
    w.closures.fails.set("test/f020.test.ts", { message: "first settled", heldToo: false });
    await w.side.edit("watch", SOURCE);
    await expect.poll(() => w.closures.waiting).toBe(CLOSURE_CONCURRENCY);
    w.closures.releaseAll();
    await w.side.quiet();

    expect(w.closures.calls).toBe(FILES.length);
    // The project's files are blocked with the reason of the closure asked first.
    const unknown = readUnknownFiles(w.side.store, w.side.worktreeId);
    const reasons = new Set([...unknown.values()].map((entry) => entry.reason));
    expect(reasons.size).toBe(1);
    expect([...reasons][0]).toContain("closure of test/f003.test.ts failed: first asked");
  });
});
