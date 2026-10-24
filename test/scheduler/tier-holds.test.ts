import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, onTestFinished } from "vitest";
import { createPermitPool, poolPermitFile, readMarks } from "../../src/core/capacity/index.js";
import { CAPACITY_RECHECK_MS } from "../../src/core/scheduler/capacity.js";
import { takePermit } from "../../src/core/slow/index.js";
import type { RunOptions, TestFileRef } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * 011 C10 as amended 2026-10-21 (design 011-83 Q2 (a), row 011-97): a tier
 * holds only what it runs. It returns a permit each time its files that have
 * not ended are fewer than the permits it holds, and a Vitest project with
 * `isolate: false`, which runs 2 workers at a grant of 1, asks for 2 permits
 * and waits for 2. The `basic` fixture has five test files.
 */

function poolDir(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "squeal-tier-holds-")), "squeal-uid");
  onTestFinished(() => rmSync(join(dir, ".."), { recursive: true, force: true }));
  return dir;
}

/** How many of the pool's `slots` permits nothing holds. */
function freePermits(dir: string, slots: number): number {
  let free = 0;
  for (let i = 0; i < slots; i++) {
    const db = takePermit(join(dir, poolPermitFile(i)), { pid: process.pid, worktreeId: "probe" });
    db?.close();
    if (db !== null) free++;
  }
  return free;
}

function markOf(dir: string, id: string): { want: number; grant: number } | undefined {
  const mark = readMarks(dir, "reader", Date.now()).find((m) => m.id === id);
  return mark === undefined ? undefined : { want: mark.want, grant: mark.grant };
}

describe("a tier holds only the permits it runs (row 011-97)", SLOW, () => {
  it("returns a permit when its first file ends, and its mark says what it still holds", async () => {
    const dir = poolDir();
    const repo = createRepo("basic");
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 3,
      backlogTierSize: 3,
      capacity: { dir, hostSlots: 3 },
      policy: RUN_MISSING,
    });
    const seen: unknown[] = [];
    h.gate.before = (files, options) => {
      if (seen.length > 0) return;
      const first = files[0];
      if (files.length !== 3 || first === undefined) throw new Error("expected a tier of 3");
      const held = () => ({ free: freePermits(dir, 3), mark: markOf(dir, h.worktreeId) });
      const before = { workers: options.workers, ...held() };
      options.fileEnded?.(first);
      seen.push({ before, after: held() });
      // The same end again returns nothing more.
      options.fileEnded?.(first);
      seen.push(held());
    };
    await h.scheduler.start();
    await h.scheduler.idle();
    expect(seen).toEqual([
      {
        before: { workers: 3, free: 0, mark: { want: 3, grant: 3 } },
        after: { free: 1, mark: { want: 2, grant: 2 } },
      },
      { free: 1, mark: { want: 2, grant: 2 } },
    ]);
  });

  it("waits for 2 permits for an isolate: false project, and runs at 2 once they are free", async () => {
    const dir = poolDir();
    const repo = createRepo("basic");
    // One worker would take every file of a project that does not isolate them.
    writeFileSync(
      join(repo.main, "vitest.config.ts"),
      `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"], testTimeout: 60_000, isolate: false } });\n`,
    );
    // Another daemon of the user holds 2 of the 3 permits, so one is free.
    const other = createPermitPool({
      dir,
      owner: { pid: process.pid, worktreeId: "other-daemon" },
      hostSlots: 3,
    });
    onTestFinished(() => other.close());
    const held = other.acquire(2);
    expect(held?.permits).toBe(2);
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 4,
      backlogTierSize: 50,
      capacity: { dir, hostSlots: 3 },
      policy: RUN_MISSING,
    });
    // The harness's runner reports no widths: these are the Vitest adapter's for such a project
    // (`width.test.ts`), 2 workers at a grant of 1.
    h.runner.tierWidth = (_file, grant) => Math.max(2, grant);
    const runs: { files: readonly TestFileRef[]; options: RunOptions }[] = [];
    h.gate.before = (files, options) => {
      runs.push({ files, options });
    };
    await h.scheduler.start();
    const own = () => readMarks(dir, "reader", Date.now()).find((m) => m.id === h.worktreeId);
    await expect.poll(() => own()?.since ?? null, { timeout: 30_000 }).not.toBeNull();
    await delay(CAPACITY_RECHECK_MS + 500);
    // The one free permit would run 2 workers: the tier waits, marked, asking for at least 2.
    expect(runs).toEqual([]);
    expect(own()?.grant).toBe(0);
    expect(own()?.least).toBe(2);
    expect(freePermits(dir, 3)).toBe(1);

    held?.release();
    await expect.poll(() => runs.length, { timeout: 30_000 }).toBeGreaterThan(0);
    await h.scheduler.idle();
    for (const run of runs) expect(run.options.workers ?? 0).toBeGreaterThanOrEqual(2);
  });
});
