import { mkdirSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CandidateBatch } from "../../src/core/types/index.js";
import { type ChangeFeed, createChangeFeed } from "../../src/core/watcher/change-feed.js";
import { createWatcherBackend } from "../../src/core/watcher/index.js";
import { git, makeRepo } from "./helpers.js";

const MAX_LOAD_FOR_TIMING = 8;
const TRACKED = 10_000;
/** Review N2: the pass runs every 30 s when idle; a 10k-file worktree must stay well under that. */
const PASS_BUDGET_MS = 500;

describe("reconciliation pass", () => {
  let cleanup = () => {};
  let feed: ChangeFeed | null = null;
  afterEach(async () => {
    await feed?.close();
    cleanup();
  });

  it(`re-stats ${TRACKED.toLocaleString("en")} tracked paths within the budget`, async (ctx) => {
    const repo = makeRepo();
    cleanup = repo.cleanup;
    const tracked: string[] = [];
    for (let d = 0; d < TRACKED / 100; d++) {
      mkdirSync(join(repo.root, "src", `d${d}`), { recursive: true });
      for (let f = 0; f < 100; f++) {
        const path = `src/d${d}/f${f}.ts`;
        writeFileSync(join(repo.root, path), `export const v = ${f};\n`);
        tracked.push(path);
      }
    }
    git(repo.root, "add", ".");
    git(repo.root, "commit", "-q", "-m", "synthetic tracked paths");

    const batches: CandidateBatch[] = [];
    const errors: Error[] = [];
    feed = createChangeFeed({
      root: repo.root,
      backend: createWatcherBackend("linux"),
      onBatch: (batch) => {
        batches.push(batch);
      },
      onError: (error) => errors.push(error),
      trackedPaths: () => tracked,
      timings: { reconcileIntervalMs: 60_000 },
    });
    await feed.start();

    const timings: number[] = [];
    for (let i = 0; i < 3; i++) {
      const started = performance.now();
      await feed.reconcile("interval");
      timings.push(Math.round(performance.now() - started));
    }
    expect(errors).toEqual([]);
    const last = batches.at(-1);
    expect(last?.trigger).toBe("interval");
    expect(last?.paths).toHaveLength(TRACKED);
    expect(last?.paths.every((p) => p.stat !== null)).toBe(true);

    const best = Math.min(...timings);
    const load = loadavg()[0] ?? 0;
    console.log(
      `reconciliation pass over ${TRACKED} tracked paths: ${timings.join(", ")} ms (best ${best} ms), load average ${load.toFixed(1)}`,
    );
    if (load > MAX_LOAD_FOR_TIMING) {
      ctx.skip(`load average ${load.toFixed(1)} > ${MAX_LOAD_FOR_TIMING}; measured ${best} ms`);
    }
    expect(best).toBeLessThan(PASS_BUDGET_MS);
  }, 60_000);
});
