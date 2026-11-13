import { realpathSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { importsWaiting } from "../../src/core/scheduler/imports-waiting.js";
import { ImportsSeen } from "../../src/core/shared/imports-seen.js";
import { readStatus } from "../../src/core/status/snapshot.js";
import { BusyWaits } from "../../src/core/store/busy.js";
import { setBusyTimeout } from "../../src/core/store/open.js";
import { storePaths } from "../../src/core/store/paths.js";
import { threadLockHolder } from "../helpers/busy-store.js";
import { side } from "../scheduler/claims-fixture.js";
import { COUNT, importedPasses, publishedRun } from "./daemon-kit.js";
import { readerOf, scratch } from "./reader-kit.js";
import { cloneOf } from "./remote.js";

/*
 * Row 011-323 (spec 011 `research/request-intake.md`, difference 1; spec
 * 021 D2): an import's waiting mark was written outside the busy-store
 * retry. On a busy store it failed after the store's one wait, `squeal
 * import` ignored the error, and the daemon took the import only at a later
 * request. Here another thread holds the write lock past the store's own
 * wait when the daemon's retry request takes the import: the request is
 * tried again until the holder ends, status then names the import while
 * the keys wait, and the keys take it with no run.
 */

const SLOW = { timeout: 60_000 } as const;
const LOOKUP_ONLY = { baseline: { onStart: "lookup-only" as const } };
/** The store's own wait: the daemon's 5 s, shorter than the hold. */
const OWN_MS = 100;
/** The daemon's `BUSY_SLICE_MS`, short. */
const SLICE_MS = 25;
/** Past several slices and the store's own wait. */
const HOLD_MS = 500;
const NONE = {
  sameKeyKept: 0,
  sameKeyNotAdopted: 0,
  environment: 0,
  closure: 0,
  observed: 0,
  content: 0,
  keysPending: 0,
  noKey: 0,
};

/**
 * A lookup-only daemon's scheduler over a fresh clone of a published CI
 * run, with the daemon's busy-store retry, keyed and idle; `retry` is its
 * retry request as `daemon.ts` wires it. Its runner's next invalidation,
 * the re-key's refinement, waits for `release`.
 */
async function busyDaemon() {
  const s = scratch();
  await publishedRun(s);
  const dev = realpathSync(cloneOf(s, "main"));
  const notes: string[] = [];
  const busyWaits = new BusyWaits({ now: Date.now, note: (text) => notes.push(text) });
  const b = side(dev, {
    count: COUNT,
    policy: LOOKUP_ONLY,
    busy: { busyWaits, busySliceMs: SLICE_MS },
  });
  await b.scheduler.start();
  await b.scheduler.idle();
  expect(b.passing()).toBe(0);
  const seen = new ImportsSeen(b.store);
  const retry = async () => {
    await seen.take((projects, imports) => b.scheduler.requestImports(projects, imports));
    await b.scheduler.requestRetries();
  };
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const invalidate = b.runner.invalidate;
  b.runner.invalidate = async () => {
    await held;
    b.runner.invalidate = invalidate;
    return invalidate();
  };
  const database = storePaths(join(dev, ".git")).database;
  return { dev, b, retry, release, notes, database };
}

describe("an import into a running daemon on a busy store (row 011-323)", SLOW, () => {
  it("re-keys once the holder ends, status naming the import meanwhile", async () => {
    const { dev, b, retry, release, notes, database } = await busyDaemon();
    // The import lands; the daemon is told only once another connection holds the lock.
    const reader = readerOf(dev, { store: b.store });
    await reader.run();
    expect(reader.imported()).toBe(1);
    setBusyTimeout(b.store, OWN_MS);
    onTestFinished(() => setBusyTimeout(b.store, 10_000));
    const holder = threadLockHolder(database, HOLD_MS);
    holder.take();

    await retry();

    expect(holder.released).toBe(true);
    expect(importsWaiting(b.store, b.worktreeId)).toHaveLength(1);
    expect(readStatus(dev)).toMatchObject({
      imports: [{ testFiles: COUNT, currentFiles: 0, notCurrent: { ...NONE, keysPending: COUNT } }],
    });
    expect(notes.join("\n")).toContain("ran once it was free: the observed reads of an import");

    release();
    await b.scheduler.idle();
    expect(importsWaiting(b.store, b.worktreeId)).toEqual([]);
    expect(b.runner.runs).toEqual([]);
    expect(importedPasses(b)).toBe(COUNT);
    expect(readStatus(dev)).toMatchObject({
      imports: [{ testFiles: COUNT, currentFiles: COUNT, notCurrent: NONE }],
    });
  });
});
