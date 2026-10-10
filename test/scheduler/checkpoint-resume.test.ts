import { describe, expect, it } from "vitest";
import type { CheckpointRecord } from "../../src/core/types/index.js";
import { ALL_TEST_FILES, createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

const ran = (runs: readonly { files: readonly { path: string }[] }[]) =>
  runs.flatMap((run) => run.files.map((file) => file.path)).sort();

describe(
  "scheduler: a run --all joins, and outlives its daemon (tasks 001-217, 001-219)",
  SLOW,
  () => {
    it("a run --all during the baseline joins it: neither is abandoned, no file runs twice", async () => {
      const repo = createRepo();
      const store = openRepoStore(repo.commonDir);
      const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 2 });
      let request: CheckpointRecord | null = null;
      h.runner.beforeRun = async () => {
        if (request !== null) return;
        h.runner.beforeRun = null;
        request = await h.scheduler.requestFullSuite();
      };
      await h.scheduler.start();
      await h.scheduler.idle();

      const baseline = store.runs.get(h.runner.runs[0]?.options.runId ?? "")?.checkpointId ?? "";
      expect(store.checkpoints.get(baseline)).toMatchObject({ kind: "baseline", end: "completed" });
      expect(request).toMatchObject({ kind: "run-all" });
      expect(store.checkpoints.get(request?.id ?? "")?.end).toBe("completed");
      expect(request?.testFiles.length).toBeGreaterThan(0);
      expect(ran(h.runner.runs)).toEqual(ALL_TEST_FILES);
    });

    it("a forced run --all whose daemon stops mid-way completes in the next daemon, each file once", async () => {
      const repo = createRepo();
      const store = openRepoStore(repo.commonDir);
      const first = await openHarness(repo.main, store, repo.commonDir, { tierSize: 2 });
      await first.scheduler.start();
      await first.scheduler.idle();
      const baselineRuns = first.runner.runs.length;
      let closing: Promise<void> | null = null;
      first.runner.beforeRun = () => {
        // The session ends while the second forced tier runs.
        if (first.runner.runs.length === baselineRuns + 1) closing = first.scheduler.close();
      };
      const checkpoint = await first.scheduler.requestFullSuite({ force: true });
      await first.scheduler.idle();
      await closing;
      const forcedFirst = ran(first.runner.runs.slice(baselineRuns));
      expect(forcedFirst).toHaveLength(4);
      expect(store.checkpoints.get(checkpoint.id)?.end).toBeNull();

      const second = await openHarness(repo.main, store, repo.commonDir, { tierSize: 2 });
      await second.scheduler.start();
      await second.scheduler.idle();

      // Only the file the first daemon never ran, forced: every key had a result.
      const rest = ALL_TEST_FILES.filter((path) => !forcedFirst.includes(path));
      expect(ran(second.runner.runs)).toEqual(rest);
      for (const run of second.runner.runs) {
        expect(store.runs.get(run.options.runId)?.checkpointId).toBe(checkpoint.id);
      }
      expect(store.checkpoints.get(checkpoint.id)?.end).toBe("completed");
    });

    it("an owed run --all ends with the next daemon's baseline, which runs what it left", async () => {
      const repo = createRepo();
      const store = openRepoStore(repo.commonDir);
      const first = await openHarness(repo.main, store, repo.commonDir, {
        tierSize: 2,
        policy: { baseline: { onStart: "lookup-only" } },
      });
      await first.scheduler.start();
      await first.scheduler.idle();
      let closing: Promise<void> | null = null;
      first.runner.beforeRun = () => {
        if (first.runner.runs.length === 1) closing = first.scheduler.close();
      };
      const checkpoint = await first.scheduler.requestFullSuite();
      await first.scheduler.idle();
      await closing;
      const before = ran(first.runner.runs);
      expect(before).toHaveLength(4);

      const second = await openHarness(repo.main, store, repo.commonDir, { tierSize: 2 });
      await second.scheduler.start();
      await second.scheduler.idle();

      expect(ran(second.runner.runs)).toEqual(ALL_TEST_FILES.filter((p) => !before.includes(p)));
      const baseline = store.runs.get(second.runner.runs[0]?.options.runId ?? "")?.checkpointId;
      expect(store.checkpoints.get(baseline ?? "")).toMatchObject({
        kind: "baseline",
        end: "completed",
      });
      expect(store.checkpoints.get(checkpoint.id)?.end).toBe("completed");
    });
  },
);
