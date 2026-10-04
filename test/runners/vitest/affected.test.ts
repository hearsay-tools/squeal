import { describe, expect, it } from "vitest";
import { ALL_TEST_FILES, openFixture, paths, ref, SLOW } from "./helpers.js";

describe("vitest adapter: affected()", SLOW, () => {
  it("follows transitive imports with Vitest's related walk", async () => {
    const fx = await openFixture();
    expect(paths(await fx.adapter.affected(["src/deep.ts"]))).toEqual([
      "test/each.test.ts",
      "test/math.test.ts",
    ]);
    expect(paths(await fx.adapter.affected(["test/greeting.test.ts"]))).toEqual([
      "test/greeting.test.ts",
    ]);
    expect(await fx.adapter.affected([])).toEqual([]);
    expect(await fx.adapter.affected(["README.md"])).toEqual([]);
  });

  it("marks every project test file when a setup-file dependency changes", async () => {
    const fx = await openFixture();
    expect(paths(await fx.adapter.affected(["src/setup-dep.ts"]))).toEqual(ALL_TEST_FILES);
    expect(paths(await fx.adapter.affected(["test/setup.ts"]))).toEqual(ALL_TEST_FILES);

    // The change also reaches the next run: setup files are re-fetched after invalidation.
    fx.write("src/setup-dep.ts", 'export const greeting = "bye";\n');
    await fx.adapter.invalidate([{ path: "src/setup-dep.ts", kind: "change" }]);
    const report = await fx.adapter.run([ref("test/greeting.test.ts")], fx.runOptions());
    expect(report.results.map((r) => r.outcome)).toEqual(["fail"]);
  });

  it("marks every project test file when global setup or the config changes", async () => {
    const fx = await openFixture();
    expect(paths(await fx.adapter.affected(["test/global-setup.ts"]))).toEqual(ALL_TEST_FILES);
    expect(paths(await fx.adapter.affected(["src/global-dep.ts"]))).toEqual(ALL_TEST_FILES);
    expect(paths(await fx.adapter.affected(["vitest.config.ts"]))).toEqual(ALL_TEST_FILES);
    expect(paths(await fx.adapter.affected(["vitest.shared.ts"]))).toEqual(ALL_TEST_FILES);
  });

  it("recreates the instance when a global setup dependency changes", async () => {
    const fx = await openFixture();
    // Vitest loads global setup once per instance, so a change needs a new instance.
    fx.write("src/global-dep.ts", "export const globalValue = 2;\n");
    const result = await fx.adapter.invalidate([{ path: "src/global-dep.ts", kind: "change" }]);
    expect(result.recreatedProjects).toEqual([""]);
  });

  it("marks the owning test file when its snapshot changes", async () => {
    const fx = await openFixture();
    expect(paths(await fx.adapter.affected(["test/__snapshots__/strings.test.ts.snap"]))).toEqual([
      "test/strings.test.ts",
    ]);
  });
});
