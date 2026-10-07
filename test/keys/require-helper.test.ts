import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRepo, openHarness, openRepoStore, SLOW } from "../scheduler/helpers.js";

// Task 001-117, review wave-11d S3, through the scheduler: a project file a test loads by a
// relative `require` is in the test file's closure, so editing it re-keys and re-runs the test.

const TEST = "test/helper.test.ts";
const HELPER = "test/helper.cjs";
const HELPER_TEST =
  'import { expect, it } from "vitest";\n' +
  "declare const require: (id: string) => { value: string };\n" +
  'it("reads a relatively required helper", () => {\n' +
  '  expect(require("./helper.cjs").value).toBe("one");\n});\n';

describe("a relatively required helper (001-117)", SLOW, () => {
  it("re-runs its test file when the helper changes", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    writeFileSync(join(repo.main, TEST), HELPER_TEST);
    writeFileSync(join(repo.main, HELPER), 'exports.value = "one";\n');
    const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 10 });
    await h.scheduler.start();
    await h.scheduler.idle();
    const before = h.keyOf(TEST);
    const runs = h.runsOf(TEST).length;
    expect(before).not.toBeNull();
    expect(runs).toBeGreaterThan(0);

    h.write(HELPER, 'exports.value = "two";\n');
    await h.batch(HELPER);
    await h.scheduler.idle();

    expect(h.keyOf(TEST)).not.toBe(before);
    const after = h.runsOf(TEST);
    expect(after.length).toBeGreaterThan(runs);
    const last = after.at(-1)?.report.results.filter((r) => r.check.testPath === TEST);
    expect(last?.map((r) => r.outcome)).toEqual(["fail"]);
  });
});
