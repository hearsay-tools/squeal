import { describe, expect, it, onTestFinished } from "vitest";
import { DEFAULT_POLICY, type FileChange, type Policy } from "../../src/core/types/index.js";
import {
  ALL_TEST_FILES,
  createRepo,
  type Harness,
  openHarness,
  openRepoStore,
  SLOW,
} from "./helpers.js";

const keysOf = (h: Harness) => ALL_TEST_FILES.map((path) => h.keyOf(path));

/**
 * A harness whose `reloadPolicy` returns `next` for a revision that changes
 * `squeal.config.json`, as the daemon does (spec 001 D11, review S3).
 */
async function reloading(seen: (readonly FileChange[])[]) {
  const repo = createRepo();
  const store = openRepoStore(repo.commonDir);
  const state: { next: Policy } = { next: DEFAULT_POLICY };
  const h = await openHarness(repo.main, store, repo.commonDir, {
    reloadPolicy: (changes) => {
      seen.push(changes);
      return changes.some((c) => c.path === "squeal.config.json") ? state.next : null;
    },
  });
  return { h, state };
}

describe("scheduler: policy reload on a squeal.config.json revision (D11, review S3)", SLOW, () => {
  it("new inputs re-key every test file and the declared input then moves keys", async () => {
    const seen: (readonly FileChange[])[] = [];
    const { h, state } = await reloading(seen);
    h.write("fixtures/data.json", '{"n": 1}\n');
    await h.scheduler.start();
    await h.scheduler.idle();
    const before = keysOf(h);
    const runs = h.runner.runs.length;

    state.next = { ...DEFAULT_POLICY, inputs: ["fixtures/**"] };
    h.write("squeal.config.json", '{"inputs": ["fixtures/**"]}\n');
    await h.batch("squeal.config.json");
    expect(seen.at(-1)?.map((c) => c.path)).toEqual(["squeal.config.json"]);
    const reloaded = keysOf(h);
    for (const [i, key] of reloaded.entries()) expect(key, ALL_TEST_FILES[i]).not.toBe(before[i]);
    await h.scheduler.idle();
    expect(h.runner.runs.length).toBeGreaterThan(runs);

    h.write("fixtures/data.json", '{"n": 2}\n');
    await h.batch("fixtures/data.json");
    for (const [i, key] of keysOf(h).entries())
      expect(key, ALL_TEST_FILES[i]).not.toBe(reloaded[i]);
    await h.scheduler.idle();
  });

  it("a new env.allowlist re-reads the environment and re-keys every test file", async () => {
    // Read from `process.env`, the harness's default; an unset variable adds nothing to the hash.
    process.env.SQUEAL_RELOAD_TEST = "on";
    onTestFinished(() => {
      delete process.env.SQUEAL_RELOAD_TEST;
    });
    const seen: (readonly FileChange[])[] = [];
    const { h, state } = await reloading(seen);
    await h.scheduler.start();
    await h.scheduler.idle();
    const before = keysOf(h);
    const environments = h.store.revisions.latest(h.worktreeId)?.number;

    state.next = { ...DEFAULT_POLICY, env: { allowlist: ["SQUEAL_RELOAD_TEST"] } };
    h.write("squeal.config.json", '{"env": {"allowlist": ["SQUEAL_RELOAD_TEST"]}}\n');
    await h.batch("squeal.config.json");
    expect(h.store.revisions.latest(h.worktreeId)?.number).toBe((environments ?? 0) + 1);
    const after = keysOf(h);
    for (const [i, key] of after.entries()) expect(key, ALL_TEST_FILES[i]).not.toBe(before[i]);
    await h.scheduler.idle();
    // The keys after the run are the real environment hash, not the provisional one.
    expect(keysOf(h)).toEqual(after);
    expect(h.header()).toMatchObject({ counts: { pending: 0 } });
  });

  it("a revision without squeal.config.json leaves the policy alone", async () => {
    const seen: (readonly FileChange[])[] = [];
    const { h } = await reloading(seen);
    await h.scheduler.start();
    await h.scheduler.idle();
    h.write("src/math.ts", "export const add = (a: number, b: number) => a + b + 0;\n");
    await h.batch("src/math.ts");
    expect(seen.map((changes) => changes.map((c) => c.path))).toEqual([["src/math.ts"]]);
    await h.scheduler.idle();
  });
});
