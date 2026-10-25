import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { NodeTestProject } from "../../../src/core/types/index.js";
import { createNodeTestAdapter } from "../../../src/runners/node-test/adapter.js";

/**
 * Review wave 2.6, B1: Node splits `NODE_OPTIONS` with double quotes, so
 * `"--require" ./scripts/setup.cjs` and `"--require=./scripts/setup.cjs"`
 * are require preloads that run before the command line's recorder unless
 * the recorder is prepended there too. The helper such a preload loads by a
 * computed `require` is observed and named in the run's
 * `environmentObserved`; the core keys it, and a worktree with another
 * helper keys its environment apart (spec 016 D4;
 * `test/scheduler/one-write-path.test.ts`).
 * Task 003-22: the graph reads `NODE_OPTIONS` too, so the preload itself is
 * in the static closure and only its helper is observed.
 */

const FIXTURES = resolve(import.meta.dirname, "../../fixtures/node-test");
const SLOW = { timeout: 60_000 } as const;
const scratch = join(FIXTURES, ".tmp", randomUUID());
const logs = mkdtempSync(join(tmpdir(), "squeal-node-test-quoted-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(logs, { recursive: true, force: true });
});

const HELPER = "scripts/helper.cjs";
const SETUP = "scripts/setup.cjs";
const A = { project: "p", path: "test/a.test.mjs" };

function repo(helper: string): string {
  const files: Record<string, string> = {
    "package.json": `${JSON.stringify({ name: "quoted", private: true, type: "module" })}\n`,
    [SETUP]: `require("./helper" + ".cjs");\n`,
    [HELPER]: helper,
    [A.path]: [
      `import assert from "node:assert/strict";`,
      `import { test } from "node:test";`,
      `test("the preload's helper ran", () => assert.equal(globalThis.helperValue, 1));`,
      "",
    ].join("\n"),
  };
  const dir = join(scratch, randomUUID());
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return realpathSync(dir);
}

describe("a quoted --require in the project's NODE_OPTIONS (review wave 2.6, B1)", () => {
  it.each(['"--require" ./scripts/setup.cjs', '"--require=./scripts/setup.cjs"'])(
    "%s: observed and reported",
    SLOW,
    async (nodeOptions) => {
      const root = repo("globalThis.helperValue = 1;\n");
      const project: NodeTestProject = {
        name: "p",
        node: process.execPath,
        argv: [],
        env: { NODE_OPTIONS: nodeOptions },
        include: ["test/*.test.mjs"],
      };
      const adapter = await createNodeTestAdapter(project, { root });
      const report = await adapter.run([A], {
        runId: "r",
        logDir: join(logs, randomUUID()),
        timeoutMs: 30_000,
      });
      expect(report).toMatchObject({ end: "completed", completedFiles: [A] });
      expect(report.results.map((r) => `${r.check.fullName}: ${r.outcome}`)).toEqual([
        "the preload's helper ran: pass",
      ]);

      expect(report.environmentObserved).toEqual([{ project: "p", paths: [HELPER] }]);
      // the preload itself is in the static closure (task 003-22)
      expect((await adapter.environment())[0]?.files).toEqual(["package.json", SETUP]);
    },
  );
});
