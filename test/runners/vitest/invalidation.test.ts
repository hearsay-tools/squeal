import { describe, expect, it } from "vitest";
import { ALL_TEST_FILES, all, openFixture, paths, ref, SLOW } from "./helpers.js";

// One test per invalidation case in research vitest-internals Q5.
describe("vitest adapter: invalidation (research Q5)", SLOW, () => {
  it("changed imports update affected()", async () => {
    const fx = await openFixture();
    expect(paths(await fx.adapter.affected(["src/strings.ts"]))).toEqual(["test/strings.test.ts"]);

    fx.write(
      "src/math.ts",
      [
        'import { upper } from "./strings.ts";',
        "export const add = (a: number, b: number) => a + b;",
        "export const addBase = (a: number) => a + 10 + upper('').length;",
        "",
      ].join("\n"),
    );
    await fx.adapter.invalidate([{ path: "src/math.ts", kind: "change" }]);

    expect(paths(await fx.adapter.affected(["src/strings.ts"]))).toEqual([
      "test/each.test.ts",
      "test/math.test.ts",
      "test/strings.test.ts",
    ]);
    expect(all(await fx.adapter.affected(["src/deep.ts"]))).toEqual([]);
  });

  it("a deleted source file yields a file-level error", async () => {
    const fx = await openFixture();
    const before = await fx.adapter.run([ref("test/math.test.ts")], fx.runOptions());
    expect(before.fileErrors).toEqual([]);

    fx.remove("src/deep.ts");
    await fx.adapter.invalidate([{ path: "src/deep.ts", kind: "delete" }]);

    // Vitest's related walk drops edges to missing files; the adapter adds the importers back.
    expect(paths(await fx.adapter.affected(["src/deep.ts"]))).toEqual([
      "test/each.test.ts",
      "test/math.test.ts",
    ]);

    const report = await fx.adapter.run([ref("test/math.test.ts")], fx.runOptions());
    expect(report.end).toBe("completed");
    expect(report.results).toEqual([]);
    expect(report.completedFiles).toEqual([ref("test/math.test.ts")]);
    expect(report.fileErrors).toHaveLength(1);
    expect(report.fileErrors[0]?.testFile).toEqual(ref("test/math.test.ts"));
    expect(report.fileErrors[0]?.errors[0]?.message).toMatch(/deep\.ts/);
    expect(report.fileErrors[0]?.errors[0]?.message).not.toContain(fx.root);
  });

  it("a deleted test file disappears from testFiles()", async () => {
    const fx = await openFixture();
    expect(paths(await fx.adapter.testFiles())).toEqual(ALL_TEST_FILES);

    fx.remove("test/strings.test.ts");
    await fx.adapter.invalidate([{ path: "test/strings.test.ts", kind: "delete" }]);

    expect(paths(await fx.adapter.testFiles())).toEqual(
      ALL_TEST_FILES.filter((p) => p !== "test/strings.test.ts"),
    );
    expect(all(await fx.adapter.affected(["test/strings.test.ts", "src/strings.ts"]))).toEqual([]);
  });

  it("a new test file appears in testFiles() and affected()", async () => {
    const fx = await openFixture();
    await fx.adapter.testFiles();

    fx.write(
      "test/new.test.ts",
      [
        'import { expect, it } from "vitest";',
        'import { upper } from "../src/strings.ts";',
        'it("is new", () => expect(upper("n")).toBe("N"));',
        "",
      ].join("\n"),
    );
    await fx.adapter.invalidate([{ path: "test/new.test.ts", kind: "add" }]);

    expect(paths(await fx.adapter.testFiles())).toContain("test/new.test.ts");
    expect(paths(await fx.adapter.affected(["src/strings.ts"]))).toEqual([
      "test/new.test.ts",
      "test/strings.test.ts",
    ]);
    const report = await fx.adapter.run([ref("test/new.test.ts")], fx.runOptions());
    expect(report.results.map((r) => [r.check.fullName, r.outcome])).toEqual([["is new", "pass"]]);
  });

  it("a config change recreates the instance", async () => {
    const fx = await openFixture();
    expect(paths(await fx.adapter.testFiles())).toEqual(ALL_TEST_FILES);

    // vitest.shared.ts is a configFileDependency, not the config file itself.
    fx.write("vitest.shared.ts", 'export const include = ["test/math.test.ts"];\n');
    const result = await fx.adapter.invalidate([{ path: "vitest.shared.ts", kind: "change" }]);

    expect(result.recreatedProjects).toEqual([""]);
    expect(paths(await fx.adapter.testFiles())).toEqual(["test/math.test.ts"]);

    fx.write("vitest.config.ts", fx.read("vitest.config.ts").replace("60_000", "30_000"));
    const again = await fx.adapter.invalidate([{ path: "vitest.config.ts", kind: "change" }]);
    expect(again.recreatedProjects).toEqual([""]);
    const [env] = await fx.adapter.environment();
    expect(JSON.parse(env?.resolvedConfig ?? "{}").testTimeout).toBe(30_000);
  });

  it("a plain source change needs no recreate and the next run sees it", async () => {
    const fx = await openFixture();
    const first = await fx.adapter.run([ref("test/math.test.ts")], fx.runOptions());
    expect(first.results.every((r) => r.outcome === "pass")).toBe(true);

    fx.write("src/deep.ts", "export const base = 20;\n");
    const result = await fx.adapter.invalidate([{ path: "src/deep.ts", kind: "change" }]);
    expect(result.recreatedProjects).toEqual([]);

    const second = await fx.adapter.run([ref("test/math.test.ts")], fx.runOptions());
    expect(second.results.map((r) => [r.check.fullName, r.outcome])).toEqual([
      ["math > adds", "pass"],
      ["math > adds base", "fail"],
    ]);
  });
});
