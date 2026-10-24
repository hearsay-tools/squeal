import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { heldSlowLeft, pendingSlow } from "../../src/cli/status-wait-slow.js";
import { testFileId } from "../../src/core/keys/index.js";
import { DEFAULT_POLICY, type WorktreeId } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { waitFor } from "../watcher/helpers.js";
import { createRepo, openHarness, openRepoStore, ref, SLOW } from "./helpers.js";

/*
 * Spec 004 D8 as amended 2026-10-19 (row 004-83): `squeal run --slow --wait`
 * waits for every slow file not current at the current revision, and joins a
 * slow file already running there rather than restarting it. The request
 * counts the running file as its own, so the CLI's wait holds for it
 * (`run-slow.ts` holds only when the request queued some), and the wait's
 * first read names it until its one run has a result.
 */

const STRINGS = "test/strings.test.ts";

const slotDirs: string[] = [];
afterEach(() => {
  for (const dir of slotDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("run --slow joins a slow file already running (row 004-83)", SLOW, () => {
  it("counts it, holds the wait for it and returns its one run's result", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const slotDir = mkdtempSync(join(tmpdir(), "squeal-004-83-slot-"));
    slotDirs.push(slotDir);
    const slow = { ...DEFAULT_POLICY.slow, include: [STRINGS], quietMs: 50 };
    // The wait reads the policy from the worktree, as the CLI does.
    writeFileSync(join(repo.main, "squeal.config.json"), JSON.stringify({ slow }));
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 4,
      policy: { ...RUN_MISSING, slow },
      slow: { slotDir, recheckMs: 25, load: () => [0], cpus: () => 1 },
    });
    let started = false;
    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.gate.before = async (files) => {
      if (!files.some((f) => f.path === STRINGS)) return;
      started = true;
      await released;
    };
    // The wait finds the worktree's root, and its policy, in the store, as a daemon registers it.
    store.worktrees.upsert({
      id: h.worktreeId as WorktreeId,
      root: repo.main,
      commonDir: repo.commonDir,
      isMain: true,
      registeredAt: 1,
      daemon: null,
    });
    await h.scheduler.start();
    // The continuous trigger starts the slow file once the fast lane is quiet.
    await waitFor(() => started, 60_000);

    const id = h.worktreeId as WorktreeId;
    const read = () => ({
      states: store.knownStates.list(id),
      keys: store.testFileKeys.list(id),
    });
    let held: ReturnType<typeof pendingSlow>;
    try {
      const requested = await h.scheduler.requestSlowSuite();
      expect(requested.queued).toBe(1);
      const first = read();
      held = pendingSlow(store, id, first.states, first.keys);
      expect([...held.keys()]).toEqual([testFileId(ref(STRINGS))]);
      expect(heldSlowLeft(held, first.states, first.keys)).toEqual([STRINGS]);
    } finally {
      release();
    }
    await waitFor(() => {
      const now = read();
      return heldSlowLeft(held, now.states, now.keys).length === 0;
    }, 60_000);
    await h.scheduler.idle();

    expect(h.runsOf(STRINGS)).toHaveLength(1);
    const checks = read().states.filter(
      (s) => s.check.kind === "test" && s.check.testPath === STRINGS,
    );
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every((s) => s.validity === "current")).toBe(true);
  });
});
