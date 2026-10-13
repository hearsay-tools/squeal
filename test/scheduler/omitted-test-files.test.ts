import { describe, expect, it } from "vitest";
import { readOmittedTestFiles } from "../../src/core/scheduler/omitted-test-files.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Task 005-26 (review wave-2 B1): every successful listing records how many
 * test files it left out because Squeal does not run them, so the one-time
 * deny (spec 005 D8) answers only for a command the listing covers. A failed
 * listing keeps the record, as it keeps the list.
 */

const TYPECHECKED_CONFIG = `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    typecheck: { enabled: true, include: ["test/**/*.test-d.ts"] },
    testTimeout: 60_000,
  },
});
`;
const TYPE_TEST = `import { expectTypeOf, test } from "vitest";
test("types", () => expectTypeOf(1).toEqualTypeOf<number>());
`;

describe("scheduler: the listing's left-out count (task 005-26)", SLOW, () => {
  it("records none for a complete listing, the typecheck files once enabled, and keeps it past a failed listing", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { allowErrors: true });
    expect(readOmittedTestFiles(store, h.worktreeId)).toBeNull();
    await h.scheduler.start();
    await h.scheduler.idle();
    expect(readOmittedTestFiles(store, h.worktreeId)).toBe(0);

    h.write("test/sum.test-d.ts", TYPE_TEST);
    h.write("vitest.config.ts", TYPECHECKED_CONFIG);
    await h.batch("test/sum.test-d.ts", "vitest.config.ts");
    await h.scheduler.idle();
    expect(readOmittedTestFiles(store, h.worktreeId)).toBe(1);
    expect(h.store.testFileKeys.list(h.worktreeId).map((r) => r.testFile.path)).not.toContain(
      "test/sum.test-d.ts",
    );

    h.runner.failing.add("testFiles");
    h.write("test/more.test-d.ts", TYPE_TEST);
    h.write("test/extra.test.ts", 'import { it } from "vitest";\nit("is extra", () => {});\n');
    await h.batch("test/more.test-d.ts", "test/extra.test.ts");
    await h.scheduler.idle();
    expect(readOmittedTestFiles(store, h.worktreeId)).toBe(1);

    h.runner.failing.clear();
    h.write("src/math.ts", "export const add = (a: number, b: number) => b + a;\n");
    await h.batch("src/math.ts");
    await h.scheduler.idle();
    expect(readOmittedTestFiles(store, h.worktreeId)).toBe(2);
  });
});
