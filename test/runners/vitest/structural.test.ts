import { describe, expect, it } from "vitest";
import type { RunReport } from "../../../src/core/types/index.js";
import { resolutionBases, resolutionCandidates } from "../../../src/runners/vitest/graph.js";
import { openFixture, paths, ref, SLOW } from "./helpers.js";

const outcomes = (report: RunReport) => report.results.map((r) => r.outcome);

const readsTest = (specifier: string, expected: string) =>
  [
    'import { expect, it } from "vitest";',
    `import { which } from "${specifier}";`,
    `it("reads ${expected}", () => expect(which).toBe("${expected}"));`,
    "",
  ].join("\n");

describe("resolutionBases", () => {
  const extensions = [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"];

  it("inverts resolutionCandidates: extension, index and TypeScript twin", () => {
    expect(resolutionBases("/r/src/util.ts", extensions)).toEqual([
      "/r/src/util.ts",
      "/r/src/util",
      "/r/src/util.js",
    ]);
    expect(resolutionBases("/r/src/pkg/index.tsx", extensions)).toEqual([
      "/r/src/pkg/index.tsx",
      "/r/src/pkg/index",
      "/r/src/pkg",
      "/r/src/pkg/index.js",
      "/r/src/pkg/index.jsx",
    ]);
    expect(resolutionBases("/r/README", extensions)).toEqual(["/r/README"]);
    for (const path of ["/r/src/util.ts", "/r/src/pkg/index.tsx", "/r/a.mts", "/r/b.json"]) {
      for (const base of resolutionBases(path, extensions)) {
        expect(resolutionCandidates(base, extensions)).toContain(path);
      }
    }
  });
});

/*
 * Lessons, defect 11: an add or delete invalidates only the transforms it can
 * change (spec 001 D4), never every cached transform. One test per case the
 * full invalidation covered, and one that the rest stays cached.
 */
describe("vitest adapter: targeted invalidation on add and delete", SLOW, () => {
  it("a missing import target appears: the importer resolves it", async () => {
    const fx = await openFixture();
    fx.write("src/uses-later.ts", 'export { which } from "./later";\n');
    fx.write("src/uses-pkg.ts", 'export { which } from "./pkg";\n');
    fx.write("test/later.test.ts", readsTest("../src/uses-later.ts", "later"));
    fx.write("test/pkg.test.ts", readsTest("../src/uses-pkg.ts", "pkg"));
    await fx.adapter.invalidate([
      { path: "src/uses-later.ts", kind: "add" },
      { path: "src/uses-pkg.ts", kind: "add" },
      { path: "test/later.test.ts", kind: "add" },
      { path: "test/pkg.test.ts", kind: "add" },
    ]);
    const tests = [ref("test/later.test.ts"), ref("test/pkg.test.ts")];
    const before = await fx.adapter.run(tests, fx.runOptions());
    expect(before.fileErrors).toHaveLength(2);

    // `./later` resolves through an extension, `./pkg` through `index`.
    fx.write("src/later.ts", 'export const which = "later";\n');
    fx.write("src/pkg/index.ts", 'export const which = "pkg";\n');
    await fx.adapter.invalidate([
      { path: "src/later.ts", kind: "add" },
      { path: "src/pkg/index.ts", kind: "add" },
    ]);

    expect(paths(await fx.adapter.affected(["src/later.ts"]))).toEqual(["test/later.test.ts"]);
    expect(paths(await fx.adapter.affected(["src/pkg/index.ts"]))).toEqual(["test/pkg.test.ts"]);
    const after = await fx.adapter.run(tests, fx.runOptions());
    expect(after.fileErrors).toEqual([]);
    expect(outcomes(after)).toEqual(["pass", "pass"]);
  });

  it("a resolved target is deleted: the importer resolves the next candidate", async () => {
    const fx = await openFixture();
    fx.write("src/util.ts", 'export const which = "file";\n');
    fx.write("src/util/index.ts", 'export const which = "index";\n');
    fx.write("src/uses-util.ts", 'export { which } from "./util";\n');
    fx.write("test/util.test.ts", readsTest("../src/uses-util.ts", "index"));
    await fx.adapter.invalidate(
      ["src/util.ts", "src/util/index.ts", "src/uses-util.ts", "test/util.test.ts"].map((path) => ({
        path,
        kind: "add" as const,
      })),
    );
    const test = [ref("test/util.test.ts")];
    expect(outcomes(await fx.adapter.run(test, fx.runOptions()))).toEqual(["fail"]);

    fx.remove("src/util.ts");
    await fx.adapter.invalidate([{ path: "src/util.ts", kind: "delete" }]);

    expect(paths(await fx.adapter.affected(["src/util/index.ts"]))).toEqual(["test/util.test.ts"]);
    expect(outcomes(await fx.adapter.run(test, fx.runOptions()))).toEqual(["pass"]);
  });

  it("a new file shadows a resolved one: the importer resolves the new file", async () => {
    const fx = await openFixture();
    fx.write("src/util/index.ts", 'export const which = "index";\n');
    fx.write("src/uses-util.ts", 'export { which } from "./util";\n');
    fx.write("test/util.test.ts", readsTest("../src/uses-util.ts", "file"));
    await fx.adapter.invalidate(
      ["src/util/index.ts", "src/uses-util.ts", "test/util.test.ts"].map((path) => ({
        path,
        kind: "add" as const,
      })),
    );
    const test = [ref("test/util.test.ts")];
    expect(outcomes(await fx.adapter.run(test, fx.runOptions()))).toEqual(["fail"]);

    fx.write("src/util.ts", 'export const which = "file";\n');
    await fx.adapter.invalidate([{ path: "src/util.ts", kind: "add" }]);

    expect(paths(await fx.adapter.affected(["src/util.ts"]))).toEqual(["test/util.test.ts"]);
    expect(await fx.adapter.affected(["src/util/index.ts"])).toEqual([]);
    expect(outcomes(await fx.adapter.run(test, fx.runOptions()))).toEqual(["pass"]);
  });

  it("an unrelated add or delete leaves every other transform cached", async () => {
    const fx = await openFixture();
    expect(paths(await fx.adapter.affected(["src/strings.ts"]))).toEqual(["test/strings.test.ts"]);

    // Edited on disk but not invalidated: only a dropped cache would see the new import.
    fx.write("src/math.ts", fx.read("src/math.ts").replace("\n", '\nimport "./strings.ts";\n'));
    fx.write("src/unrelated.ts", "export const unrelated = 1;\n");
    await fx.adapter.invalidate([{ path: "src/unrelated.ts", kind: "add" }]);
    fx.remove("src/unrelated.ts");
    await fx.adapter.invalidate([{ path: "src/unrelated.ts", kind: "delete" }]);
    expect(paths(await fx.adapter.affected(["src/strings.ts"]))).toEqual(["test/strings.test.ts"]);

    await fx.adapter.invalidate([{ path: "src/math.ts", kind: "change" }]);
    expect(paths(await fx.adapter.affected(["src/strings.ts"]))).toEqual([
      "test/each.test.ts",
      "test/math.test.ts",
      "test/strings.test.ts",
    ]);
  });
});
