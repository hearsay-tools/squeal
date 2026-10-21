import { describe, expect, it } from "vitest";
import { readWhy } from "../../src/core/status/index.js";
import type { KnownState, ResultRecord, TestFileKeyRecord } from "../../src/core/types/index.js";
import { result } from "../store/helpers.js";
import { check, fakeRepo, seedStore, state } from "./helpers.js";

/*
 * Task 011-50 (gh-55, `research/issue-55.md`): `squeal why <test file>`
 * returns in seconds on a store as large as cezar's. The file names no
 * check, so `why` lists every known check of the worktree to find the
 * file's; on 0.1.229 their dedup was quadratic and took 29 s at 20,000.
 */
describe("why <test file> on a large store (011-50, gh-55)", () => {
  const TARGET = "src/target.test.ts";
  const OTHER_CHECKS = 20_000;
  // cezar's tracked test file count, as the research probe seeds.
  const OTHER_FILES = 763;
  // The linear code took 0.26 s at a load of 34 on 24 CPUs, 1.2 s capped to 34% of a CPU (a
  // load of 70) and 2.3 s capped to 15%; the quadratic code took 42 s at a load of 32.
  const BOUND_MS = 5_000;

  function seeded() {
    const repo = fakeRepo();
    const store = seedStore(repo);
    const b = repo.addWorktree("b");
    store.worktrees.upsert({
      id: b.id,
      root: b.root,
      commonDir: repo.commonDir,
      isMain: false,
      registeredAt: 1,
      daemon: null,
    });
    const keys: TestFileKeyRecord[] = [];
    const states: KnownState[] = [];
    const results: ResultRecord[] = [];
    const fileKey = (path: string, key: string) =>
      keys.push({
        worktreeId: b.id,
        testFile: { project: "", path },
        key,
        revision: 1,
        pending: null,
      });
    fileKey(TARGET, "key-target-34");
    const targets = Array.from({ length: 10 }, (_, c) => check(TARGET, `target > case ${c}`));
    for (const target of targets) {
      states.push(state(b.id, target));
      for (let k = 0; k < 35; k++) {
        results.push(result(target, `key-target-${k}`, { worktreeId: b.id, recordedAt: k }));
      }
    }
    for (let f = 0; f < OTHER_FILES; f++) fileKey(`src/f${f}.test.ts`, `key-f${f}`);
    for (let i = 0; i < OTHER_CHECKS; i++) {
      const f = i % OTHER_FILES;
      const other = check(`src/f${f}.test.ts`, `suite > case ${i}`);
      states.push(state(b.id, other));
      results.push(result(other, `key-f${f}`, { worktreeId: b.id }));
    }
    store.testFileKeys.upsertMany(keys);
    store.knownStates.upsertMany(states);
    store.results.putMany(results);
    return { root: b.root, targets };
  }

  it("lists the file's checks with their durations within the bound", { timeout: 300_000 }, () => {
    const { root, targets } = seeded();

    const started = performance.now();
    const why = readWhy(root, TARGET);
    const ms = performance.now() - started;

    expect(why).toMatchObject({ available: true, found: false, query: TARGET });
    if (!why.available || why.found) throw new Error("expected candidates");
    expect(why.candidates).toEqual(targets);
    expect(why.candidateDurations.map((d) => d?.results)).toEqual(targets.map(() => 35));
    expect(ms).toBeLessThan(BOUND_MS);
  });
});
