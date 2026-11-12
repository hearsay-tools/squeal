import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GateReport } from "../../src/core/code/gate/report.js";
import { code, edit, ownHomeAndTmp, repo, SLOW } from "./code-gate-fixture.js";

/*
 * Spec 020 D3.1 as amended 2026-11-12 (row 020-35, #194; research
 * `issue-194-gaps.md` G4): `squeal code --base` selects a test file whose
 * declared `inputs` at the base name a changed path, as the daemon re-runs
 * it. `scripts/release.mjs` runs only in a child process that
 * `test/e2e/release.test.mjs` starts, after the entry's `prepare` built
 * `dist/`; no test imports it. With `coverage.children` at the base, the
 * child's record measures `publish`.
 */

// Under a daemon that measures this file's children, the fixture's processes would inherit the variable.
beforeEach(() => {
  vi.stubEnv("NODE_V8_COVERAGE", undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const lines = (...text: string[]) => `${text.join("\n")}\n`;

const release = (guard: string) =>
  lines(
    'import { pathToFileURL } from "node:url";',
    "export function publish(names, dryRun) {",
    "  const done = [];",
    "  for (const name of names) {",
    '    if (name.startsWith("@private/")) continue;',
    guard,
    '    done.push((dryRun ? "would publish " : "published ") + name);',
    "  }",
    "  return done;",
    "}",
    "if (import.meta.url === pathToFileURL(process.argv[1]).href) {",
    "  const args = process.argv.slice(2);",
    '  const names = args.filter((a) => a !== "--dry-run");',
    '  process.stdout.write(JSON.stringify(publish(names, args.includes("--dry-run"))));',
    "}",
  );

/** Two node:test entries, as in #194: `unit`, and `e2e` with a `prepare` that builds `dist/`. */
function files(inputs: Record<string, readonly string[]>): Record<string, string> {
  const config = {
    coverage: { children: true },
    inputs,
    nodeTest: [
      { name: "unit", include: ["test/unit/*.test.mjs"] },
      {
        name: "e2e",
        include: ["test/e2e/*.test.mjs"],
        prepare: { command: ["node", "scripts/build.mjs"], timeoutSeconds: 60 },
      },
    ],
  };
  return {
    "package.json": `${JSON.stringify({ name: "gate-inputs", private: true, type: "module" })}\n`,
    ".gitignore": "dist/\n",
    "squeal.config.json": `${JSON.stringify(config)}\n`,
    "scripts/build.mjs": lines(
      'import { mkdirSync, writeFileSync } from "node:fs";',
      'mkdirSync("dist", { recursive: true });',
      'writeFileSync("dist/stamp.json", "{}\\n");',
    ),
    "scripts/release.mjs": release("    // no guard"),
    "test/unit/ok.test.mjs": lines(
      'import assert from "node:assert/strict";',
      'import test from "node:test";',
      'test("ok", () => assert.equal(1 + 1, 2));',
    ),
    "test/e2e/release.test.mjs": lines(
      'import assert from "node:assert/strict";',
      'import { execFileSync } from "node:child_process";',
      'import { existsSync } from "node:fs";',
      'import test from "node:test";',
      'import { fileURLToPath } from "node:url";',
      'const script = fileURLToPath(new URL("../../scripts/release.mjs", import.meta.url));',
      'test("release publishes public packages", () => {',
      '  assert.ok(existsSync("dist/stamp.json"), "run the build first");',
      '  const out = execFileSync(process.execPath, [script, "a", "@private/b", "--dry-run"], { encoding: "utf8" });',
      '  assert.deepEqual(JSON.parse(out), ["would publish a"]);',
      "});",
    ),
  };
}

/** The branch edits only `publish`, as #194's did; the tests and the config stay as at the base. */
async function gate(inputs: Record<string, readonly string[]>) {
  const leftInTmp = ownHomeAndTmp();
  const root = repo(files(inputs));
  edit(root, {
    "scripts/release.mjs": release('    if (name === "") throw new Error("empty name");'),
  });
  const ran = await code(root, ["--base", "main", "--json"]);
  const report = JSON.parse(ran.stdout) as GateReport;
  const told = ran.stderr
    .split("\n")
    .filter((line) => /^squeal code: no (selected|test) /.test(line));
  const selection = ran.stderr.split("\n").filter((l) => l.startsWith("squeal code: node:test: "));
  return { ran, report, told, selection, leftInTmp };
}

const CHILD_MAY_LOAD =
  "squeal code: no selected test file imports scripts/release.mjs. With coverage.children, it is measured only if a process one of them starts loads it; else its 1 changed function will read incomplete (no-loader). To select a test that starts it, give the test with --test or declare the path for it in inputs at the base; to skip its coverage, name it in coverage.exclude at the base.";

describe("squeal code --base: selection by declared inputs (spec 020 D3.1, row 020-35)", () => {
  it(
    "selects the test a map entry declares the script for, and its child measures it (G4)",
    SLOW,
    async () => {
      const { ran, report, told, selection, leftInTmp } = await gate({
        "test/e2e/*.test.mjs": ["scripts/*.mjs"],
      });

      expect(selection[0]).toBe(
        "squeal code: node:test: 1 test file to run (tests 1); 1 by declared inputs at the base, not by imports: test/e2e/release.test.mjs",
      );
      expect(told).toEqual([CHILD_MAY_LOAD]);
      const [publish] = report.functions;
      expect(report.functions).toHaveLength(1);
      expect(publish).toMatchObject({ qualifiedName: "publish", state: "pass" });
      expect(publish?.loaders.measured).toEqual(["test/e2e/release.test.mjs"]);
      expect(report.runs.map((r) => [r.runner, r.completed])).toEqual([
        ["node-test", ["test/e2e/release.test.mjs"]],
      ]);
      expect(ran.code).toBe(0);
      expect(report.verdict).toBe("pass");
      expect(leftInTmp()).toEqual([]);
    },
  );

  it("runs a test a wrong declaration names and leaves the script no-loader", SLOW, async () => {
    const { ran, report, told, selection } = await gate({
      "test/unit/*.test.mjs": ["scripts/release.mjs"],
    });

    expect(selection[0]).toBe(
      "squeal code: node:test: 1 test file to run (tests 1); 1 by declared inputs at the base, not by imports: test/unit/ok.test.mjs",
    );
    expect(told).toEqual([CHILD_MAY_LOAD]);
    expect(report.runs.map((r) => [r.runner, r.completed])).toEqual([
      ["node-test", ["test/unit/ok.test.mjs"]],
    ]);
    expect(report.functions.map((f) => `${f.qualifiedName} ${f.state} ${f.gap}`)).toEqual([
      "publish incomplete no-loader",
    ]);
    expect(ran.code).toBe(3);
  });
});
