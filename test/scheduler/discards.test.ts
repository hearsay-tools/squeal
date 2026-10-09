import { describe, expect, it } from "vitest";
import type { Delta, TestCheckId } from "../../src/core/types/index.js";
import { waitFor } from "../watcher/helpers.js";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";

const adds: TestCheckId = {
  kind: "test",
  project: "",
  testPath: "test/math.test.ts",
  fullName: "adds",
};

const revisionOf = (h: Harness) => h.store.revisions.latest(h.worktreeId)?.number ?? 0;

describe("scheduler: discards and timeouts (S5, S10)", SLOW, () => {
  it("three edits during three runs deliver nothing spurious", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 1 });
    await h.scheduler.start();
    await h.scheduler.idle();
    const { delivery, consumer } = await h.consumer();
    const baselineRuns = h.runsOf("test/math.test.ts").length;

    const deltas: (Delta | null)[] = [];
    const batches: Promise<void>[] = [];
    h.runner.beforeRun = async (files) => {
      if (files[0]?.path !== "test/math.test.ts") return;
      deltas.push(await delivery.onToolBoundary(consumer));
      if (batches.length >= 3) return;
      // The agent saves the file under test while it runs; the watcher reports it.
      const n = batches.length;
      h.write("src/math.ts", `export const add = (a: number, b: number) => a + b + ${n} - ${n};\n`);
      const target = revisionOf(h) + 1;
      batches.push(h.batch("src/math.ts"));
      await waitFor(() => revisionOf(h) >= target, 10_000);
    };
    h.write("src/math.ts", "export const add = (a: number, b: number) => b + a;\n");
    await h.batch("src/math.ts");
    await h.scheduler.idle();
    await Promise.all(batches);
    await h.scheduler.idle();

    const runs = h.runsOf("test/math.test.ts").slice(baselineRuns);
    expect(runs).toHaveLength(4);
    // Three were discarded: the store kept a result of `adds` from the last run only.
    const kept = new Set(store.results.listForCheck(adds, 10).map((r) => r.provenance.runId));
    expect(runs.map((run) => kept.has(run.options.runId))).toEqual([false, false, false, true]);
    expect(h.sink.callsOf("markUnknown")).toEqual([]);
    expect(store.transitions.history(h.worktreeId, adds).map((t) => t.kind)).not.toContain(
      "to-unknown",
    );
    expect(deltas.every((d) => d === null || d.entries.every((e) => e.kind !== "to-unknown"))).toBe(
      true,
    );
  });

  it("a hung run times out and the next batch is handled", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 1,
      timeoutMs: 2_000,
    });
    await h.scheduler.start();
    await h.scheduler.idle();

    h.write(
      "test/hang.test.ts",
      'import { it } from "vitest";\nit("hangs", () => {\n  while (true) {}\n});\n',
    );
    await h.batch("test/hang.test.ts");
    await h.scheduler.idle();
    expect(h.runsOf("test/hang.test.ts").map((r) => r.report.end)).toEqual(["timed-out"]);
    // Alone in its tier, it is `unknown` and not run again (task 001-179).
    expect(h.sink.callsOf("markUnknown").map((c) => c.reason)).toEqual(["timed out after 2 s"]);

    h.write("src/math.ts", "export const add = (a: number, b: number) => b + a;\n");
    await h.batch("src/math.ts");
    await h.scheduler.idle();
    expect(h.runsOf("test/math.test.ts").at(-1)?.report.end).toBe("completed");
    expect(h.sink.stateOf(adds)).toMatchObject({ outcome: "pass", validity: "current" });
  });
});
