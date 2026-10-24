import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, onTestFinished } from "vitest";
import type { HostCpu } from "../../src/core/capacity/cores.js";
import { HOST_WINDOW_MIN_MS } from "../../src/core/capacity/index.js";
import { poolKind } from "../../src/core/scheduler/capacity.js";
import type { RunOptions, TestFileRef } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * 011 C10 Size as amended 2026-10-24 (row 011-182): a backlog tier's permits
 * compare the larger of the fresh marks' CPU and the host's busy cores with
 * the slots; a tier that runs an open checkpoint's files (`squeal run
 * --all`) keeps the marks' CPU alone. Here the host reads 23.9 busy cores
 * against 4 slots, as at 11:55Z on 2026-10-24 (`research/host-load/
 * 011-139.md` finding 3).
 */

describe("the pool's kind of a granted tier (row 011-182)", () => {
  const run = { checkpointId: "c" };
  const other = { checkpointId: null };

  it("is the backlog's unless an open run --all checkpoint requested a file of the tier", () => {
    expect(poolKind(null)).toBe("backlog");
    expect(poolKind(null, [run])).toBe("backlog");
    // A baseline checkpoint is no run --all: its tiers are the backlog's.
    expect(poolKind({ explicit: false }, [run])).toBe("backlog");
    expect(poolKind({ explicit: true })).toBe("checkpoint");
    expect(poolKind({ explicit: true }, [other, run])).toBe("checkpoint");
    expect(poolKind({ explicit: true }, [other])).toBe("backlog");
  });
});

describe("scheduler: a busy host and the backlog's grant (row 011-182)", SLOW, () => {
  it("runs a backlog tier on half the slots and a run --all tier on all of them", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "squeal-host-gate-")), "squeal-uid");
    onTestFinished(() => rmSync(join(dir, ".."), { recursive: true, force: true }));
    const host: HostCpu = { read: () => 23.9 };
    const repo = createRepo("basic");
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 4,
      backlogTierSize: 50,
      capacity: { dir, hostSlots: 4, host },
      policy: RUN_MISSING,
    });
    const runs: { files: readonly TestFileRef[]; options: RunOptions }[] = [];
    h.gate.before = (files, options) => {
      runs.push({ files, options });
    };
    await h.scheduler.start();
    await h.scheduler.idle();
    // The tree's first window: the gate reads the host again a second after the last read.
    await delay(HOST_WINDOW_MIN_MS + 100);

    runs.length = 0;
    appendFileSync(join(h.root, "vitest.config.ts"), "// environment change\n");
    await h.batch("vitest.config.ts");
    await h.scheduler.idle();
    expect(runs.length).toBeGreaterThan(0);
    // 23.9 busy cores against 4 slots: permits only while the grants are below 2.
    expect(Math.max(...runs.map((r) => r.options.workers ?? 0))).toBe(2);

    runs.length = 0;
    const checkpoint = await h.scheduler.requestFullSuite({ force: true });
    await h.scheduler.idle();
    expect(runs.length).toBeGreaterThan(0);
    expect(store.runs.get(runs[0]?.options.runId ?? "")?.checkpointId).toBe(checkpoint.id);
    expect(Math.max(...runs.map((r) => r.options.workers ?? 0))).toBe(4);
  });
});
