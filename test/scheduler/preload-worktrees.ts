import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import { observedStore } from "../../src/core/daemon/node-test-runners.js";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { createScheduler } from "../../src/core/scheduler/index.js";
import { storePaths } from "../../src/core/store/index.js";
import {
  type CheckKey,
  DEFAULT_POLICY,
  type NodeTestProject,
  type RunnerAdapter,
  type Store,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { createNodeTestAdapter } from "../../src/runners/node-test/adapter.js";
import { git } from "../hash/git-repo.js";
import { addWorktree, createRepo, openRepoStore } from "./helpers.js";
import { RecordingSink } from "./recording-sink.js";

/*
 * Two worktrees of one repository with a node:test project whose test file,
 * or whose preload, loads `nt/src/hidden.*` by a computed specifier: A's copy
 * sets 1, B's sets 2, and the tests check 1 (tasks 003-26, 003-43).
 */

export const NT: NodeTestProject = {
  name: "nt",
  cwd: "nt",
  node: process.execPath,
  argv: [],
  env: {},
  include: ["test/*.test.mjs"],
};
export const HIDDEN_TEST = "nt/test/hidden.test.mjs";
export const HIDDEN_SRC = "nt/src/hidden.mjs";

export function writeProject(root: string): void {
  mkdirSync(join(root, "nt/src"), { recursive: true });
  mkdirSync(join(root, "nt/test"), { recursive: true });
  writeFileSync(join(root, HIDDEN_SRC), "export const hidden = 1;\n");
  writeFileSync(
    join(root, HIDDEN_TEST),
    [
      'import assert from "node:assert/strict";',
      'import { test } from "node:test";',
      'const target = "../src/hidden" + ".mjs";',
      'test("hidden is one", async () => assert.equal((await import(target)).hidden, 1));',
      "",
    ].join("\n"),
  );
}

/*
 * Review wave 2.5 (004), B3: a relative `--require` preload loads a helper
 * by a computed `require`; both test files check the value it sets.
 */
export const PRELOADED: NodeTestProject = { ...NT, argv: ["--require", "./scripts/setup.cjs"] };
export const CONTROL_TEST = "nt/test/control.test.mjs";
export const PRELOAD_SRC = "nt/src/hidden.cjs";

export function writePreloadProject(root: string): void {
  mkdirSync(join(root, "nt/scripts"), { recursive: true });
  mkdirSync(join(root, "nt/src"), { recursive: true });
  mkdirSync(join(root, "nt/test"), { recursive: true });
  writeFileSync(join(root, "nt/scripts/setup.cjs"), 'require("../src/hidden" + ".cjs");\n');
  writeFileSync(join(root, PRELOAD_SRC), "globalThis.hiddenValue = 1;\n");
  for (const path of [CONTROL_TEST, HIDDEN_TEST]) {
    writeFileSync(
      join(root, path),
      [
        'import assert from "node:assert/strict";',
        'import { test } from "node:test";',
        'test("the preload ran", () => assert.equal(globalThis.hiddenValue, 1));',
        "",
      ].join("\n"),
    );
  }
}

/** A node:test file's current key in the worktree at `root`. */
export function keyOf(store: Store, root: string, path = HIDDEN_TEST): CheckKey | null | undefined {
  return store.testFileKeys.list(worktreeIdFor(root)).find((r) => r.testFile.path === path)?.key;
}

/** Whether a node:test file's known outcome is the worktree's own or inherited. */
export function origin(store: Store, root: string, path = HIDDEN_TEST): string | undefined {
  return store.knownStates
    .list(worktreeIdFor(root))
    .find((s) => s.check.testPath === path && s.check.kind === "test")?.origin?.kind;
}

/** A node:test file's known outcome for its test, as `squeal status` reads it. */
export function outcome(store: Store, root: string, path = HIDDEN_TEST): string | undefined {
  return store.knownStates
    .list(worktreeIdFor(root))
    .find((s) => s.check.testPath === path && s.check.kind === "test")?.outcome;
}

export interface Worktree {
  readonly scheduler: ReturnType<typeof createScheduler>;
  /** Runs of the worktree's adapter, by test file. */
  readonly runs: TestFileRef[][];
  /** `closure` answers the adapter computed. */
  readonly closures: () => number;
}

/**
 * A scheduler over one worktree's node:test adapter, sharing the observed
 * key through `store`. `hold`, while pending, holds every `closure` answer
 * after the adapter computed it; `holdRun`'s answer, while pending, holds
 * every `run` before the adapter starts it.
 */
export async function open(
  root: string,
  store: Store,
  commonDir: string,
  hold?: Promise<void>,
  project: NodeTestProject = NT,
  holdRun?: () => Promise<void> | undefined,
): Promise<Worktree> {
  const adapter = await createNodeTestAdapter(project, {
    root,
    observed: observedStore(store, project.name),
  });
  const runs: TestFileRef[][] = [];
  let closures = 0;
  const runner: RunnerAdapter = {
    ...adapter,
    async closure(testFile) {
      const closure = await adapter.closure(testFile);
      closures += 1;
      await hold;
      return closure;
    },
    async run(files, options) {
      await holdRun?.();
      runs.push([...files]);
      return adapter.run(files, options);
    },
  };
  const worktreeId = worktreeIdFor(root);
  const scheduler = createScheduler({
    root,
    worktreeId,
    store,
    runner,
    sink: new RecordingSink(store, worktreeId),
    policy: DEFAULT_POLICY,
    squealVersion: "0.0.0-test",
    runsDir: storePaths(commonDir).runsDir,
    head: () => readHead(root),
  });
  onTestFinished(async () => {
    await scheduler.close();
    await adapter.close();
  });
  return { scheduler, runs, closures: () => closures };
}

export async function twoWorktrees(preload = false) {
  const repo = createRepo("basic");
  (preload ? writePreloadProject : writeProject)(repo.main);
  git(repo.main, ["add", "-A"]);
  git(repo.main, ["commit", "-qm", "nt"]);
  const rootB = addWorktree(repo.main, repo.dir, "b");
  // B's copy differs, beyond what B's static graph sees: its run fails.
  if (preload) writeFileSync(join(rootB, PRELOAD_SRC), "globalThis.hiddenValue = 2;\n");
  else writeFileSync(join(rootB, HIDDEN_SRC), "export const hidden = 2;\n");
  const store = openRepoStore(repo.commonDir);
  return { repo, rootB, store };
}
