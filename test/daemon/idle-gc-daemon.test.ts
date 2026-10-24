import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { type RunningDaemon, startDaemon } from "../../src/core/daemon/daemon.js";
import type { GcFunction } from "../../src/core/daemon/idle-gc.js";
import { readHeader } from "../../src/core/delivery/index.js";
import { acquireSlowSlot, slowSlotDir } from "../../src/core/slow/index.js";
import { runMissingConfig } from "../helpers/baseline.js";
import { createFixtureRepo, delay, type FixtureRepo, SLOW, waitFor, withStore } from "./helpers.js";

/*
 * Row 011-69 (spec 011 C9), against a real daemon with a test clock and a
 * recording `gc`: every tier is a run of the daemon's runner, its check loop
 * asks for the GC, and its start scan's end starts the quiet. A slow file
 * waits for the slow lane's one permit, which the test holds, as the 7 quiet
 * daemons of 011-52 waited on the slow lane: work queued, no tier, idle.
 *
 * The slow lane takes its permit in `slowSlotDir()` of the daemon's process,
 * which is this test's, not in that of the daemon's `env`. So the test points
 * its own runtime dir at the repository's: else the daemon would use the
 * host's real slot, which live daemons hold on a busy host and none on CI.
 */

const LAST_RESORT = { type: "major", execution: "sync", flavor: "last-resort" };
const SLOW_FILE = "test/slow-wait.test.ts";

const outcome = (repo: FixtureRepo, path: string) =>
  withStore(
    repo,
    (store) =>
      store.knownStates
        .list(repo.worktreeId)
        .find((s) => s.check.kind === "test" && s.check.testPath === path)?.outcome,
  );

/** The worktrees with a slot waiter's mark in `dir` (`markSlotWaiter` writes the id). */
function waiters(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.startsWith("slow.wait."))
    .map((name) => {
      try {
        return readFileSync(join(dir, name), "utf8").trim();
      } catch {
        return ""; // Another daemon's mark, gone since the listing.
      }
    });
}

describe("a daemon runs one last-resort GC once idle (row 011-69)", SLOW, () => {
  it("collects 60 s after its last tier with a slow file queued, and again only after a tier", async () => {
    const repo = createFixtureRepo({
      files: {
        "squeal.config.json": runMissingConfig(
          JSON.stringify({
            slow: { include: ["test/slow-*.test.ts"], maxParallel: 1, maxLoadPerCpu: 1000 },
          }),
        ),
        [SLOW_FILE]: `import { expect, it } from "vitest";\nit("waits", () => expect(1).toBe(1));\n`,
      },
    });
    onTestFinished(repo.cleanup);
    const hostSlotDir = slowSlotDir();
    vi.stubEnv("XDG_RUNTIME_DIR", repo.runtimeDir);
    const slotDir = slowSlotDir();
    expect(slotDir).toBe(slowSlotDir(repo.env));
    expect(slotDir).not.toBe(hostSlotDir);
    const slot = acquireSlowSlot({
      dir: slotDir,
      owner: { pid: process.pid, worktreeId: "0123456789abcdef" },
    });
    expect(slot).not.toBeNull();
    let running: RunningDaemon | null = null;
    // The env goes back only once the daemon stopped: its slow tier clears its mark at close.
    onTestFinished(async () => {
      await running?.stop("stop-requested");
      slot?.release();
      vi.unstubAllEnvs();
    });
    let offset = 0;
    const gc = vi.fn<GcFunction>();
    const lines: string[] = [];
    const daemon = await startDaemon({
      root: repo.root,
      env: repo.env,
      now: () => Date.now() + offset,
      log: (line) => lines.push(line),
      gc: () => gc,
      timings: { checkMs: 50 },
    });
    if ("reason" in daemon) throw new Error(daemon.message);
    running = daemon;
    await daemon.ready;
    // Quiet for 2 s: the five files current, only the slow file queued, no run
    // open. Under load a later tier (a first observation's re-run) would
    // otherwise start the quiet again after the clock moved.
    let quietAt = 0;
    await waitFor(
      () =>
        withStore(repo, (store) => {
          const { counts } = readHeader(store, repo.worktreeId);
          const quiet =
            counts.current >= 5 &&
            counts.pending <= 1 &&
            store.runs.inFlight(repo.worktreeId, 0).length === 0;
          if (!quiet) quietAt = 0;
          else if (quietAt === 0) quietAt = Date.now();
          return quiet && Date.now() - quietAt >= 2_000;
        }),
      60_000,
      "the fast baseline, then 2 s quiet",
    );
    // The slow file waits at the permit the test holds, before the clock moves.
    await waitFor(() => waiters(slotDir).includes(repo.worktreeId), 30_000, "the slot waiter");
    await delay(300);
    expect(gc).not.toHaveBeenCalled();

    // Under load a later tier (a first observation's re-run) may still run, or
    // end after the clock moved and start the quiet again: move it until it held.
    await waitFor(
      async () => {
        offset += 61_000;
        await delay(200);
        return gc.mock.calls.length > 0;
      },
      60_000,
      "the idle GC",
    );
    expect(gc.mock.calls).toEqual([[LAST_RESORT]]);
    expect(lines.filter((line) => line.includes("last-resort GC"))).toEqual([
      expect.stringMatching(/^no tier for 60 s: a last-resort GC took .* MiB in a \d+ ms pause$/),
    ]);
    expect(outcome(repo, SLOW_FILE)).toBeUndefined();
    expect(waiters(slotDir)).toContain(repo.worktreeId);
    offset += 61_000;
    await delay(500);
    expect(gc).toHaveBeenCalledTimes(1);

    // An edit's tier ends: 60 s on, one more.
    appendFileSync(join(repo.root, "src/math.ts"), "\nexport const edited = 1;\n");
    await waitFor(
      async () => {
        offset += 61_000;
        await delay(200);
        return gc.mock.calls.length > 1;
      },
      60_000,
      "the idle GC after the edit's tier",
    );
    await delay(500);
    expect(gc).toHaveBeenCalledTimes(2);
    expect(outcome(repo, SLOW_FILE)).toBeUndefined();
  });
});
