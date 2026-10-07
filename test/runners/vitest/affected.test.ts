import { describe, expect, it } from "vitest";
import { ALL_TEST_FILES, all, openFixture, paths, ref, SLOW } from "./helpers.js";

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
    expect(all(await fx.adapter.affected([]))).toEqual([]);
    expect(all(await fx.adapter.affected(["README.md"]))).toEqual([]);
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

  /*
   * Lessons, defect 3, and spec 001 D5 step 4 as amended: "test files that
   * import a changed path directly according to the runner's module graph,
   * then transitively affected files". `src/math.ts` imports `src/deep.ts`.
   */
  it("splits direct importers from transitive ones", async () => {
    const fx = await openFixture();
    const detailed = async (changed: string[]) => {
      const result = await fx.adapter.affected(changed);
      return { direct: paths(result.direct), transitive: paths(result.transitive) };
    };
    expect(await detailed(["src/math.ts"])).toEqual({
      direct: ["test/each.test.ts", "test/math.test.ts"],
      transitive: [],
    });
    expect(await detailed(["src/deep.ts"])).toEqual({
      direct: [],
      transitive: ["test/each.test.ts", "test/math.test.ts"],
    });
    expect(await detailed(["test/greeting.test.ts"])).toEqual({
      direct: ["test/greeting.test.ts"],
      transitive: [],
    });
    expect(await detailed(["test/__snapshots__/strings.test.ts.snap"])).toEqual({
      direct: ["test/strings.test.ts"],
      transitive: [],
    });
    // A setup file reaches every test file through the environment, never in one hop.
    expect(await detailed(["src/setup-dep.ts"])).toEqual({
      direct: [],
      transitive: ALL_TEST_FILES,
    });
    expect(await detailed([])).toEqual({ direct: [], transitive: [] });
    expect(await detailed(["src/math.ts", "src/strings.ts"])).toEqual({
      direct: ["test/each.test.ts", "test/math.test.ts", "test/strings.test.ts"],
      transitive: [],
    });
  });

  it("a test that imports through a barrel is transitive", async () => {
    const fx = await openFixture();
    fx.write(
      "src/index.ts",
      'export { add } from "./math.ts";\nexport { upper } from "./strings.ts";\n',
    );
    fx.write(
      "test/barrel.test.ts",
      'import { expect, it } from "vitest";\nimport { upper } from "../src/index.ts";\nit("barrel", () => expect(upper("a")).toBe("A"));\n',
    );
    await fx.adapter.invalidate([
      { path: "src/index.ts", kind: "add" },
      { path: "test/barrel.test.ts", kind: "add" },
    ]);
    const result = await fx.adapter.affected(["src/strings.ts"]);
    expect(paths(result.direct)).toEqual(["test/strings.test.ts"]);
    expect(paths(result.transitive)).toEqual(["test/barrel.test.ts"]);
  });

  it("the importer of a deleted file is direct", async () => {
    const fx = await openFixture();
    fx.remove("src/strings.ts");
    await fx.adapter.invalidate([{ path: "src/strings.ts", kind: "delete" }]);
    const result = await fx.adapter.affected(["src/strings.ts"]);
    expect(paths(result.direct)).toEqual(["test/strings.test.ts"]);
    expect(paths(result.transitive)).toEqual([]);
  });
});
