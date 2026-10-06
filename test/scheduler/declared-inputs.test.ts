import { describe, expect, it } from "vitest";
import { readDaemonNotes } from "../../src/core/status/notes.js";
import { DEFAULT_POLICY, type Policy } from "../../src/core/types/index.js";
import { ALL_TEST_FILES, createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Spec 001 D3 and D11 as amended; lessons, surprise 2: a map from test-file
 * glob to input globs puts a runtime read into the closures of the test files
 * that read it, so a change to it re-keys those files and no others.
 */
describe("scheduler: per-test-file declared inputs", SLOW, () => {
  it("re-keys only the test files whose glob names the changed input", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      policy: { inputs: { "test/math.test.ts": ["fixtures/**"] } },
    });
    h.write("fixtures/data.json", '{"n": 1}\n');
    await h.scheduler.start();
    await h.scheduler.idle();
    const keys = () => Object.fromEntries(ALL_TEST_FILES.map((path) => [path, h.keyOf(path)]));
    const before = keys();

    h.write("fixtures/data.json", '{"n": 2}\n');
    await h.batch("fixtures/data.json");
    const changed = keys();
    expect(changed["test/math.test.ts"]).not.toBe(before["test/math.test.ts"]);
    expect({ ...changed, "test/math.test.ts": null }).toEqual({
      ...before,
      "test/math.test.ts": null,
    });
    await h.scheduler.idle();

    // A new file under the glob joins math's closure only.
    h.write("fixtures/more.json", "{}\n");
    await h.batch("fixtures/more.json");
    const added = keys();
    expect(added["test/math.test.ts"]).not.toBe(changed["test/math.test.ts"]);
    expect({ ...added, "test/math.test.ts": null }).toEqual({
      ...changed,
      "test/math.test.ts": null,
    });
    await h.scheduler.idle();
  });

  /*
   * Review wave 4.5, S5: a map entry whose test-file glob matches no test
   * file, or an input glob that matches no file, was accepted silently.
   */
  it("notes map keys that match no test file and input globs that match no file", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const inputs = {
      "math.test.ts": ["fixtures/**"],
      "test/math.test.ts": ["fixtures/**", "fixture/*.json"],
    };
    const h = await openHarness(repo.main, store, repo.commonDir, { policy: { inputs } });
    h.write("fixtures/data.json", '{"n": 1}\n');
    await h.scheduler.start();
    await h.scheduler.idle();

    const texts = () => readDaemonNotes(store, h.worktreeId).map((note) => note.text);
    const expected = [
      'squeal.config.json: inputs key "math.test.ts" matches no test file; ' +
        "keys and input globs match worktree-relative paths from the start, so write " +
        '"**/math.test.ts" for a file in any directory',
      'squeal.config.json: inputs glob "fixture/*.json" matches no file',
    ];
    expect(texts()).toEqual(expected);
    expect(h.scheduler.status().notes).toEqual(expected);
  });

  it("notes them again after a policy reload, and not twice for one start", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    let policy: Policy = { ...DEFAULT_POLICY, inputs: { "math.test.ts": ["src/**"] } };
    const h = await openHarness(repo.main, store, repo.commonDir, {
      policy: { inputs: policy.inputs },
      reloadPolicy: (changes) =>
        changes.some((c) => c.path === "squeal.config.json") ? policy : null,
    });
    await h.scheduler.start();
    await h.scheduler.idle();
    const texts = () => readDaemonNotes(store, h.worktreeId).map((note) => note.text);
    expect(texts()).toHaveLength(1);

    policy = { ...DEFAULT_POLICY, inputs: { "test/math.test.ts": ["nowhere/**"] } };
    h.write("squeal.config.json", JSON.stringify({ inputs: policy.inputs }));
    await h.batch("squeal.config.json");
    await h.scheduler.idle();

    expect(texts().at(-1)).toBe('squeal.config.json: inputs glob "nowhere/**" matches no file');
  });

  it("does not repeat a note an earlier start persisted", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const options = { policy: { inputs: ["nowhere/**"] } };
    const first = await openHarness(repo.main, store, repo.commonDir, options);
    await first.scheduler.start();
    await first.scheduler.idle();
    await first.scheduler.close();
    const second = await openHarness(repo.main, store, repo.commonDir, options);
    await second.scheduler.start();
    await second.scheduler.idle();

    expect(readDaemonNotes(store, second.worktreeId).map((note) => note.text)).toEqual([
      'squeal.config.json: inputs glob "nowhere/**" matches no file',
    ]);
  });
});
