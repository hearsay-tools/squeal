import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixture, git, ref } from "../commit/at-keys-fixture.js";
import { prove } from "./proof-kit.js";
import { clean, testOf } from "./status-at-kit.js";

/*
 * Row 023-11, done-when; spec 023 D5.4: `squeal proof --repeat`, on
 * `$TMPDIR` git fixtures with the real Vitest adapter. A flaky test counts
 * its runs in a file the command's environment names (`PROOF_COUNTER`)
 * and fails on one of them, so which run fails is fixed.
 */

const TEST = ref("test/a.test.ts");
const ON = { "squeal.config.json": "{}\n" };

/** A test of `../src/a`'s `value` that fails on its `failOn`th run, counted across runs. */
function flaky(failOn: number, expected: number): string {
  return [
    'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
    'import { expect, it } from "vitest";',
    'import { value } from "../src/a";',
    'it("value", () => {',
    '  const path = process.env.PROOF_COUNTER ?? "";',
    '  const n = (existsSync(path) ? Number(readFileSync(path, "utf8")) : 0) + 1;',
    "  writeFileSync(path, String(n));",
    `  expect(n === ${failOn} ? -1 : value).toBe(${expected});`,
    "});",
    "",
  ].join("\n");
}

describe("squeal proof --repeat (row 023-11, D5.4)", { timeout: 300_000 }, () => {
  it("catches a flaky red side on a later run, and runs green every time", async () => {
    // The old test fails on its second run only; the new one always passes.
    const f = fixture({ ...ON, "src/a.ts": "export const value = 2;\n", [TEST.path]: flaky(2, 2) });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ [TEST.path]: testOf("a", 2) });
    const env = { ...process.env, PROOF_COUNTER: join(f.dir, "counter") };
    const args = { files: [TEST.path], base: a, case: "test" as const, repeat: 3 };
    const result = await prove(f, args, undefined, env);
    expect(result.code, result.err).toBe(0);
    expect(result.report.repeat).toBe(3);
    expect(result.files[0]).toMatchObject({
      verdict: "proven",
      red: { end: "fail", from: "run", stored: false, runs: 2 },
      green: { end: "pass", from: "run", stored: false, runs: 3 },
    });
    expect(result.files[0]?.red.notStored).toBe("a repeated side is not stored");
    expect(result.files[0]?.red.failures[0]?.text).toContain("expected -1 to be 2");
    expect(result.report.runs).toBe(5);
    clean(f);
  });

  it("reads not green when the green side fails on one of its runs", async () => {
    // The new test fails on its third run: red's first, then green's second.
    const f = fixture({ ...ON, "src/a.ts": "export const value = 1;\n" });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/a.ts": "export const value = 2;\n", [TEST.path]: flaky(3, 2) });
    const env = { ...process.env, PROOF_COUNTER: join(f.dir, "counter") };
    const args = { files: [TEST.path], base: a, repeat: 3, json: false };
    const text = await prove(f, args, undefined, env);
    expect(text.code, text.err).toBe(1);
    expect(text.out).toContain("test/a.test.ts: not green (the green side failed)");
    expect(text.out).toContain("Repeat 3: red up to 3 runs to its first failure, green 3 runs.");
    expect(text.out).toContain(
      "green: fail, run by this command, not stored (a repeated side is not stored), 2 runs",
    );
    expect(text.out).toContain("; 3 runs (");
    clean(f);
  });

  it("reads not comparable (budget) with a rerun line when the budget leaves a run not started", async () => {
    const f = fixture({
      ...ON,
      "src/a.ts": "export const value = 2;\n",
      [TEST.path]: testOf("a", 3),
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ [TEST.path]: testOf("a", 2) });
    const args = { files: [TEST.path], base: a, case: "test" as const, timeoutSeconds: 1 };
    const result = await prove(f, args);
    expect(result.code, result.err).toBe(3);
    expect(result.files[0]).toMatchObject({
      verdict: "not comparable",
      reason: "budget",
      red: { end: "unknown", reason: "not run (budget)", runs: 0 },
    });
    expect(result.report).toMatchObject({
      runs: 0,
      notRun: 1,
      rerun: `squeal proof test/a.test.ts --base ${a} --case test --timeout 60`,
    });
    const text = await prove(f, { ...args, json: false });
    expect(text.out).toContain(
      `1 not run (budget). A rerun that fits: squeal proof test/a.test.ts --base ${a} --case test --timeout 60`,
    );
    clean(f);
  });
});
