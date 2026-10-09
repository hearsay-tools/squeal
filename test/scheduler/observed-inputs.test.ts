import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { observedMetaKey } from "../../src/core/keys/index.js";
import { DEFAULT_POLICY, type Policy, type TestFileRef } from "../../src/core/types/index.js";
import {
  addWorktree,
  createRepo,
  type Harness,
  openHarness,
  openRepoStore,
  SLOW,
} from "./helpers.js";

/*
 * Task 001-132 (spec 001 D3, D4, D5, D11 as amended; research
 * observed-runtime-inputs): with no `inputs`, a test file re-runs when a
 * file it reads at run time, a script it spawns with `env: {}`, that
 * script's grandchild, a Worker's script or a listed directory changes,
 * under Vitest's forks and threads pools.
 */
const RUNTIME = "test/runtime.test.ts";
const PLAIN = "test/plain.test.ts";
const POOLS = ["forks", "threads"] as const;
const at = (path: string, project: string): TestFileRef => ({ project, path });
/** Appends a line to `path`: its content changes, what it does does not. */
const touch = (h: Harness, path: string) =>
  h.write(path, `${readFileSync(join(h.root, path), "utf8")}\n`);

const keyOf = (h: Harness, ref: TestFileRef) =>
  h.store.testFileKeys
    .list(h.worktreeId)
    .find((row) => row.testFile.project === ref.project && row.testFile.path === ref.path)?.key ??
  null;
const ranProjects = (h: Harness, path: string, from: number) =>
  h.runner.runs
    .slice(from)
    .flatMap((run) => run.files)
    .filter((f) => f.path === path)
    .map((f) => f.project)
    .sort();
/** The checks of `ref` current in this worktree, by validity. */
const validities = (h: Harness, ref: TestFileRef) =>
  h.store.knownStates
    .list(h.worktreeId)
    .filter((s) => s.check.project === ref.project && s.check.testPath === ref.path)
    .map((s) => s.validity);

async function observing(fixture = createRepo("observed"), policy: Partial<Policy> = {}) {
  const store = openRepoStore(fixture.commonDir);
  const h = await openHarness(fixture.main, store, fixture.commonDir, { observe: true, policy });
  await h.scheduler.start();
  await h.scheduler.idle();
  return { h, store, repo: fixture };
}

describe("scheduler: observed runtime inputs (task 001-132)", SLOW, () => {
  it("runs each file once at the start and stores its result under the key with what it read", async () => {
    const { h, store } = await observing();
    for (const pool of POOLS) {
      const runtime = at(RUNTIME, pool);
      expect(ranProjects(h, RUNTIME, 0).filter((p) => p === pool)).toEqual([pool]);
      const closure = store.testFiles.get(runtime)?.closure.paths ?? [];
      expect(closure).toEqual(
        expect.arrayContaining([
          "data/grand.txt",
          "data/input.txt",
          "data/listed/",
          "data/worker.txt",
          "scripts/child.mjs",
          "scripts/grandchild.mjs",
          "scripts/worker.mjs",
        ]),
      );
      // The gitignored build output is a blind spot: never keyed.
      expect(closure).not.toContain("ignored/build.txt");
      // Current under the key that holds what it read, with no second run.
      const key = keyOf(h, runtime);
      expect(h.store.results.byKey(key).length).toBeGreaterThan(0);
      expect(validities(h, runtime).every((v) => v === "current")).toBe(true);
    }
    expect(Object.keys(JSON.parse(store.meta.get(observedMetaKey("forks")) ?? "{}"))).toContain(
      RUNTIME,
    );
    expect(h.header().counts.pending).toBe(0);
  });

  it.each([
    "data/input.txt",
    "scripts/child.mjs",
    "scripts/grandchild.mjs",
    "data/grand.txt",
    "scripts/worker.mjs",
    "data/worker.txt",
  ])("re-runs the reader under both pools, and no other file, when %s changes", async (path) => {
    const { h } = await observing();
    const from = h.runner.runs.length;
    touch(h, path);
    await h.batch(path);
    await h.scheduler.idle();
    expect(ranProjects(h, RUNTIME, from)).toEqual(["forks", "threads"]);
    expect(ranProjects(h, PLAIN, from)).toEqual([]);
  });

  it("re-runs the file that listed a directory when the directory gains a file", async () => {
    const { h } = await observing();
    const before = POOLS.map((pool) => keyOf(h, at(RUNTIME, pool)));
    const from = h.runner.runs.length;
    h.write("data/listed/b.txt", "b\n");
    await h.batch("data/listed/b.txt");
    expect(POOLS.map((pool) => keyOf(h, at(RUNTIME, pool)))).not.toEqual(before);
    await h.scheduler.idle();
    expect(ranProjects(h, RUNTIME, from)).toEqual(["forks", "threads"]);
    expect(ranProjects(h, PLAIN, from)).toEqual([]);
  });

  it("keys a second worktree with what the first observed: equal files inherit, a changed one runs", async () => {
    const { repo, store } = await observing();
    const same = addWorktree(repo.main, repo.dir, "same");
    const second = await openHarness(same, store, repo.commonDir, { observe: true });
    await second.scheduler.start();
    await second.scheduler.idle();
    expect(ranProjects(second, RUNTIME, 0)).toEqual([]);

    const changed = addWorktree(repo.main, repo.dir, "changed");
    const third = await openHarness(changed, store, repo.commonDir, { observe: true });
    touch(third, "scripts/grandchild.mjs");
    await third.scheduler.start();
    await third.scheduler.idle();
    // Its gitignored build output is absent here: the new fail is re-run once (task 001-171).
    expect(ranProjects(third, RUNTIME, 0)).toEqual(["forks", "forks", "threads", "threads"]);
    expect(ranProjects(third, PLAIN, 0)).toEqual([]);
  });

  it("observe.runtimeInputs false keys as before, and switching it back restores those keys", async () => {
    const repo = createRepo("observed");
    const store = openRepoStore(repo.commonDir);
    const on: Policy = { ...DEFAULT_POLICY, observe: { runtimeInputs: true } };
    const state: { next: Policy } = { next: on };
    const off: Policy = { ...DEFAULT_POLICY, observe: { runtimeInputs: false } };
    const h = await openHarness(repo.main, store, repo.commonDir, {
      observe: true,
      policy: { observe: off.observe },
      reloadPolicy: (changes) =>
        changes.some((c) => c.path === "squeal.config.json") ? state.next : null,
    });
    await h.scheduler.start();
    await h.scheduler.idle();
    const keys = () => POOLS.map((pool) => keyOf(h, at(RUNTIME, pool)));
    const today = keys();
    expect(store.testFiles.get(at(RUNTIME, "forks"))?.closure.paths).not.toContain(
      "data/input.txt",
    );

    state.next = on;
    h.write("squeal.config.json", "{}\n");
    await h.batch("squeal.config.json");
    await h.scheduler.idle();
    const observed = keys();
    for (const [i, key] of observed.entries()) expect(key).not.toBe(today[i]);

    state.next = off;
    h.write("squeal.config.json", '{"observe": {"runtimeInputs": false}}\n');
    await h.batch("squeal.config.json");
    await h.scheduler.idle();
    expect(keys()).toEqual(today);
  });
});
