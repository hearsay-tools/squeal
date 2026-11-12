import { realpathSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importsWaiting } from "../../src/core/scheduler/imports-waiting.js";
import { importLines } from "../../src/core/status/import-lines.js";
import { readStatus } from "../../src/core/status/snapshot.js";
import type { StatusSnapshot } from "../../src/core/types/status.js";
import { COUNT, daemonOf, importedPasses, publishedRun } from "./daemon-kit.js";
import { readerOf, scratch } from "./reader-kit.js";
import { cloneOf } from "./remote.js";

/*
 * Row 018-28 (`research/shared-proof.md` Q2): the reader imports into a
 * running daemon's store after the daemon keyed its files. The observed
 * entries the import adds must key them in the same pass, as a restart's
 * keying would: every exported file is then current from the import, with
 * no restart and no run. Before the fix, a fresh clone had 31 of 1,449 files
 * current at the first start (those without observed entries) and 1,449
 * after a restart. Until the keys take the import, status names that cause,
 * not "content differs" (review of 0.1.428, B1).
 */

const SLOW = { timeout: 60_000 } as const;
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
 * A CI run's export published for its commit, and a fresh clone whose
 * daemon keyed every file before the reader imports.
 */
async function publishedAndCloned() {
  const s = scratch();
  const commit = await publishedRun(s);
  const dev = realpathSync(cloneOf(s, "main"));
  const { d: b, retry } = await daemonOf(dev);
  expect(b.passing()).toBe(0);
  return { commit, dev, b, retry };
}

describe("an import into a running daemon (row 018-28)", SLOW, () => {
  it("re-keys the files whose observed entries it added: every exported file current at the first start", async () => {
    const { commit, dev, b, retry } = await publishedAndCloned();
    const reader = readerOf(dev, { store: b.store, imported: () => void retry() });
    await reader.run();
    expect(reader.commits()).toEqual([commit]);
    expect(reader.notes).toEqual([]);
    await b.scheduler.idle();

    expect(b.runner.runs).toEqual([]);
    expect(importedPasses(b)).toBe(COUNT);
    expect(readStatus(dev)).toMatchObject({
      imports: [
        { testFiles: COUNT, currentFiles: COUNT, currentResults: 2 * COUNT, notCurrent: NONE },
      ],
    });
  });

  it("names the keys it waits for, not a content difference, until they take the import", async () => {
    const { dev, b, retry } = await publishedAndCloned();
    // The runner's next invalidation, the re-key's refinement, waits.
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
    const reader = readerOf(dev, { store: b.store, imported: () => void retry() });
    await reader.run();

    const waiting = readStatus(dev) as StatusSnapshot;
    expect(waiting).toMatchObject({
      imports: [{ testFiles: COUNT, currentFiles: 0, notCurrent: { ...NONE, keysPending: COUNT } }],
    });
    expect(importLines(waiting)[1]).toBe(
      `  Not current: ${COUNT} waiting for keys after the import`,
    );
    expect(importsWaiting(b.store, b.worktreeId)).toHaveLength(1);

    release();
    await b.scheduler.idle();
    expect(importsWaiting(b.store, b.worktreeId)).toEqual([]);
    expect(b.runner.runs).toEqual([]);
    expect(readStatus(dev)).toMatchObject({
      imports: [{ testFiles: COUNT, currentFiles: COUNT, notCurrent: NONE }],
    });
  });
});
