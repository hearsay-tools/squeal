import { describe, expect, it } from "vitest";
import { fixture, git, ref } from "../commit/at-keys-fixture.js";
import { prove } from "./proof-kit.js";
import { clean } from "./status-at-kit.js";

/*
 * Row 023-20, lessons P9: under a condition, the red side also runs once
 * without it, and the report says whether red needs the condition. On
 * `$TMPDIR` git fixtures with the real Vitest adapter; the
 * `proof-conditions.test.ts` cases cover "red only under the conditions"
 * with each condition.
 */

const TEST = ref("test/a.test.ts");
const CODE = {
  "squeal.config.json": "{}\n",
  "src/a.ts": 'export const greeting = (name: string) => "hello " + (name || "world");\n',
};

/** A test that greets `PROOF_NAME`, or `fallback` without it, and expects "hello ada". */
function greets(fallback: string): string {
  return [
    'import { expect, it } from "vitest";',
    'import { greeting } from "../src/a";',
    'it("greets", () => {',
    `  expect(greeting(process.env.PROOF_NAME ?? ${JSON.stringify(fallback)})).toBe("hello ada");`,
    "});",
    "",
  ].join("\n");
}

/** Commit A holds the old test; HEAD a new one that always passes. */
function fix(old: string) {
  const f = fixture({ ...CODE, [TEST.path]: old });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ [TEST.path]: greets("ada").replace("process.env.PROOF_NAME ?? ", "") });
  return { f, a };
}

describe("squeal proof control run without the conditions (row 023-20, P9)", {
  timeout: 240_000,
}, () => {
  it("reads 'red without them too' when the old test fails without the condition as well", async () => {
    // The old test fails whatever PROOF_NAME is: it expects ada and falls back to bob.
    const { f, a } = fix(greets("bob"));
    const env = { ...process.env, PROOF_NAME: "bob" };
    const args = {
      files: [TEST.path],
      base: a,
      case: "dependency" as const,
      env: [{ name: "PROOF_NAME", value: null }],
    };
    const result = await prove(f, args, undefined, env);
    expect(result.code, result.why).toBe(0);
    expect(result.files[0]).toMatchObject({
      verdict: "proven",
      reason: "red without the conditions too: the conditions are not shown to matter",
      red: { end: "fail", stored: false },
      control: { end: "fail", from: "run", stored: true, runs: 1 },
      controlReading: "red without them too",
      green: { end: "pass" },
    });
    clean(f);

    const text = await prove(f, { ...args, json: false }, undefined, env);
    expect(text.out).toContain(
      "test/a.test.ts: proven (red without the conditions too: the conditions are not shown to matter)\n",
    );
    expect(text.out).toContain("  red without them too (without them: fail, stored result)\n");
    clean(f);
  });

  it("runs the control under --repeat's red rule: up to n runs, none stored", async () => {
    // The old test passes only with PROOF_NAME=ada, which the command's environment sets.
    const { f, a } = fix(greets(""));
    const env = { ...process.env, PROOF_NAME: "ada" };
    const args = {
      files: [TEST.path],
      base: a,
      case: "dependency" as const,
      env: [{ name: "PROOF_NAME", value: null }],
      repeat: 2,
    };
    const result = await prove(f, args, undefined, env);
    expect(result.code, result.why).toBe(0);
    expect(result.files[0]).toMatchObject({
      verdict: "proven",
      reason: null,
      red: { end: "fail", runs: 1 },
      control: { end: "pass", from: "run", stored: false, runs: 2 },
      controlReading: "red only under the conditions",
      green: { end: "pass", runs: 2 },
    });
    // Red once (its first failure), the control twice, green twice.
    expect(result.report.runs).toBe(5);
    clean(f);
  });

  it("says why the control did not run when the red side passed under the condition", async () => {
    const { f, a } = fix(greets("ada"));
    const args = {
      files: [TEST.path],
      base: a,
      case: "dependency" as const,
      env: [{ name: "PROOF_NAME", value: null }],
    };
    const result = await prove(f, args);
    expect(result.code, result.why).toBe(1);
    expect(result.files[0]).toMatchObject({
      verdict: "not red",
      control: null,
      controlNotRun: "red passed: nothing to prove",
      greenNotRun: "red passed: nothing to prove",
    });
    expect(result.report.runs).toBe(1);
    clean(f);
  });
});
