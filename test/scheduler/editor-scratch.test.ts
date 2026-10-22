import { rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFsHasher } from "../../src/core/hash/index.js";
import { statCandidates } from "../../src/core/revision/index.js";
import { publishedQuiet } from "../../src/core/scheduler/quiet.js";
import {
  type CatchUpFile,
  type CatchUpRun,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import { CUT_WITHIN_MS, heldRun, pause, SETTLE_MS } from "./tier-yields-fixture.js";

/*
 * Row 011-117 (spec 011 C4 step 5 as amended 2026-10-22,
 * `research/edit-latency.md` 3 and 6.2): vim's swap file and emacs's lock
 * file, untracked and not ignored, change the listing of their directory.
 * A test file that lists it re-keys as before, but the revision cancels no
 * tier in flight and starts no quiet; the completion barrier discards a
 * result only when the listing differs at the run's end. Before it, each vim
 * open cancelled the tier that ran the file and held its lane 20 s: in
 * toolkit-dev 138 s of runs were thrown away and about 57 s of quiet added.
 */

/** A test file whose runs list `lib/`, beside the source it imports. */
const LISTS: CatchUpFile = { path: "test/lists.test.ts", ms: 100, imports: ["lib/a.ts"] };
const SCRATCH = ["lib/.a.ts.swp", "lib/.#a.ts", "lib/4913"];
const SWAP = "lib/.a.ts.swp";

interface Lister {
  readonly side: CatchUpSide;
  /** Hands the scheduler one batch of `paths` as they are on disk. */
  batch(...paths: string[]): Promise<void>;
  remove(path: string): void;
  /** Holds each run until `release`; then runs go through. */
  release(): void;
  /** The causes of the cancels runs saw, in order. */
  readonly causes: unknown[];
  /** The scheduler's waits for quiet, by lane. */
  quiet(): ReadonlyMap<string, number>;
}

/** A side of `LISTS`, whose closure holds the listing `lib/`, its baseline stored, then each run held. */
async function lister(): Promise<Lister> {
  const repo = catchUpRepo([LISTS]);
  const side = catchUpSide(repo, repo.main, { files: [LISTS], hostSlots: 8 });
  const closure = side.runner.closure;
  side.runner.closure = async (ref) => {
    const found = await closure(ref);
    return { ...found, paths: [...found.paths, "lib/"] };
  };
  const causes: unknown[] = [];
  const run = side.runner.run.bind(side.runner);
  side.runner.run = (files, options) => {
    const { signal } = options;
    signal?.addEventListener("abort", () => causes.push(signal.reason), { once: true });
    return run(files, options);
  };
  await side.scheduler.start();
  await side.scheduler.idle();
  expect(side.store.testFiles.get({ project: "", path: LISTS.path })?.closure.paths).toContain(
    "lib/",
  );
  let held = true;
  side.runner.beforeRun = () => (held ? side.runner.hold() : side.runner.release());
  const hasher = createFsHasher(side.root, "sha1");
  return {
    side,
    batch: async (...paths) =>
      side.scheduler.handleBatch({ trigger: "watch", paths: await statCandidates(paths, hasher) }),
    remove: (path) => rmSync(join(side.root, path)),
    release: () => {
      held = false;
      side.runner.release();
    },
    causes,
    quiet: () => publishedQuiet(side.store, side.worktreeId, 0, Date.now()),
  };
}

/** A config edit re-keys `LISTS`, and its backlog tier starts and is held. */
async function heldBacklog(l: Lister): Promise<{ run: CatchUpRun; after: number }> {
  const after = l.side.runner.runs.length;
  await l.side.edit("watch", "config.json");
  return { run: await heldRun(l.side, LISTS.path, after), after };
}

const keyOf = (side: CatchUpSide) =>
  side.store.testFileKeys.list(side.worktreeId).find((row) => row.testFile.path === LISTS.path)
    ?.key ?? null;

describe("editor scratch files cancel no tier and start no quiet (row 011-117)", {
  timeout: 120_000,
}, () => {
  it.each(SCRATCH)(
    "%s created and removed during a backlog tier: it completes and stores",
    async (scratch) => {
      const l = await lister();
      const { run, after } = await heldBacklog(l);
      const ran = keyOf(l.side);

      l.side.touch(scratch);
      await l.batch(scratch);
      await pause(SETTLE_MS);
      // Red before row 011-117: the listing's move superseded the tier ("supersession").
      expect(run.cancelled).toBe(false);
      expect(keyOf(l.side)).not.toBe(ran);
      l.remove(scratch);
      await l.batch(scratch);
      await pause(SETTLE_MS);
      expect(run.cancelled).toBe(false);
      expect(keyOf(l.side)).toBe(ran);

      l.release();
      await l.side.scheduler.idle();
      expect(l.causes).toEqual([]);
      expect(l.side.runner.runsOf(LISTS.path).slice(-1)).toEqual([run]);
      expect(l.side.runner.runs.length).toBe(after + 1);
      expect(run.completed.map((f) => f.path)).toEqual([LISTS.path]);
      expect(l.side.current(LISTS.path)).toBe(true);
      expect(l.quiet()).toEqual(new Map());
    },
  );

  it("a real edit in the same revision still cancels, and its lane waits for quiet", async () => {
    const l = await lister();
    const { run } = await heldBacklog(l);
    await l.side.edit("watch", SWAP, "lib/a.ts");
    await expect.poll(() => run.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
    expect(l.causes).toEqual(["supersession"]);
    expect(l.quiet().size).toBe(1);
  });

  it("a real add in the listed directory beside it still cancels", async () => {
    const l = await lister();
    const { run } = await heldBacklog(l);
    l.side.touch(SWAP, "lib/b.ts");
    await l.batch(SWAP, "lib/b.ts");
    await expect.poll(() => run.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
    expect(l.causes).toEqual(["supersession"]);
  });

  it("a result whose listing still differs at its end is discarded", async () => {
    const l = await lister();
    const { run } = await heldBacklog(l);
    l.side.touch(SWAP);
    await l.batch(SWAP);
    await pause(SETTLE_MS);
    l.release();
    await l.side.scheduler.idle();
    expect(run.cancelled).toBe(false);
    expect(run.completed.map((f) => f.path)).toEqual([LISTS.path]);
    // It ran again at the key with the swap file.
    expect(l.side.runner.runsOf(LISTS.path).at(-1)).not.toBe(run);
    expect(l.side.current(LISTS.path)).toBe(true);

    // The held run's key has no result: the barrier discarded what it gave.
    const before = l.side.runner.runsOf(LISTS.path).length;
    l.remove(SWAP);
    await l.batch(SWAP);
    await l.side.scheduler.idle();
    expect(l.side.runner.runsOf(LISTS.path).length).toBe(before + 1);
    expect(l.side.current(LISTS.path)).toBe(true);
  });

  it("a scratch-only revision does not restart a lane's wait for quiet", async () => {
    const l = await lister();
    const { run } = await heldBacklog(l);
    // A real edit cancels the backlog tier; the lane waits, and the edit's own tier runs.
    await l.side.edit("watch", "lib/a.ts");
    await expect.poll(() => run.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
    l.release();
    await expect.poll(() => l.side.current(LISTS.path), { timeout: CUT_WITHIN_MS }).toBe(true);
    const ends = l.quiet();
    expect(ends.size).toBe(1);

    await pause(SETTLE_MS);
    l.side.touch(SWAP);
    await l.batch(SWAP);
    await pause(SETTLE_MS);
    expect(keyOf(l.side)).not.toBeNull();
    expect(l.side.current(LISTS.path)).toBe(false);
    // Red before row 011-117: the re-key queued a file of the lane, so the wait started again.
    expect(l.quiet()).toEqual(ends);
  });
});
