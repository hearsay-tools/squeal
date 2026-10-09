import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { observedStore } from "../../src/core/daemon/node-test-runners.js";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { createScheduler } from "../../src/core/scheduler/index.js";
import { readFlakyNotes } from "../../src/core/state/index.js";
import { storePaths } from "../../src/core/store/index.js";
import {
  DEFAULT_POLICY,
  type NodeTestProject,
  type RunnerAdapter,
  type Store,
} from "../../src/core/types/index.js";
import { createNodeTestAdapter } from "../../src/runners/node-test/adapter.js";
import { git } from "../hash/git-repo.js";
import { addWorktree, createRepo, openRepoStore, SLOW } from "./helpers.js";
import { RecordingSink } from "./recording-sink.js";

/*
 * Review wave 13i, B2 (task 001-187, a stopgap until row 003-43): a node:test
 * preload's computed `require` is keyed into the project environment only
 * once observed. A worktree whose environment was read before another
 * worktree observed it stores its run under a key lacking the path, the key
 * the other worktree failed under with different bytes there. Its pass must
 * not heal that worktree's own fail. `scripts/setup.cjs` loads
 * `src/hidden.cjs`, which sets 1 in A and 2 in B; the test asserts 1.
 */

const NT: NodeTestProject = {
  name: "nt",
  cwd: "nt",
  node: process.execPath,
  argv: ["--require", "./scripts/setup.cjs"],
  env: {},
  include: ["test/*.test.mjs"],
};
const TEST = "nt/test/hidden.test.mjs";
const HIDDEN = "nt/src/hidden.cjs";

function writeProject(root: string): void {
  for (const dir of ["nt/scripts", "nt/src", "nt/test"])
    mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, "nt/scripts/setup.cjs"), 'require("../src/hidden" + ".cjs");\n');
  writeFileSync(join(root, HIDDEN), "globalThis.hiddenValue = 1;\n");
  writeFileSync(
    join(root, TEST),
    [
      'import assert from "node:assert/strict";',
      'import { test } from "node:test";',
      'test("the preload ran", () => assert.equal(globalThis.hiddenValue, 1));',
      "",
    ].join("\n"),
  );
}

/** The worktree's known state of the test, as `squeal status` reads it. */
function stateOf(store: Store, root: string) {
  return store.knownStates
    .list(worktreeIdFor(root))
    .find((s) => s.check.testPath === TEST && s.check.kind === "test");
}

/** A scheduler over the worktree's node:test adapter; `hold` holds every `closure` answer. */
async function open(root: string, store: Store, commonDir: string, hold?: Promise<void>) {
  const adapter = await createNodeTestAdapter(NT, {
    root,
    observed: observedStore(store, NT.name),
  });
  let closures = 0;
  let runs = 0;
  const runner: RunnerAdapter = {
    ...adapter,
    async closure(testFile) {
      const closure = await adapter.closure(testFile);
      closures += 1;
      await hold;
      return closure;
    },
    run(files, options) {
      runs += 1;
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
  const keyOf = () =>
    store.testFileKeys.list(worktreeId).find((r) => r.testFile.path === TEST)?.key ?? null;
  return { scheduler, keyOf, closures: () => closures, runs: () => runs };
}

describe("no heal under a preload path the environment key lacks", SLOW, () => {
  it("keeps B's own fail when A's pass shares B's key without the observed preload", async () => {
    const repo = createRepo("basic");
    writeProject(repo.main);
    git(repo.main, ["add", "-A"]);
    git(repo.main, ["commit", "-qm", "nt"]);
    const rootB = addWorktree(repo.main, repo.dir, "b");
    writeFileSync(join(rootB, HIDDEN), "globalThis.hiddenValue = 2;\n");
    const store = openRepoStore(repo.commonDir);

    // A reads its environment, then waits at its closures; B runs and fails meanwhile.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    onTestFinished(() => release());
    const a = await open(repo.main, store, repo.commonDir, held);
    const aStarted = a.scheduler.start();
    await expect.poll(() => a.closures()).toBeGreaterThan(0);
    const b = await open(rootB, store, repo.commonDir);
    await b.scheduler.start();
    await b.scheduler.idle();
    expect(stateOf(store, rootB)).toMatchObject({ outcome: "fail", origin: { kind: "own" } });

    release();
    await aStarted;
    await a.scheduler.idle();
    // A ran under B's key, which lacks `src/hidden.cjs`, and passed.
    expect(a.runs()).toBeGreaterThan(0);
    expect(a.keyOf()).toBe(b.keyOf());
    expect(stateOf(store, repo.main)).toMatchObject({ outcome: "pass", origin: { kind: "own" } });
    // B's own fail stands: no heal, and no flaky note claims the inputs were the same.
    expect(stateOf(store, rootB)).toMatchObject({
      outcome: "fail",
      validity: "current",
      origin: { kind: "own" },
    });
    expect(readFlakyNotes(store).size).toBe(0);
  });
});
