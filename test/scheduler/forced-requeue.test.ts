import { lstatSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CandidateBatch, RelativePath } from "../../src/core/types/index.js";
import { waitFor } from "../watcher/helpers.js";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Row 011-120 (`tasks/011-118/notes.md` 2; 011 C4 step 5; 001-171 S1: "a
 * file whose key moves before its re-run runs drops it"). A revision that
 * cancels a forced run queues its file again forced only while what forced
 * it still holds: the file is at the key the tier ran it at, or a strict
 * `run --all --force` checkpoint still holds it. Otherwise it is queued as
 * any miss, looked up at each later key, and current when one has a result.
 */
const LISTS = "test/lists.test.ts";
const LISTED = { kind: "test", project: "", testPath: LISTS, fullName: "lists tree" } as const;
const A = "tree/a.txt";
const BROKEN = "tree/broken";
/** Observed inputs on, whatever the policy default (task 001-134). */
const OBSERVING = { observe: true, policy: { observe: { runtimeInputs: true } } } as const;

const LISTS_TEST = `import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const tree = join(import.meta.dirname, "..", "tree");

test("lists tree", () => {
  expect(readFileSync(join(tree, "a.txt"), "utf8")).not.toBe("");
  expect(readdirSync(tree)).not.toContain("broken");
});
`;

/** Row 011-118's repository: one test that reads `tree/a.txt` and lists `tree/`, its pass stored. */
async function listing(): Promise<{ h: Harness; stored: string | null }> {
  const repo = createRepo();
  writeFileSync(join(repo.main, LISTS), LISTS_TEST);
  const store = openRepoStore(repo.commonDir);
  const h = await openHarness(repo.main, store, repo.commonDir, OBSERVING);
  h.write(A, "a\n");
  await h.scheduler.start();
  await h.scheduler.idle();
  return { h, stored: h.keyOf(LISTS) };
}

/** The phase of `path`'s row: `queued`, `running`, or none. */
const phaseOf = (h: Harness, path: string) =>
  h.store.testFileKeys.list(h.worktreeId).find((r) => r.testFile.path === path)?.pending;

/**
 * A watch batch of `paths` as they are on disk, stat'ed as the fs hasher
 * does but at once: handed to the scheduler, it reaches its lock before any
 * other task asks for it.
 */
function statNow(h: Harness, ...paths: string[]): CandidateBatch {
  const stat = (path: string) => {
    const stats = lstatSync(join(h.root, path), { throwIfNoEntry: false });
    if (stats === undefined) return null;
    return { mtimeMs: stats.mtimeMs, ctimeMs: stats.ctimeMs, size: stats.size, inode: stats.ino };
  };
  const sorted = [...paths].sort();
  return {
    trigger: "watch",
    paths: sorted.map((path) => ({ path: path as RelativePath, stat: stat(path) })),
  };
}

describe("a cancelled forced run, queued again (row 011-120)", SLOW, () => {
  it("drops a re-run cancelled by a revision: after the revert the file is current, nothing runs", async () => {
    const { h, stored } = await listing();
    const before = h.runsOf(LISTS).length;

    // Its re-run (task 001-171) is the second run after the edit; the gate holds it.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let rerun: string | null = null;
    let cancel: AbortSignal | undefined;
    h.gate.before = async (files, options) => {
      if (!files.some((f) => f.path === LISTS)) return;
      if (h.runsOf(LISTS).length === before) return;
      rerun ??= options.runId;
      if (options.runId !== rerun) return;
      cancel = options.signal;
      await held;
    };
    // The revert reaches the lock right behind the cancelled re-run's record, before the next tier.
    let revert: Promise<void> | null = null;
    const finish = h.store.runs.finish.bind(h.store.runs);
    vi.spyOn(h.store.runs, "finish").mockImplementation((id, end, at) => {
      finish(id, end, at);
      if (id !== rerun || revert !== null) return;
      h.write(A, "a\n");
      h.remove(BROKEN);
      revert = h.scheduler.handleBatch(statNow(h, A, BROKEN));
    });
    try {
      // Edit 1 fails: its failure is delivered, and its re-run queued forced starts.
      h.write(BROKEN, "x\n");
      await h.batch(BROKEN);
      await waitFor(() => rerun !== null, 60_000);
      const failed = h.keyOf(LISTS);
      expect(failed).not.toBe(stored);
      expect(h.sink.stateOf(LISTED)).toMatchObject({ outcome: "fail", validity: "current" });

      // Edit 2 moves the key of the re-run's only file, which ends the re-run and cancels its tier.
      h.write(A, "b\n");
      await h.batch(A);
      expect(h.keyOf(LISTS)).not.toBe(failed);
      await waitFor(() => cancel?.aborted === true, 60_000);
    } finally {
      release();
    }
    await waitFor(() => revert !== null, 60_000);
    await revert;

    // Back at the stored pass: current by lookup, with nothing pending.
    expect(h.keyOf(LISTS)).toBe(stored);
    expect(phaseOf(h, LISTS)).toBeNull();
    expect(h.sink.stateOf(LISTED)).toMatchObject({ outcome: "pass", validity: "current" });
    expect(h.header()).toMatchObject({ counts: { pending: 0, stale: 0, unknown: 0 } });

    // `run --all` requests nothing and completes at once.
    const checkpoint = await h.scheduler.requestFullSuite();
    expect(checkpoint.testFiles).toEqual([]);
    expect(h.store.checkpoints.get(checkpoint.id)?.end).toBe("completed");

    // No further run of the file starts: only the edit's run and its cancelled re-run.
    await h.scheduler.idle();
    expect(h.runsOf(LISTS).slice(before)).toHaveLength(2);
    expect(h.keyOf(LISTS)).toBe(stored);
  });
});
