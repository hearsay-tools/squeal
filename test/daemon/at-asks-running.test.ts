import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type AtAskPorts, AtAsks } from "../../src/core/daemon/at-asks.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { batchesOf, Gate } from "../scheduler/batch-fixture.js";
import {
  type CatchUpFile,
  type CatchUpRun,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "../scheduler/catch-up-fixture.js";

/*
 * Row 023-60 (spec 023 D7.3, dogfood round 7 W3): in 6 of 10 sessions the
 * one named file ran inside the commit daemon's first batch tier of about
 * 65 files, and its result came when that tier ended, 250 to 420 s later.
 * Here a real scheduler as a commit daemon: lookup-only, every file a miss
 * whose stored duration another worktree ran. A wide ask's batch runs as
 * one tier of 40 files at 4 workers; a later ask names a file inside it.
 * The tier is cut (spec 011 C4 step 5, coordinator-approved): the named
 * file runs next, alone; the rest keeps its batch.
 */

const TIMEOUT = 20_000;
const path = (i: number) => `test/f${String(i).padStart(2, "0")}.test.ts`;
const files = (ms: number, realMs: (i: number) => number): CatchUpFile[] =>
  Array.from({ length: 40 }, (_, i) => ({
    path: path(i),
    ms,
    realMs: realMs(i),
    imports: [`src/s${i}.ts`],
  }));
const paths = (run: CatchUpRun | undefined) => run?.files.map((f) => f.path) ?? [];

/**
 * A commit daemon's scheduler over `of` whose store holds each file's
 * duration, `ms`, from another worktree's run, while its own keys differ (a
 * changed environment file): every file is a miss, none queued.
 */
async function seeded(of: readonly CatchUpFile[]): Promise<CatchUpSide> {
  const repo = catchUpRepo(of);
  // The other worktree's run stores the durations; its own runs take no time.
  const quick = of.map((f) => ({ ...f, realMs: 0 }));
  const other = catchUpSide(repo, repo.other, { files: quick, hostSlots: 4, policy: RUN_MISSING });
  await other.scheduler.start();
  await expect.poll(() => of.every((f) => other.current(f.path)), { timeout: TIMEOUT }).toBe(true);
  appendFileSync(join(repo.main, "config.json"), "// the commit\n");
  const side = catchUpSide(repo, repo.main, {
    files: of,
    hostSlots: 4,
    policy: { baseline: { onStart: "lookup-only" } },
  });
  await side.scheduler.start();
  await side.rest();
  return side;
}

/** The commit daemon's asks over `side`'s scheduler, every file of `of` with no result. */
function asksOf(side: CatchUpSide, of: readonly CatchUpFile[]): AtAsks {
  const refs: TestFileRef[] = of.map((f) => ({ project: "", path: f.path }));
  const ports: AtAskPorts = {
    setup: () => ({ phase: "ready" }),
    started: async () => {},
    changedSelects: async () => refs,
    rows: () => refs.map((testFile) => ({ testFile, key: `k-${testFile.path}`, pending: null })),
    stored: () => false,
    needs: async () => new Map(),
    groupOf: () => "tests",
    request: async (group, asked, options) => {
      await side.scheduler.requestGroupPaths?.(group, asked, options);
    },
    changed: () => {},
  };
  return new AtAsks(ports);
}

/** An ask of `owner` naming `named`, queued. */
async function ask(asks: AtAsks, owner: string, named: readonly string[]): Promise<void> {
  asks.ask({ type: "commit-ask", owner, changed: ["src/s0.ts"], named, allMissing: false });
  await expect
    .poll(() => asks.snapshot().asks.find((a) => a.owner === owner)?.phase, { timeout: TIMEOUT })
    .toBe("queued");
}

/** The wide call's batch tier in flight: all 40 files at the grant. */
async function wideTier(side: CatchUpSide, asks: AtAsks): Promise<CatchUpRun> {
  await ask(asks, "wide", []);
  await expect.poll(() => side.runner.runs.length, { timeout: TIMEOUT }).toBe(1);
  const [tier] = side.runner.runs;
  if (tier === undefined) throw new Error("no tier");
  expect([tier.files.length, tier.workers]).toEqual([40, 4]);
  return tier;
}

describe("a named file inside a running batch tier is answered when it ends (row 023-60, W3)", {
  timeout: 90_000,
}, () => {
  it("cuts the tier: the named file runs next, alone, within its own time; the rest keeps its batch", async () => {
    const of = files(10_000, () => 500);
    const side = await seeded(of);
    // A tier of more than one file never ends by itself: only a cut ends it.
    const gate = new Gate();
    side.runner.holdOf = (run) => (run.files.length > 1 ? gate.wait() : undefined);
    const asks = asksOf(side, of);
    const tier = await wideTier(side, asks);
    const named = path(39);

    const asked = performance.now();
    await ask(asks, "narrow", [named]);
    await expect.poll(() => side.current(named), { timeout: TIMEOUT, interval: 20 }).toBe(true);
    // Its own 0.5 s plus an allowance; the tier would take 40 × 10 s over 4 workers.
    expect(performance.now() - asked).toBeLessThan(500 + 5_000);
    expect(tier.cancelled).toBe(true);
    expect(paths(side.runner.runs[1])).toEqual([named]);

    // The 39 others stay in their batch, so they lead the lane's next tier.
    const rest = of.map((f) => f.path).filter((p) => p !== named);
    const places = batchesOf(side);
    expect(rest.every((p) => places.get(p) !== undefined && places.get(p) !== null)).toBe(true);
    await expect.poll(() => side.runner.runs.length, { timeout: TIMEOUT }).toBe(3);
    expect(paths(side.runner.runs[2]).toSorted()).toEqual(rest);
    gate.stop();
    await expect.poll(() => of.every((f) => side.current(f.path)), { timeout: TIMEOUT }).toBe(true);
  });

  it("keeps the results of the tier's files that ended before the cut", async () => {
    // The first four files end at once; the others take 1 s each, so they end after the cut.
    const of = files(10_000, (i) => (i < 4 ? 0 : 1_000));
    const side = await seeded(of);
    const asks = asksOf(side, of);
    const tier = await wideTier(side, asks);
    await ask(asks, "narrow", [path(39)]);
    await expect.poll(() => side.current(path(39)), { timeout: TIMEOUT, interval: 20 }).toBe(true);
    expect(tier.cancelled).toBe(true);
    const first = [0, 1, 2, 3].map(path);
    expect(paths({ ...tier, files: tier.completed })).toEqual(expect.arrayContaining(first));
    expect(first.every((p) => side.current(p))).toBe(true);
    // The rest of the batch runs to its end; the cut's completed files never run again.
    await expect.poll(() => of.every((f) => side.current(f.path)), { timeout: 60_000 }).toBe(true);
    const again = side.runner.runs.slice(1).flatMap((run) => paths(run));
    expect(again.filter((p) => first.includes(p))).toEqual([]);
  });

  it("does not cut a tier for a named wait that does not lead, nor a batch tier with no named file", async () => {
    const of = files(10_000, () => 500);
    const side = await seeded(of);
    const gate = new Gate();
    side.runner.holdOf = (run) => (run.files.length > 1 ? gate.wait() : undefined);
    const asks = asksOf(side, of);
    const tier = await wideTier(side, asks);
    // A request for the file without `lead`, as a wait that names no path forms.
    await side.scheduler.requestGroupPaths?.("tests", [path(39)], { at: true });
    await side.rest();
    expect(tier.cancelled).toBe(false);
    expect(side.runner.runs).toHaveLength(1);
    gate.stop();
    await expect.poll(() => side.current(path(39)), { timeout: TIMEOUT }).toBe(true);
    expect(tier.cancelled).toBe(false);
  });

  it("does not cut a tier whose work left is within 30 s of the named file's own", async () => {
    // 40 × 2 s over 4 workers: 20 s in all.
    const of = files(2_000, () => 500);
    const side = await seeded(of);
    const gate = new Gate();
    side.runner.holdOf = (run) => (run.files.length > 1 ? gate.wait() : undefined);
    const asks = asksOf(side, of);
    const tier = await wideTier(side, asks);
    await ask(asks, "narrow", [path(39)]);
    await side.rest();
    expect(tier.cancelled).toBe(false);
    expect(side.runner.runs).toHaveLength(1);
    gate.stop();
    await expect.poll(() => of.every((f) => side.current(f.path)), { timeout: TIMEOUT }).toBe(true);
    expect(tier.cancelled).toBe(false);
  });

  it("does not cut for a leading group whose own batch time is within 30 s of the tier's (review 0.1.607 P1)", async () => {
    // 30 of the 40 files named: 30 × 10 s over 4 workers is 75 s against the tier's 100 s.
    const of = files(10_000, () => 500);
    const side = await seeded(of);
    const gate = new Gate();
    side.runner.holdOf = (run) => (run.files.length > 1 ? gate.wait() : undefined);
    const asks = asksOf(side, of);
    const tier = await wideTier(side, asks);
    await ask(
      asks,
      "group",
      Array.from({ length: 30 }, (_, i) => path(i + 10)),
    );
    await side.rest();
    expect(tier.cancelled).toBe(false);
    expect(side.runner.runs).toHaveLength(1);
    gate.stop();
    await expect.poll(() => of.every((f) => side.current(f.path)), { timeout: TIMEOUT }).toBe(true);
    expect(tier.cancelled).toBe(false);
  });

  it("cuts once: a second leading call inside the cut batch's next tier waits for it", async () => {
    const of = files(10_000, () => 500);
    const side = await seeded(of);
    const gate = new Gate();
    side.runner.holdOf = (run) => (run.files.length > 1 ? gate.wait() : undefined);
    const asks = asksOf(side, of);
    const tier = await wideTier(side, asks);
    await ask(asks, "first", [path(39)]);
    await expect.poll(() => side.current(path(39)), { timeout: TIMEOUT }).toBe(true);
    expect(tier.cancelled).toBe(true);
    await expect.poll(() => side.runner.runs.length, { timeout: TIMEOUT }).toBe(3);
    const next = side.runner.runs[2];
    expect(paths(next)).toContain(path(38));

    // Its files were cut once: a second call naming one of them does not cut it again.
    await ask(asks, "second", [path(38)]);
    await side.rest();
    expect(next?.cancelled).toBe(false);
    expect(side.runner.runs).toHaveLength(3);
    gate.stop();
    await expect.poll(() => side.current(path(38)), { timeout: TIMEOUT }).toBe(true);
  });
});
