import { describe, expect, it } from "vitest";
import { openFixture, paths, ref, SLOW } from "./helpers.js";

describe("vitest adapter: edge cases", SLOW, () => {
  it("answers affected() while a test file has a syntax error", async () => {
    const fx = await openFixture();
    // Vitest's related walk rejects when a test file fails to transform.
    fx.write("test/broken.test.ts", 'import { it } from "vitest";\nit("x", () => { (;\n');
    await fx.adapter.invalidate([{ path: "test/broken.test.ts", kind: "add" }]);

    expect(paths(await fx.adapter.affected(["src/deep.ts"]))).toEqual([
      "test/each.test.ts",
      "test/math.test.ts",
    ]);
    expect(paths(await fx.adapter.affected(["test/broken.test.ts"]))).toEqual([
      "test/broken.test.ts",
    ]);
    expect((await fx.adapter.closure(ref("test/broken.test.ts"))).paths).toEqual([
      "test/__snapshots__/broken.test.ts.snap",
      "test/broken.test.ts",
    ]);
  });

  it("attributes an unhandled error to the test file that raised it", async () => {
    const fx = await openFixture();
    fx.write(
      "test/unhandled.test.ts",
      [
        'import { it } from "vitest";',
        'it("throws later", () => { setTimeout(() => { throw new Error("late boom"); }, 0); });',
        'it("waits", async () => { await new Promise((r) => setTimeout(r, 50)); });',
        "",
      ].join("\n"),
    );
    await fx.adapter.invalidate([{ path: "test/unhandled.test.ts", kind: "add" }]);
    const report = await fx.adapter.run(
      [ref("test/unhandled.test.ts"), ref("test/strings.test.ts")],
      fx.runOptions(),
    );
    expect(report.fileErrors.map((e) => e.testFile)).toEqual([ref("test/unhandled.test.ts")]);
    expect(report.fileErrors[0]?.errors[0]?.message).toBe("late boom");
  });

  it("runs nothing for an empty list", async () => {
    const fx = await openFixture();
    const report = await fx.adapter.run([], fx.runOptions());
    expect(report).toEqual({
      end: "completed",
      durationMs: 0,
      completedFiles: [],
      results: [],
      fileErrors: [],
      failure: null,
    });
  });

  it("rejects calls after close()", async () => {
    const fx = await openFixture();
    await fx.adapter.close();
    await expect(fx.adapter.testFiles()).rejects.toThrow(/closed/);
  });
});

describe("vitest adapter: projects", SLOW, () => {
  it("keys test files, results and environments by project", async () => {
    const fx = await openFixture("projects");
    expect(await fx.adapter.testFiles()).toEqual([
      ref("test/both.test.ts", "setup"),
      ref("test/both.test.ts", "unit"),
      ref("test/value.unit.test.ts", "unit"),
    ]);
    expect(await fx.adapter.affected(["src/value.ts"])).toEqual([
      ref("test/both.test.ts", "setup"),
      ref("test/both.test.ts", "unit"),
      ref("test/value.unit.test.ts", "unit"),
    ]);
    // A setup dependency affects only the project that declares the setup file.
    expect(await fx.adapter.affected(["src/only-setup.ts"])).toEqual([
      ref("test/both.test.ts", "setup"),
    ]);

    const report = await fx.adapter.run([ref("test/both.test.ts", "unit")], fx.runOptions());
    expect(report.completedFiles).toEqual([ref("test/both.test.ts", "unit")]);
    expect(report.results.map((r) => [r.check.project, r.check.fullName, r.outcome])).toEqual([
      ["unit", "runs in every project", "pass"],
    ]);

    const envs = await fx.adapter.environment();
    expect(envs.map((e) => e.project)).toEqual(["setup", "unit"]);
    expect(envs[0]?.files).toEqual(["src/only-setup.ts", "test/setup.ts", "vitest.config.ts"]);
    expect(envs[1]?.files).toEqual(["vitest.config.ts"]);
  });
});
