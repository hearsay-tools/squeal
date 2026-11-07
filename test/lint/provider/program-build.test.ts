import { cpSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LintRunReport } from "../../../src/core/lint/pass/provider.js";
import { cli, FIXTURES, onDisk, project, provider, read, workerScript, write } from "./helpers.js";

/*
 * Row 017-18 (`lessons.md` L4): D3's per-file guard starts after the worker
 * built TypeScript's program, and the build has the start budget. The
 * guard is 1 s here for D3's 5 s, and the build sleeps 2 s in
 * `slow-program-worker.ts`: longer than the guard, with no CPU load.
 */

/** Equal to the sleep in `slow-program-worker.ts`. */
const SLOW_PROGRAM_MS = 2_000;
const GUARD_MS = 1_000;
const START_MS = 15_000;

/** The typed fixture, its TypeScript files also under the hazard rule. */
function typed(): string {
  const root = project("project");
  cpSync(join(FIXTURES, "hazard/eslint/hazard.js"), join(root, "eslint/hazard.js"));
  const config = read(root, "eslint.config.js");
  const end = config.lastIndexOf("];");
  write(
    root,
    "eslint.config.js",
    `import hazard from "./eslint/hazard.js";\n${config.slice(0, end)}` +
      `  { files: ["**/*.ts"], plugins: { hazard }, rules: { "hazard/act": "error" } },\n];\n`,
  );
  return root;
}

async function slow(root: string, startMs = START_MS) {
  const eslint = provider(root, {
    script: workerScript("test/lint/provider/slow-program-worker.ts"),
    guardMs: GUARD_MS,
    loadGuardMs: startMs,
  });
  expect(await eslint.open()).toHaveProperty("tool", "eslint");
  expect(await eslint.refresh("none")).toHaveProperty("closure");
  return eslint;
}

describe("a cold typed worker (row 017-18)", () => {
  it("whose program takes longer than the guard to build gives the CLI's result", async () => {
    const root = typed();
    const eslint = await slow(root);
    const started = performance.now();
    const alone = (await eslint.lint(onDisk(root, ["src/t.ts"]))) as LintRunReport;
    // The build was in this call, and longer than the guard.
    expect(performance.now() - started).toBeGreaterThan(SLOW_PROGRAM_MS);
    const files = ["src/t.ts", "src/u.ts"];
    const expected = cli(root, files);
    expect(alone.results).toEqual(new Map([["src/t.ts", expected.get("src/t.ts")]]));
    const both = (await eslint.lint(onDisk(root, files))) as LintRunReport;
    expect(both.results).toEqual(expected);
  }, 60_000);

  it("whose first lint blocks after the build times out at the guard, not the start budget", async () => {
    const root = typed();
    const eslint = await slow(root);
    const blocked = { path: "src/t.ts", text: `// HAZARD_BLOCK\n${read(root, "src/t.ts")}` };
    const started = performance.now();
    const report = (await eslint.lint([blocked])) as LintRunReport;
    const took = performance.now() - started;
    expect(report.results).toEqual(new Map([["src/t.ts", { unknown: "timed out after 1 s" }]]));
    expect(took).toBeGreaterThan(SLOW_PROGRAM_MS);
    expect(took).toBeLessThan(START_MS);
    // A new worker lints the next call, its program built again.
    const next = (await eslint.lint(onDisk(root, ["src/t.ts"]))) as LintRunReport;
    expect(next.results).toEqual(new Map([["src/t.ts", cli(root, ["src/t.ts"]).get("src/t.ts")]]));
  }, 60_000);

  it("whose build outlasts the start budget reads unknown, the reason naming the build", async () => {
    const root = typed();
    const eslint = await slow(root, 1_500);
    const report = (await eslint.lint(onDisk(root, ["src/t.ts"]))) as LintRunReport;
    expect(report.results).toEqual(
      new Map([
        [
          "src/t.ts",
          { unknown: "timed out after 1.5 s building TypeScript's program for src/t.ts" },
        ],
      ]),
    );
  }, 60_000);
});
