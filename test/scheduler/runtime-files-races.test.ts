import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { observedMetaKey } from "../../src/core/keys/observed.js";
import { runtimeFilesStatus } from "../../src/core/status/runtime-files.js";
import { DEFAULT_POLICY, type Policy } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { addWorktree, openHarness, openRepoStore, SLOW } from "./helpers.js";
import { idleAfterQuiet } from "./quiet-clock.js";
import { A, B, DATA, fixture, rules, scoped, text } from "./runtime-files-fixture.js";

it("never records observation growth across a policy change during a run", SLOW, async () => {
  const repo = fixture(false);
  const store = openRepoStore(repo.commonDir);
  let next: Policy = { ...DEFAULT_POLICY, ...RUN_MISSING };
  const h = await openHarness(repo.main, store, repo.commonDir, {
    observe: true,
    policy: scoped,
    runnerPartBesideRun: true,
    reloadPolicy: (changes) => (changes.some((c) => c.path === "squeal.config.json") ? next : null),
  });
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let began = false;
  h.runner.beforeRun = async () => {
    if (!began) {
      began = true;
      await gate;
    }
  };
  await h.scheduler.start();
  await expect.poll(() => began, { timeout: 5000 }).toBe(true);
  const oldKeys = [h.keyOf(A), h.keyOf(B)];
  try {
    h.write("squeal.config.json", "{}\n");
    await h.batch("squeal.config.json");
    expect([h.keyOf(A), h.keyOf(B)]).not.toEqual(oldKeys);
  } finally {
    release();
  }
  await idleAfterQuiet(h);
  // Every current result comes from a run after the identity changed.
  for (const path of [A, B]) {
    const current = store.results.byKey(h.keyOf(path));
    expect(current.length).toBeGreaterThan(0);
    expect(current.every((r) => r.provenance.runId !== h.runner.runs[0]?.options.runId)).toBe(true);
  }
  next = scoped;
  h.write("squeal.config.json", JSON.stringify({ runtimeFiles: rules }));
  await h.batch("squeal.config.json");
  await idleAfterQuiet(h);
  expect([h.keyOf(A), h.keyOf(B)]).toEqual(oldKeys);
});

it("protects recorder-only module loads and keeps a real failure visible", SLOW, async () => {
  const repo = fixture(false);
  const module = ".runtime/loaded.cjs";
  writeFileSync(join(repo.main, module), "module.exports = -1;\n");
  writeFileSync(
    join(repo.main, A),
    [
      'import { createRequire } from "node:module";',
      'import { expect, test } from "vitest";',
      'test("dynamic module", () => {',
      `  const path = "../.runtime/" + "loaded.cjs";`,
      "  expect(createRequire(import.meta.url)(path)).toBeGreaterThan(0);",
      "});",
      "",
    ].join("\n"),
  );
  const store = openRepoStore(repo.commonDir);
  const policy = { ...scoped, runtimeFiles: [{ project: "", tests: [A], paths: [module] }] };
  writeFileSync(
    join(repo.main, "squeal.config.json"),
    JSON.stringify({ runtimeFiles: policy.runtimeFiles }),
  );
  const h = await openHarness(repo.main, store, repo.commonDir, { observe: true, policy });
  await h.scheduler.start();
  await h.scheduler.idle();
  expect(h.scheduler.extraFiles()).toContain(module);
  expect(store.testFiles.get({ project: "", path: A })?.closure.paths).toContain(module);
  expect(runtimeFilesStatus(store, h.worktreeId, h.root)).toMatchObject({
    pending: false,
    readers: [
      expect.objectContaining({
        paths: [],
        conflicts: [{ path: module, reason: "observed module load" }],
      }),
    ],
  });
  expect(store.knownStates.list(h.worktreeId)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ outcome: "fail", check: expect.objectContaining({ testPath: A }) }),
    ]),
  );
  expect(JSON.parse(store.meta.get("observedDirect.") ?? "{}")[A] ?? []).not.toContain(module);
});

it(
  "keeps different policies isolated across two real worktrees, then shares equal scoped results",
  SLOW,
  async () => {
    const repo = fixture(false);
    const otherRoot = addWorktree(repo.main, repo.dir, "runtime-other");
    mkdirSync(join(otherRoot, ".runtime"));
    writeFileSync(join(otherRoot, DATA), text(8888));
    const store = openRepoStore(repo.commonDir);
    const first = await openHarness(repo.main, store, repo.commonDir, {
      observe: true,
      policy: scoped,
    });
    await first.scheduler.start();
    await first.scheduler.idle();
    const second = await openHarness(otherRoot, store, repo.commonDir, {
      observe: true,
      policy: RUN_MISSING,
      reloadPolicy: (changes) =>
        changes.some((c) => c.path === "squeal.config.json") ? scoped : null,
    });
    await second.scheduler.start();
    await second.scheduler.idle();
    expect(first.keyOf(A)).not.toBe(second.keyOf(A));
    expect(first.scheduler.extraFiles()).not.toContain(DATA);
    expect(second.scheduler.extraFiles()).toContain(DATA);
    const union = JSON.parse(store.meta.get(observedMetaKey("")) ?? "{}");
    expect(union[A]).toContain(DATA);
    expect(union[B]).toContain(DATA);
    const before = second.runsOf(A).length;
    second.write("squeal.config.json", JSON.stringify({ runtimeFiles: rules }));
    await second.batch("squeal.config.json");
    await idleAfterQuiet(second);
    expect(second.keyOf(A)).toBe(first.keyOf(A));
    expect(second.runsOf(A)).toHaveLength(before);
    expect(second.scheduler.extraFiles()).not.toContain(DATA);
    expect(JSON.parse(store.meta.get(observedMetaKey("")) ?? "{}")).toEqual(union);
  },
);
