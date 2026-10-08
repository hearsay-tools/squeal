import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CheckKey, TestCheckId } from "../../src/core/types/index.js";
import { waitFor } from "../watcher/helpers.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

const check = (path: string, fullName: string): TestCheckId => ({
  kind: "test",
  project: "",
  testPath: path,
  fullName,
});

describe("scheduler: tiers, stability and crashes (D5, D12)", SLOW, () => {
  it("discards a tier result whose inputs changed during the run and re-queues the file", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 2 });

    let keyDuringRun: CheckKey | null = null;
    h.runner.beforeRun = (files) => {
      if (keyDuringRun !== null || !files.some((f) => f.path === "test/math.test.ts")) return;
      keyDuringRun = h.keyOf("test/math.test.ts");
      // The agent edits a closure file while the tier is in flight. No watcher batch arrives.
      h.write("src/math.ts", "export const add = (a: number, b: number) => a + b + 0;\n");
    };
    await h.scheduler.start();
    await h.scheduler.idle();

    expect(keyDuringRun).toMatch(/^[0-9a-f]{64}$/);
    const firstKey = keyDuringRun as unknown as CheckKey;
    // Ran twice: the unstable tier and the re-queued run under the new key.
    const [unstable] = h.runsOf("test/math.test.ts");
    expect(h.runsOf("test/math.test.ts")).toHaveLength(2);
    // The unstable run completed, and the store kept no result of math from it.
    expect(store.runs.get(unstable?.options.runId ?? "")?.end).toBe("completed");
    const kept = store.results.listForCheck(check("test/math.test.ts", "adds"), 10);
    expect(kept.map((r) => r.provenance.runId)).not.toContain(unstable?.options.runId);
    // Nothing stored under the key whose inputs moved during the run.
    expect(store.results.byKey(firstKey)).toEqual([]);

    const finalKey = h.keyOf("test/math.test.ts");
    expect(finalKey).not.toBe(firstKey);
    expect(store.results.byKey(finalKey).map((r) => [r.check.kind, r.outcome])).toEqual([
      ["file", "pass"],
      ["test", "pass"],
    ]);
    expect(h.sink.stateOf(check("test/math.test.ts", "adds"))).toMatchObject({
      outcome: "pass",
      validity: "current",
    });
    // The scheduler reconciled the change itself: a revision records it.
    const revision = store.revisions.latest(h.worktreeId);
    expect(revision?.changes.map((c) => c.path)).toEqual(["src/math.ts"]);
    expect(h.header().counts).toEqual({ current: 11, pending: 0, stale: 0, unknown: 0 });
    // The baseline completed: the re-queued file got its result.
    expect(store.checkpoints.lastCompleted(h.worktreeId)?.kind).toBe("baseline");
  });

  it("a crashed run stores nothing under a key and marks its files unknown", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 2 });
    await h.scheduler.start();
    await h.scheduler.idle();
    const baselineRuns = h.runner.runs.length;

    // One tier: a new test file that kills its worker, and an edited test file.
    h.write(
      "test/kill.test.ts",
      'import { it } from "vitest";\nit("kills its worker", () => { process.kill(process.pid, "SIGKILL"); });\n',
    );
    h.write(
      "test/plain.test.ts",
      'import { expect, it } from "vitest";\n\nit("is plain", () => {\n  expect(1).toBe(1);\n});\n',
    );
    await h.batch("test/kill.test.ts", "test/plain.test.ts");
    await h.scheduler.idle();

    const tiers = h.runner.runs.slice(baselineRuns);
    expect(tiers.map((r) => r.files.map((f) => f.path).sort())).toEqual([
      ["test/kill.test.ts", "test/plain.test.ts"],
    ]);
    const run = tiers[0];
    expect(run?.report.end).toBe("crashed");
    expect(store.runs.get(run?.options.runId ?? "")?.end).toBe("crashed");

    for (const path of ["test/kill.test.ts", "test/plain.test.ts"]) {
      const key = h.keyOf(path);
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(store.results.byKey(key ?? "")).toEqual([]);
    }
    const unknown = h.sink.callsOf("markUnknown");
    expect(unknown).toHaveLength(1);
    expect(unknown[0]?.testFiles.map((f) => f.path).sort()).toEqual([
      "test/kill.test.ts",
      "test/plain.test.ts",
    ]);
    expect(unknown[0]?.reason).toContain("Worker forks emitted error");
    expect(h.sink.stateOf(check("test/plain.test.ts", "is plain"))?.outcome).toBe("unknown");
    // Not retried in a loop: unknown until the next change or run --all.
    const ends = h.runner.runs.map((run) => store.runs.get(run.options.runId)?.end);
    expect(ends.filter((end) => end === "crashed")).toHaveLength(1);
    expect(h.header()).toMatchObject({
      counts: { current: 8, pending: 0, stale: 0, unknown: 3 },
      testFilesWithoutChecks: { pending: 0, unknown: 1 },
    });
  });

  it("runs a file again when a batch during its crashed run gave it a new key", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir);
    await h.scheduler.start();
    await h.scheduler.idle();

    let batch: Promise<void> | null = null;
    const fixed = 'import { it } from "vitest";\nit("survives", () => {});\n';
    h.runner.beforeRun = (files) => {
      if (batch !== null || !files.some((f) => f.path === "test/kill.test.ts")) return;
      // The agent fixes the file while the crashing run is in flight; the watcher reports it.
      // The crashing test writes the fix itself: the adapter runs the bytes on disk at its
      // start (task 001-146), so a fix written here would never crash.
      const kill = join(h.root, "test/kill.test.ts");
      batch = waitFor(() => readFileSync(kill, "utf8") === fixed, 60_000).then(() =>
        h.batch("test/kill.test.ts"),
      );
    };
    h.write(
      "test/kill.test.ts",
      [
        'import { writeFileSync } from "node:fs";',
        'import { it } from "vitest";',
        'it("kills its worker", () => {',
        `  writeFileSync(new URL(import.meta.url), ${JSON.stringify(fixed)});`,
        '  process.kill(process.pid, "SIGKILL");',
        "});",
        "",
      ].join("\n"),
    );
    await h.batch("test/kill.test.ts");
    await h.scheduler.idle();
    await batch;
    await h.scheduler.idle();

    const runs = h.runsOf("test/kill.test.ts");
    expect(runs.map((r) => r.report.end)).toEqual(["crashed", "completed"]);
    const key = h.keyOf("test/kill.test.ts");
    expect(store.results.byKey(key).map((r) => [r.check, r.outcome])).toEqual([
      [{ kind: "file", project: "", testPath: "test/kill.test.ts" }, "pass"],
      [check("test/kill.test.ts", "survives"), "pass"],
    ]);
    expect(h.header()).toMatchObject({
      counts: { current: 13, pending: 0, stale: 0, unknown: 0 },
      testFilesWithoutChecks: { pending: 0, unknown: 0 },
    });
  });

  it("retires checks that disappeared from a test file", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir);
    await h.scheduler.start();
    await h.scheduler.idle();

    h.write(
      "test/plain.test.ts",
      'import { expect, it } from "vitest";\n\nit("is plain, renamed", () => {\n  expect(1).toBe(1);\n});\n',
    );
    await h.batch("test/plain.test.ts");
    await h.scheduler.idle();

    const retired = h.sink.callsOf("retire").flatMap((c) => c.checks);
    expect(retired).toEqual([
      check("test/plain.test.ts", "is plain"),
      check("test/plain.test.ts", "is plain too"),
    ]);
    expect(h.sink.stateOf(check("test/plain.test.ts", "is plain, renamed"))?.validity).toBe(
      "current",
    );
  });

  it("forgets a deleted test file and retires its checks", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir);
    await h.scheduler.start();
    await h.scheduler.idle();

    h.remove("test/plain.test.ts");
    await h.batch("test/plain.test.ts");
    await h.scheduler.idle();

    expect(h.keyOf("test/plain.test.ts")).toBeNull();
    expect(h.sink.callsOf("retire").flatMap((c) => c.checks)).toEqual([
      check("test/plain.test.ts", "is plain"),
      check("test/plain.test.ts", "is plain too"),
      { kind: "file", project: "", testPath: "test/plain.test.ts" },
    ]);
    expect(h.header().counts).toEqual({ current: 8, pending: 0, stale: 0, unknown: 0 });
  });

  it("re-keys every test file and runs them again when the installed lockfile changes (S8)", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 5 });
    h.write("node_modules/.package-lock.json", '{"packages":{}}\n');
    await h.scheduler.start();
    await h.scheduler.idle();
    const before = h.keyOf("test/plain.test.ts");
    expect(h.scheduler.extraFiles()).toContain("node_modules/.package-lock.json");

    // A listed package with no folder: npm would not trust the file, so every key moves (001-105).
    h.write(
      "node_modules/.package-lock.json",
      '{"packages":{"node_modules/left-pad":{"version":"1.3.0"}}}\n',
    );
    await h.batch("node_modules/.package-lock.json");
    await h.scheduler.idle();

    expect(h.keyOf("test/plain.test.ts")).not.toBe(before);
    expect(h.runner.runs.map((r) => r.files.length)).toEqual([5, 5]);
  });

  it("notices an installed lockfile that appears after start at the next reconciliation pass", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 5 });
    await h.scheduler.start();
    await h.scheduler.idle();
    const before = h.keyOf("test/plain.test.ts");

    // First npm install: an ignored file in an ignored directory, so no watch batch names it.
    h.write("node_modules/.package-lock.json", '{"packages":{}}\n');
    await h.scheduler.handleBatch({ trigger: "interval", paths: [] });
    await h.scheduler.idle();

    expect(h.keyOf("test/plain.test.ts")).not.toBe(before);
    expect(h.scheduler.extraFiles()).toContain("node_modules/.package-lock.json");
    expect(h.runner.runs.map((r) => r.files.length)).toEqual([5, 5]);
  });
});
