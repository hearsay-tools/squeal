import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { connectionOf } from "../../src/core/store/store.js";
import type { SlowPrecondition } from "../../src/core/types/index.js";
import type { Harness } from "../scheduler/helpers.js";
import { SLOW } from "../scheduler/helpers.js";
import { waitFor } from "../watcher/helpers.js";
import {
  NODE,
  open,
  READY,
  ranThenUnready,
  reopen,
  SLOW_FILES,
  scratch,
  skipReason,
  slowRuns,
} from "./precondition-helpers.js";

/*
 * Task 004-69 (review wave-8.1, "Restart residual"; spec 004 D8 as amended,
 * 001 D7, task 001-219): a daemon that inherits an owed forced checkpoint
 * whose precondition was never resolved keeps its baseline open on the
 * owed slow files, so it completes no full suite over the skip it then
 * finds. A met precondition still completes both.
 */

/**
 * A command that exits 0 while `ready` exists; otherwise it marks
 * `started`, holds until `release`, then exits 1.
 */
function latch() {
  const markers = scratch("squeal-004-69-latch-");
  const at = (name: string) => JSON.stringify(join(markers, name));
  const script = [
    'const fs = require("node:fs");',
    'if (fs.existsSync("ready")) process.exit(0);',
    `fs.appendFileSync(${at("started")}, "x");`,
    `const hold = setInterval(() => { if (fs.existsSync(${at("release")})) { clearInterval(hold); process.exit(1); } }, 20);`,
  ].join("\n");
  // A command still held at the test's end lets go before its directory is removed.
  const release = () => {
    if (existsSync(markers)) writeFileSync(join(markers, "release"), "");
  };
  onTestFinished(release);
  const started = () => existsSync(join(markers, "started"));
  const precondition: SlowPrecondition = { command: [NODE, "-e", script], timeoutMs: 60_000 };
  return { precondition, release, started };
}

/** Both slow files run with `ready`, then a revision removes it: their results stay stored. */
async function ranThenUnreadyCommand(precondition: SlowPrecondition): Promise<Harness> {
  const h = await open(precondition, { setup: (h) => h.write("ready", "") });
  expect(slowRuns(h)).toHaveLength(2);
  rmSync(join(h.root, "ready"));
  h.write("src/math.ts", "export const add = (a: number, b: number) => a + b; // edited\n");
  await h.batch("src/math.ts", "ready");
  await h.scheduler.idle();
  return h;
}

/** A forced `run --all` whose precondition command is still waiting: the checkpoint is owed at close. */
async function owedMidCommand(precondition: SlowPrecondition, started: () => boolean) {
  const h = await ranThenUnreadyCommand(precondition);
  const owed = await h.scheduler.requestFullSuite({ force: true });
  await waitFor(started, 60_000);
  expect(skipReason(h)).toBeNull();
  return { h, owed };
}

/** A real SQLite error on the writer's connection when the sink writes a skipped check stale. */
function failStaleWrites(h: Harness): () => void {
  const { db } = connectionOf(h.store);
  db.exec(`CREATE TEMP TRIGGER review_sink_error BEFORE INSERT ON known_states
    WHEN NEW.validity = 'stale'
    BEGIN SELECT RAISE(ABORT, 'review injected SQLite sink error'); END`);
  return () => db.exec("DROP TRIGGER review_sink_error");
}

describe("a baseline beside an owed precondition check (task 004-69)", SLOW, () => {
  it("completes no full suite when the next daemon's command exits 1", async () => {
    const { precondition, release, started } = latch();
    const { h, owed } = await owedMidCommand(precondition, started);
    const runs = slowRuns(h).length;
    // The close aborts the waiting command; the next daemon's exits 1 at once.
    release();
    const next = await reopen(h, precondition);
    expect(next.store.checkpoints.get(owed.id)?.end).toBe("abandoned");
    expect(slowRuns(next)).toHaveLength(0);
    expect(runs).toBe(2);
    expect(next.header().fullSuite.atCurrentRevision).toBe(false);
    expect(next.header().slowTier).toMatchObject({ current: 0, notRun: 2 });
    expect(skipReason(next)).toMatch(/exited 1 \(slow\.precondition\.command\)/);
  });

  it("completes the baseline and the owed checkpoint when the next daemon's command is met", async () => {
    const { precondition, started } = latch();
    const { h, owed } = await owedMidCommand(precondition, started);
    h.write("ready", "");
    const next = await reopen(h, precondition);
    expect(next.store.checkpoints.get(owed.id)?.end).toBe("completed");
    expect(slowRuns(next).flat().sort()).toEqual(SLOW_FILES);
    expect(skipReason(next)).toBeNull();
    expect(next.header().fullSuite.atCurrentRevision).toBe(true);
    expect(next.header().slowTier).toMatchObject({ current: 2, notRun: 0 });
  });

  it("completes no full suite after a rolled-back skip owed at close (R2)", async () => {
    const h = await ranThenUnready(undefined, { allowErrors: true });
    const restore = failStaleWrites(h);
    const first = await h.scheduler.requestFullSuite({ force: true });
    await h.scheduler.idle();
    expect(h.store.checkpoints.get(first.id)?.end).toBeNull();
    restore();

    const next = await reopen(h, { exists: ["ready"] });
    expect(next.store.checkpoints.get(first.id)?.end).toBe("abandoned");
    expect(skipReason(next)).toBe(READY);
    expect(next.header().fullSuite.atCurrentRevision).toBe(false);
    expect(next.header().slowTier).toMatchObject({ current: 0, notRun: 2, skipped: READY });
  });
});
