import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { type ObservedSeen, startTimers } from "../../src/core/daemon/lifecycle.js";
import { ModuleSets } from "../../src/core/keys/modules.js";
import { runtimeFilesStatus } from "../../src/core/status/runtime-files.js";
import { storePaths } from "../../src/core/store/index.js";
import { DEFAULT_POLICY, type Policy } from "../../src/core/types/index.js";
import { delay } from "../daemon/helpers.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";
import { idleAfterQuiet } from "./quiet-clock.js";
import { A, B, DATA, fixture, scoped } from "./runtime-files-fixture.js";

/** The daemon restarts these timers on policy reload and keeps their accepted snapshot. */
function observedTimers(h: Harness, commonDir: string) {
  const seen: ObservedSeen = {};
  let stop = () => {};
  let notices = 0;
  mkdirSync(storePaths(commonDir).locksDir, { recursive: true });
  return {
    count: () => notices,
    stop: () => stop(),
    restart(policy: Policy) {
      stop();
      stop = startTimers({
        root: h.root,
        worktreeId: h.worktreeId,
        commonDir,
        store: h.store,
        policy,
        now: Date.now,
        linkedDir: null,
        timings: { observedMs: 20, checkMs: 60_000, presenceMs: 60_000 },
        heartbeatMs: 60_000,
        presence: { since: Date.now(), lastPresentAt: null },
        lastActive: Date.now,
        active: () => {
          throw new Error("shared evidence is not activity");
        },
        observedSeen: seen,
        observedChanged: () => {
          notices += 1;
          return h.scheduler.refreshObserved();
        },
        note: () => {},
        log: () => {},
        shutdown: () => {
          throw new Error("no shutdown is due");
        },
      });
    },
  };
}

it(
  "refreshes an idle Vitest runtime reader from a shared module writer without another edit or local run",
  SLOW,
  async () => {
    const repo = fixture(false);
    const store = openRepoStore(repo.commonDir);
    const writer = new ModuleSets(openRepoStore(repo.commonDir));
    writeFileSync(
      join(repo.main, "squeal.config.json"),
      JSON.stringify({ runtimeFiles: scoped.runtimeFiles }),
    );
    const h = await openHarness(repo.main, store, repo.commonDir, {
      observe: true,
      policy: scoped,
    });
    await h.scheduler.start();
    await h.scheduler.idle();
    const timers = observedTimers(h, repo.commonDir);
    const before = [h.keyOf(A), h.keyOf(B)];
    const runs = [h.runsOf(A).length, h.runsOf(B).length];
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.runner.beforeRun = async () => {
      expect(timers.count()).toBeGreaterThan(0);
      await gate;
    };
    try {
      timers.restart(scoped);
      expect(h.scheduler.extraFiles()).not.toContain(DATA);
      writer.mark({ project: "", path: A }, [DATA]);
      writer.write();
      await expect.poll(() => timers.count(), { timeout: 2000 }).toBe(1);
      await expect.poll(() => h.keyOf(A), { timeout: 5000 }).not.toBe(before[0]);
      expect(h.keyOf(B)).toBe(before[1]);
      expect(h.scheduler.extraFiles()).toContain(DATA);
      expect(runtimeFilesStatus(store, h.worktreeId, h.root)).toMatchObject({
        pending: false,
        readers: expect.arrayContaining([
          expect.objectContaining({
            testFile: { project: "", path: A },
            paths: [],
            conflicts: [{ path: DATA, reason: "observed module load" }],
          }),
        ]),
      });
      writer.mark({ project: "unrelated", path: A }, [DATA]);
      writer.mark({ project: "", path: A }, [DATA]);
      writer.write();
      await delay(140);
      expect(timers.count()).toBe(1);
      expect(h.runsOf(B)).toHaveLength(runs[1] ?? 0);
    } finally {
      timers.stop();
      release();
    }
    await idleAfterQuiet(h);
  },
);

it(
  "enables and removes the shared-evidence timer with hot-reloaded runtime rules",
  SLOW,
  async () => {
    const repo = fixture(false);
    const store = openRepoStore(repo.commonDir);
    const writer = new ModuleSets(openRepoStore(repo.commonDir));
    const ordinary: Policy = { ...DEFAULT_POLICY, ...RUN_MISSING };
    let next = scoped;
    let timers: ReturnType<typeof observedTimers>;
    const h = await openHarness(repo.main, store, repo.commonDir, {
      observe: true,
      policy: ordinary,
      reloadPolicy: (changes) => {
        if (!changes.some((c) => c.path === "squeal.config.json")) return null;
        timers.restart(next);
        return next;
      },
    });
    timers = observedTimers(h, repo.commonDir);
    await h.scheduler.start();
    await h.scheduler.idle();
    timers.restart(ordinary);
    try {
      h.write("squeal.config.json", JSON.stringify({ runtimeFiles: scoped.runtimeFiles }));
      await h.batch("squeal.config.json");
      await idleAfterQuiet(h);
      await delay(140);
      const before = timers.count();
      const key = h.keyOf(A);
      const revision = h.scheduler.status().revision;
      writer.mark({ project: "", path: A }, [DATA]);
      writer.write();
      await expect.poll(() => timers.count(), { timeout: 2000 }).toBe(before + 1);
      await expect.poll(() => h.keyOf(A), { timeout: 5000 }).not.toBe(key);
      await idleAfterQuiet(h);
      expect(h.scheduler.status().revision).toBe(revision);
      expect(h.scheduler.extraFiles()).toContain(DATA);
      next = ordinary;
      h.write("squeal.config.json", "{}\n");
      await h.batch("squeal.config.json");
      await idleAfterQuiet(h);
      const removed = timers.count();
      writer.mark({ project: "", path: B }, [DATA]);
      writer.write();
      await delay(140);
      expect(timers.count()).toBe(removed);
    } finally {
      timers.stop();
    }
    expect(git(repo.main, ["status", "--short"]).includes(DATA)).toBe(false);
  },
);
