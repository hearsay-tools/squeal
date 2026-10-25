import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { NodeTestProject } from "../../../src/core/types/index.js";
import { createNodeTestAdapter } from "../../../src/runners/node-test/adapter.js";

/**
 * Review wave 2.5, B1: Node runs every `--require` preload before any
 * `--import`, so a recorder installed by `--import` missed what a `--require`
 * preload loads. Squeal's recorder is the first `--require` (task 003-28):
 * a helper a `--require` preload loads by a computed `require` is observed
 * and named in the run's `environmentObserved`, which the core keys in the
 * environment (spec 016 D4; `test/scheduler/one-write-path.test.ts`). The
 * review's probe, a nested preload, a package preload under `node_modules`
 * loading a worktree file, and one from the project's `NODE_OPTIONS`.
 */

const FIXTURES = resolve(import.meta.dirname, "../../fixtures/node-test");
const SLOW = { timeout: 60_000 } as const;
const scratch = join(FIXTURES, ".tmp", randomUUID());
const logs = mkdtempSync(join(tmpdir(), "squeal-node-test-require-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(logs, { recursive: true, force: true });
});

const HELPER = "scripts/helper.cjs";
const TEST = [
  `import assert from "node:assert/strict";`,
  `import { test } from "node:test";`,
  `test("the preload's helper ran", () => assert.equal((globalThis as { helperValue?: number }).helperValue, 1));`,
  "",
].join("\n");

interface Case {
  readonly name: string;
  readonly argv: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly files: Readonly<Record<string, string>>;
  /** `environment().files` before any run: the preloads' static closure. */
  readonly before: readonly string[];
  /** The observed preload paths the run reports; default the helper alone. */
  readonly observed?: readonly string[];
}

const CASES: readonly Case[] = [
  {
    name: "the review's probe: a --require preload's computed require",
    argv: ["--require", "./scripts/setup.cjs"],
    files: { "scripts/setup.cjs": `require("./helper" + ".cjs");\n` },
    before: ["package.json", "scripts/setup.cjs"],
  },
  {
    name: "a --require preload requiring one that loads the helper",
    argv: ["--require", "./scripts/setup.cjs"],
    files: {
      "scripts/setup.cjs": `require("./inner.cjs");\n`,
      "scripts/inner.cjs": `require("./helper" + ".cjs");\n`,
    },
    before: ["package.json", "scripts/inner.cjs", "scripts/setup.cjs"],
  },
  {
    name: "a --require of a package under node_modules that loads a worktree file",
    argv: ["--require", "preload-pkg"],
    files: {
      "node_modules/preload-pkg/package.json": `${JSON.stringify({ name: "preload-pkg", main: "index.cjs" })}\n`,
      "node_modules/preload-pkg/index.cjs": `require(process.cwd() + "/scripts/helper" + ".cjs");\n`,
    },
    before: ["package.json"],
  },
  {
    name: "a --require in the project's NODE_OPTIONS",
    argv: [],
    env: { NODE_OPTIONS: "--require ./scripts/setup.cjs" },
    files: { "scripts/setup.cjs": `require("./helper" + ".cjs");\n` },
    // Task 003-22: the graph reads `NODE_OPTIONS`, so only the helper is observed.
    before: ["package.json", "scripts/setup.cjs"],
  },
];

function repo(c: Case): string {
  const files: Record<string, string> = {
    "package.json": `${JSON.stringify({ name: "preload", private: true, type: "module" })}\n`,
    [HELPER]: "globalThis.helperValue = 1;\n",
    "test/a.test.ts": TEST,
    ...c.files,
  };
  const dir = join(scratch, randomUUID());
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return realpathSync(dir);
}

const A = { project: "p", path: "test/a.test.ts" };

describe("a path a --require preload loads at run time (review wave 2.5, B1)", () => {
  it.each(CASES)("$name: observed and reported", SLOW, async (c) => {
    const root = repo(c);
    const project: NodeTestProject = {
      name: "p",
      node: process.execPath,
      argv: [...c.argv, "--import", "tsx"],
      env: c.env ?? {},
      include: ["test/*.test.ts"],
    };
    const adapter = await createNodeTestAdapter(project, { root });
    expect((await adapter.environment())[0]?.files).toEqual(c.before);

    const report = await adapter.run([A], {
      runId: "r",
      logDir: join(logs, randomUUID()),
      timeoutMs: 30_000,
    });
    expect(report).toMatchObject({ end: "completed", completedFiles: [A] });
    expect(report.results).toEqual([
      expect.objectContaining({
        check: expect.objectContaining({ fullName: "the preload's helper ran" }),
        outcome: "pass",
      }),
    ]);

    // The helper is an observed preload path: the run names it, for the core to keep and key.
    expect(report.environmentObserved).toEqual([{ project: "p", paths: c.observed ?? [HELPER] }]);
    expect(report.observed?.[0]?.paths).not.toContain(HELPER);
  });
});
