import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import type { GcFunction } from "../../src/core/daemon/idle-gc.js";
import { readHeader } from "../../src/core/delivery/index.js";
import { acquireSlowSlot, slowSlotDir } from "../../src/core/slow/index.js";
import { createFixtureRepo, delay, type FixtureRepo, SLOW, waitFor, withStore } from "./helpers.js";

/*
 * Row 011-69 (spec 011 C9), against a real daemon with a test clock and a
 * recording `gc`: every tier is a run of the daemon's runner, its check loop
 * asks for the GC, and its start scan's end starts the quiet. A slow file
 * waits for the slow lane's one permit, which the test holds, as the 7 quiet
 * daemons of 011-52 waited on the slow lane: work queued, no tier, idle.
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

describe("a daemon runs one last-resort GC once idle (row 011-69)", SLOW, () => {
  it("collects 60 s after its last tier with a slow file queued, and again only after a tier", async () => {
    const repo = createFixtureRepo({
      files: {
        "squeal.config.json": `${JSON.stringify({
          slow: { include: ["test/slow-*.test.ts"], maxParallel: 1, maxLoadPerCpu: 1000 },
        })}\n`,
        [SLOW_FILE]: `import { expect, it } from "vitest";\nit("waits", () => expect(1).toBe(1));\n`,
      },
    });
    onTestFinished(repo.cleanup);
    const slot = acquireSlowSlot({
      dir: slowSlotDir(repo.env),
      owner: { pid: process.pid, worktreeId: "0123456789abcdef" },
    });
    expect(slot).not.toBeNull();
    onTestFinished(() => slot?.release());
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
    onTestFinished(async () => {
      await daemon.stop("stop-requested");
    });
    await daemon.ready;
    await waitFor(
      () => withStore(repo, (store) => readHeader(store, repo.worktreeId).counts.current >= 5),
      60_000,
      "the fast baseline",
    );
    await delay(300);
    expect(gc).not.toHaveBeenCalled();

    offset += 61_000;
    await waitFor(() => gc.mock.calls.length > 0, 10_000, "the idle GC");
    expect(gc.mock.calls).toEqual([[LAST_RESORT]]);
    expect(lines.filter((line) => line.includes("last-resort GC"))).toEqual([
      expect.stringMatching(/^no tier for 60 s: a last-resort GC took .* MiB in a \d+ ms pause$/),
    ]);
    expect(outcome(repo, SLOW_FILE)).toBeUndefined();
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
