import { describe, expect, it } from "vitest";
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
});
