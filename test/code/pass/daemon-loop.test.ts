import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCodePass, mainStoreSource } from "../../../src/core/code/pass/index.js";
import { createDaemonLoop, type DaemonLoop } from "../../../src/core/daemon-loop/index.js";
import { worktreeIdFor } from "../../../src/core/fs/index.js";
import { storePaths } from "../../../src/core/store/index.js";
import { createVitestAdapter } from "../../../src/runners/vitest/index.js";
import { git } from "../../hash/git-repo.js";
import { addWorktree, createRepo, openRepoStore, SLOW } from "../../scheduler/helpers.js";
import { RecordingSink } from "../../scheduler/recording-sink.js";
import { waitFor } from "../../watcher/helpers.js";
import { open } from "../helpers.js";
import { fakeCounter, policyOn } from "./helpers.js";

/** The daemon loop over `repo` with the code pass nudged after each batch, started and idle. */
async function start(repo: ReturnType<typeof createRepo>) {
  const store = openRepoStore(repo.commonDir);
  const root = repo.main;
  const worktreeId = worktreeIdFor(root);
  const runner = await createVitestAdapter({ root });
  const errors: Error[] = [];
  const logs: string[] = [];
  let loop: DaemonLoop | null = null;
  const code = createCodePass({
    worktreeId,
    root,
    commonDir: repo.commonDir,
    format: "sha1",
    source: mainStoreSource(store, worktreeId, () => loop?.scheduler.extraFiles() ?? []),
    policy: () => policyOn(),
    counter: () => Promise.resolve(fakeCounter()),
    log: (text) => logs.push(text),
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
  const close = async () => {
    await loop.close();
    await code.close();
    await runner.close();
  };
  try {
    await loop.start();
    await loop.scheduler.idle();
    code.nudge();
    await code.idle();
  } catch (error) {
    await close();
    throw error;
  }
  return { root, store, worktreeId, code, codeStore, failing, errors, logs, close };
}

const settle = {
  kind: "code",
  path: "src/settle.ts",
  qualifiedName: "settle",
  occurrence: 0,
} as const;

describe("the code pass behind the daemon loop (015 D4)", SLOW, () => {
  it("counts each stored revision's included files from the main store's blob ids", async () => {
    const { root, store, worktreeId, code, codeStore, failing, errors, close } = await start(
      createRepo(),
    );
    try {
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
      expect(codeStore.transitions.history(worktreeId, settle).map((t) => t.kind)).toEqual([
        "first-seen-fail",
      ]);
    } finally {
      await close();
    }
    expect(errors).toEqual([]);
  });

  it("marks no edit for a body a fast-forward merge brought, and marks the next one (015-19)", async () => {
    const repo = createRepo();
    writeFileSync(join(repo.main, "src/settle.ts"), "settle 23 B1\npay 3 B2\n");
    git(repo.main, ["add", "-A"]);
    git(repo.main, ["commit", "-qm", "settle"]);
    const other = addWorktree(repo.main, repo.dir, "other");
    writeFileSync(join(other, "src/settle.ts"), "settle 25 B3\npay 3 B2\n");
    git(other, ["commit", "-qam", "settle, from elsewhere"]);
    const { root, store, worktreeId, code, codeStore, failing, errors, logs, close } =
      await start(repo);
    const value = () =>
      codeStore.states
        .list(worktreeId, { paths: [settle.path] })
        .find((s) => s.check.qualifiedName === settle.qualifiedName)?.value;
    const edited = () =>
      codeStore.states.edits(worktreeId, "complexity").map((e) => e.check.qualifiedName);
    try {
      expect(failing()).toEqual(["settle"]);
      git(root, ["merge", "-q", "--ff-only", "other"]);
      await waitFor(() => value() === 25, 10_000);
      await code.idle();
      expect(store.revisions.latest(worktreeId)?.head).toBe(
        git(other, ["rev-parse", "HEAD"]).trim(),
      );
      expect(edited()).toEqual([]);

      writeFileSync(join(root, "src/settle.ts"), "settle 26 B4\npay 3 B2\n");
      await waitFor(() => value() === 26, 10_000);
      await code.idle();
      expect(edited()).toEqual(["settle"]);
    } finally {
      await close();
    }
    expect(errors).toEqual([]);
    expect(logs).toEqual([]);
  });
});
