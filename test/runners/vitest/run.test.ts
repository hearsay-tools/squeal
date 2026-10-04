import { readdirSync, readFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openFixture, ref, SLOW } from "./helpers.js";

const MAX_LOAD_FOR_TIMING = 8;
const WARM_RUN_BUDGET_MS = 400;

describe("vitest adapter: run()", SLOW, () => {
  it("reads results only from reporter hooks: a module from an earlier run never appears", async () => {
    const fx = await openFixture();
    fx.write("src/deep.ts", "export const base = 99;\n");
    await fx.adapter.invalidate([{ path: "src/deep.ts", kind: "change" }]);
    const first = await fx.adapter.run([ref("test/math.test.ts")], fx.runOptions());
    expect(first.results.some((r) => r.outcome === "fail")).toBe(true);

    // Vitest's cumulative TestRunResult would still contain the failed math.test.ts module.
    const second = await fx.adapter.run([ref("test/strings.test.ts")], fx.runOptions());
    expect(second.end).toBe("completed");
    expect(second.completedFiles).toEqual([ref("test/strings.test.ts")]);
    expect(second.fileErrors).toEqual([]);
    expect(second.results.map((r) => [r.check.testPath, r.check.fullName, r.outcome])).toEqual([
      ["test/strings.test.ts", "uppercases", "pass"],
      ["test/strings.test.ts", "matches snapshot", "pass"],
    ]);
  });

  it("maps a failed assertion to a fail with relativized errors and locations", async () => {
    const fx = await openFixture();
    fx.write("src/deep.ts", "export const base = 99;\n");
    await fx.adapter.invalidate([{ path: "src/deep.ts", kind: "change" }]);
    const report = await fx.adapter.run([ref("test/math.test.ts")], fx.runOptions());

    const failed = report.results.find((r) => r.outcome === "fail");
    expect(failed?.check).toEqual({
      kind: "test",
      project: "",
      testPath: "test/math.test.ts",
      fullName: "math > adds base",
    });
    expect(failed?.location).toEqual({ path: "test/math.test.ts", line: 9, column: 3 });
    expect(failed?.durationMs).toBeGreaterThanOrEqual(0);
    const error = failed?.errors[0];
    expect(error?.name).toBe("AssertionError");
    expect(error?.message).toContain("expected 100 to be 11");
    expect(error?.location).toEqual({ path: "test/math.test.ts", line: 10, column: 24 });
    expect(error?.diff).toBeTypeOf("string");
    expect(error?.stack).toContain("test/math.test.ts:10:24");
    expect(JSON.stringify(report)).not.toContain(fx.root);

    const passed = report.results.find((r) => r.outcome === "pass");
    expect(passed?.errors).toEqual([]);
  });

  it("reports a syntax error in a test file as a file-level error", async () => {
    const fx = await openFixture();
    fx.write("test/bad.test.ts", 'import { it } from "vitest";\nit("x", () => { (;\n');
    await fx.adapter.invalidate([{ path: "test/bad.test.ts", kind: "add" }]);
    const report = await fx.adapter.run(
      [ref("test/bad.test.ts"), ref("test/strings.test.ts")],
      fx.runOptions(),
    );
    expect(report.end).toBe("completed");
    expect(report.completedFiles).toEqual([ref("test/bad.test.ts"), ref("test/strings.test.ts")]);
    expect(report.fileErrors.map((e) => e.testFile)).toEqual([ref("test/bad.test.ts")]);
    expect(report.fileErrors[0]?.errors[0]?.message).toMatch(/Unexpected token|PARSE_ERROR/);
    expect(report.results.every((r) => r.check.testPath === "test/strings.test.ts")).toBe(true);
  });

  it("maps skip and todo to skip", async () => {
    const fx = await openFixture();
    fx.write(
      "test/skips.test.ts",
      'import { it } from "vitest";\nit.skip("skipped", () => {});\nit.todo("later");\nit("runs", () => {});\n',
    );
    await fx.adapter.invalidate([{ path: "test/skips.test.ts", kind: "add" }]);
    const report = await fx.adapter.run([ref("test/skips.test.ts")], fx.runOptions());
    expect(report.results.map((r) => [r.check.fullName, r.outcome])).toEqual([
      ["skipped", "skip"],
      ["later", "skip"],
      ["runs", "pass"],
    ]);
  });

  it("writes full output under logDir and restores process.exitCode", async () => {
    const fx = await openFixture();
    fx.write(
      "test/noisy.test.ts",
      'import { expect, it } from "vitest";\nit("logs", () => { console.log("hello from the test"); expect(1).toBe(2); });\n',
    );
    await fx.adapter.invalidate([{ path: "test/noisy.test.ts", kind: "add" }]);
    const previous = process.exitCode;
    const options = fx.runOptions();
    const report = await fx.adapter.run([ref("test/noisy.test.ts")], options);
    expect(process.exitCode).toBe(previous);
    expect(report.results.map((r) => r.outcome)).toEqual(["fail"]);

    expect(readdirSync(options.logDir).sort()).toEqual(["report.json", "vitest.log"]);
    const log = readFileSync(join(options.logDir, "vitest.log"), "utf8");
    expect(log).toContain("hello from the test");
    expect(log).toContain("FAIL test/noisy.test.ts > logs");
    expect(log).toContain("expected 1 to be 2");
    const saved = JSON.parse(readFileSync(join(options.logDir, "report.json"), "utf8"));
    expect(saved.runId).toBe(options.runId);
    expect(saved.report.results).toHaveLength(1);
  });

  it("honours timeoutMs, keeps finished files and stays usable", async () => {
    const fx = await openFixture();
    fx.write(
      "test/spin.test.ts",
      'import { it } from "vitest";\nit("spins", () => { while (true) {} });\n',
    );
    await fx.adapter.invalidate([{ path: "test/spin.test.ts", kind: "add" }]);

    const started = performance.now();
    const report = await fx.adapter.run(
      [ref("test/spin.test.ts")],
      fx.runOptions({ timeoutMs: 1_500 }),
    );
    const elapsed = performance.now() - started;
    expect(report.end).toBe("timed-out");
    expect(report.failure).toMatch(/1500 ms/);
    expect(report.completedFiles).toEqual([]);
    expect(report.results).toEqual([]);
    expect(elapsed).toBeLessThan(15_000);

    const next = await fx.adapter.run([ref("test/strings.test.ts")], fx.runOptions());
    expect(next.end).toBe("completed");
    expect(next.results.map((r) => r.outcome)).toEqual(["pass", "pass"]);
  });

  it("runs one file on a warm instance within the budget", async (ctx) => {
    const fx = await openFixture();
    await fx.adapter.run([ref("test/math.test.ts")], fx.runOptions());
    fx.write("src/deep.ts", "export const base = 10;\n");
    await fx.adapter.invalidate([{ path: "src/deep.ts", kind: "change" }]);

    const timings: number[] = [];
    for (let i = 0; i < 3; i++) {
      const started = performance.now();
      const report = await fx.adapter.run([ref("test/math.test.ts")], fx.runOptions());
      timings.push(Math.round(performance.now() - started));
      expect(report.end).toBe("completed");
    }
    const best = Math.min(...timings);
    const load = loadavg()[0] ?? 0;
    console.log(
      `warm one-file run: ${timings.join(", ")} ms (best ${best} ms), load average ${load.toFixed(1)}`,
    );
    if (load > MAX_LOAD_FOR_TIMING) {
      ctx.skip(`load average ${load.toFixed(1)} > ${MAX_LOAD_FOR_TIMING}; measured ${best} ms`);
    }
    expect(best).toBeLessThan(WARM_RUN_BUDGET_MS);
  });
});
