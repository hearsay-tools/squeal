import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDaemonLoop } from "../../src/core/daemon-loop/index.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { storePaths } from "../../src/core/store/index.js";
import { DEFAULT_POLICY, type WatcherBackend } from "../../src/core/types/index.js";
import { createWatcherBackend } from "../../src/core/watcher/index.js";
import { createVitestAdapter } from "../../src/runners/vitest/index.js";
import { waitFor } from "../watcher/helpers.js";
import { createRepo, openRepoStore, SLOW } from "./helpers.js";
import { RecordingSink } from "./recording-sink.js";

describe("daemon loop: change feed into scheduler", SLOW, () => {
  it("a gitignored generated file in a closure is watched and changes the key when rewritten (B2)", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const root = repo.main;
    const worktreeId = worktreeIdFor(root);
    const runner = await createVitestAdapter({ root });
    const errors: Error[] = [];
    const loop = createDaemonLoop({
      root,
      worktreeId,
      store,
      runner,
      sink: new RecordingSink(store, worktreeId),
      policy: DEFAULT_POLICY,
      squealVersion: "0.0.0-test",
      runsDir: storePaths(repo.commonDir).runsDir,
      onError: (error) => errors.push(error),
      timings: { reconcileIntervalMs: 60_000 },
    });
    const keyOf = () =>
      store.testFileKeys.list(worktreeId).find((r) => r.testFile.path === "test/gen.test.ts");
    try {
      await loop.start();
      await loop.scheduler.idle();
      expect(loop.scheduler.extraFiles()).toEqual(["src/gen/client.ts"]);
      expect([...loop.scheduler.trackedPaths()]).toContain("src/gen/client.ts");
      const first = keyOf();
      expect(first?.key).toMatch(/^[0-9a-f]{64}$/);
      const outcomes = (key: string | null | undefined) =>
        store.results.byKey(key ?? null).map((r) => [r.check.kind, r.outcome]);
      expect(outcomes(first?.key)).toEqual([
        ["file", "pass"],
        ["test", "pass"],
      ]);

      // Codegen rewrites the file with a breaking change.
      writeFileSync(join(root, "src/gen/client.ts"), 'export const client = () => "changed";\n');
      await waitFor(() => keyOf()?.key !== first?.key, 10_000);
      await waitFor(() => keyOf()?.pending === null, 30_000);
      await loop.scheduler.idle();

      const second = keyOf();
      expect(second?.key).not.toBe(first?.key);
      expect(outcomes(second?.key)).toEqual([
        ["file", "pass"],
        ["test", "fail"],
      ]);
      expect(store.revisions.latest(worktreeId)?.changes.map((c) => c.path)).toEqual([
        "src/gen/client.ts",
      ]);
    } finally {
      await loop.close();
      await runner.close();
    }
    expect(errors).toEqual([]);
  });

  it("records an edit made after the start scan, before the watcher starts, in no start revision (001-99, wave 10d S1)", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const root = repo.main;
    const worktreeId = worktreeIdFor(root);
    const runner = await createVitestAdapter({ root });
    const inner = createWatcherBackend(process.platform);
    // `keys.bootstrap` has run when the feed starts its watch; the agent edits now.
    const backend: WatcherBackend = {
      name: inner.name,
      watch: (spec, listener) => {
        writeFileSync(
          join(root, "src/math.ts"),
          "export const add = (a: number, b: number) => a + b + 0;\n",
        );
        return inner.watch(spec, listener);
      },
    };
    const errors: Error[] = [];
    const loop = createDaemonLoop({
      root,
      worktreeId,
      store,
      runner,
      sink: new RecordingSink(store, worktreeId),
      policy: DEFAULT_POLICY,
      squealVersion: "0.0.0-test",
      runsDir: storePaths(repo.commonDir).runsDir,
      onError: (error) => errors.push(error),
      backend,
      timings: { reconcileIntervalMs: 60_000 },
    });
    try {
      await loop.start();
      const latest = store.revisions.latest(worktreeId)?.number ?? 0;
      const touching = store.revisions
        .range(worktreeId, 0, latest)
        .filter((r) => r.changes.some((c) => c.path === "src/math.ts"));
      expect(touching.map((r) => r.trigger)).toEqual(["interval"]);
    } finally {
      await loop.close();
      await runner.close();
    }
    expect(errors).toEqual([]);
  });
});
