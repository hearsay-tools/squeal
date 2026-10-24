import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkpointMetaKey } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { waitFor } from "../watcher/helpers.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Row 011-118 (`research/edit-latency.md` 3, E8; 011 C4 Explicit
 * checkpoints): a checkpoint completes when every requested file got a
 * result, from a run or a lookup. A `run --all` while a file runs on an
 * editor swap file's key, then the swap file removed: the file's key is
 * back at the one its results stand under, so it is current with nothing
 * to run, and the checkpoint completes there, not when a later run ends.
 */
const LISTS = "test/lists.test.ts";
const SWAP = "tree/.a.txt.swp";
/** Observed inputs on, whatever the policy default (task 001-134). */
const OBSERVING = { observe: true, policy: { observe: { runtimeInputs: true } } } as const;

const LISTS_TEST = `import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

test("lists tree", () => {
  expect(readdirSync(join(import.meta.dirname, "..", "tree")).length).toBeGreaterThan(0);
});
`;

describe("scheduler: a checkpoint counts a file current by lookup (row 011-118)", SLOW, () => {
  it("completes at the lookup when a swap file's key goes back to the stored one", async () => {
    const repo = createRepo();
    writeFileSync(join(repo.main, LISTS), LISTS_TEST);
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      ...OBSERVING,
      policy: { ...OBSERVING.policy, ...RUN_MISSING },
    });
    h.write("tree/a.txt", "a\n");
    await h.scheduler.start();
    await h.scheduler.idle();
    const stored = h.keyOf(LISTS);
    expect(store.testFiles.get({ project: "", path: LISTS })?.closure.paths).toContain("tree/");

    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = false;
    h.gate.before = async (files) => {
      if (!files.some((f) => f.path === LISTS)) return;
      started = true;
      await held;
    };
    let checkpoint: string | null = null;
    // A failed expectation releases the run too, or the cleanup waits for it.
    try {
      // Vim opens: the swap file re-keys the file, and its run is held.
      h.write(SWAP, "swap\n");
      await h.batch(SWAP);
      await waitFor(() => started, 30_000);
      expect(h.keyOf(LISTS)).not.toBe(stored);

      const requested = await h.scheduler.requestFullSuite();
      checkpoint = requested.id;
      expect(requested.testFiles.map((f) => f.path)).toEqual([LISTS]);
      expect(store.checkpoints.get(checkpoint)?.end).toBeNull();

      // Vim quits: the stored key again, current by lookup, and the checkpoint completes.
      h.remove(SWAP);
      await h.batch(SWAP);
      expect(h.keyOf(LISTS)).toBe(stored);
      expect(store.checkpoints.get(checkpoint)?.end).toBe("completed");
      // Status shows no checkpoint in progress.
      expect(store.meta.get(checkpointMetaKey(h.worktreeId))).toBe("");
    } finally {
      release();
    }
    await h.scheduler.idle();
    expect(store.checkpoints.get(checkpoint)?.end).toBe("completed");
    expect(h.keyOf(LISTS)).toBe(stored);
    expect(h.header()).toMatchObject({ counts: { pending: 0, stale: 0, unknown: 0 } });
  });
});
