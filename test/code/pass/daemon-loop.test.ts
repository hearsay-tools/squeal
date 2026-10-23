import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCodePass, mainStoreSource } from "../../../src/core/code/pass/index.js";
import { createDaemonLoop, type DaemonLoop } from "../../../src/core/daemon-loop/index.js";
import { worktreeIdFor } from "../../../src/core/fs/index.js";
import { storePaths } from "../../../src/core/store/index.js";
import { createVitestAdapter } from "../../../src/runners/vitest/index.js";
import { createRepo, openRepoStore, SLOW } from "../../scheduler/helpers.js";
import { RecordingSink } from "../../scheduler/recording-sink.js";
import { waitFor } from "../../watcher/helpers.js";
import { open } from "../helpers.js";
import { fakeCounter, policyOn } from "./helpers.js";

describe("the code pass behind the daemon loop (015 D4)", SLOW, () => {
  it("counts each stored revision's included files from the main store's blob ids", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const root = repo.main;
    const worktreeId = worktreeIdFor(root);
    const runner = await createVitestAdapter({ root });
    const errors: Error[] = [];
    let loop: DaemonLoop | null = null;
    const code = createCodePass({
      worktreeId,
      root,
      commonDir: repo.commonDir,
      format: "sha1",
      source: mainStoreSource(store, worktreeId, () => loop?.scheduler.extraFiles() ?? []),
      policy: () => policyOn(),
      counter: () => Promise.resolve(fakeCounter()),
      log: () => {},
      onError: (error) => errors.push(error),
    });
    loop = createDaemonLoop({
      root,
      worktreeId,
      store,
      runner,
      sink: new RecordingSink(store, worktreeId),
      policy: policyOn(),
      squealVersion: "0.0.0-test",
      runsDir: storePaths(repo.commonDir).runsDir,
      onError: (error) => errors.push(error),
      timings: { reconcileIntervalMs: 60_000 },
      afterBatch: () => code.nudge(),
    });
    const codeStore = open(repo.commonDir);
    const failing = () =>
      codeStore.states.list(worktreeId, { outcome: "fail" }).map((s) => s.check.qualifiedName);
    try {
      await loop.start();
      await loop.scheduler.idle();
      code.nudge();
      await code.idle();
      // Test files and the gitignored generated file are never counted (D1).
      expect(codeStore.files.list(worktreeId).map((f) => f.path)).toEqual([
        "src/math.ts",
        "src/strings.ts",
        "vitest.config.ts",
      ]);

      writeFileSync(join(root, "src/settle.ts"), "settle 23 B1\npay 3 B2\n");
      await waitFor(() => failing().length > 0, 10_000);
      await code.idle();
      const latest = store.revisions.latest(worktreeId);
      expect(failing()).toEqual(["settle"]);
      expect(codeStore.states.list(worktreeId, { paths: ["src/settle.ts"] })[0]).toMatchObject({
        countedAt: latest?.number,
        blob: store.fileHashes.get(worktreeId, "src/settle.ts")?.hash,
      });
      const settle = {
        kind: "code",
        path: "src/settle.ts",
        qualifiedName: "settle",
        occurrence: 0,
      } as const;
      expect(codeStore.transitions.history(worktreeId, settle).map((t) => t.kind)).toEqual([
        "first-seen-fail",
      ]);
    } finally {
      await loop.close();
      await code.close();
      await runner.close();
    }
    expect(errors).toEqual([]);
  });
});
