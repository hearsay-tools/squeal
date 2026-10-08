import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  nodeTestObservedPreloadsMetaKey,
  observedStore,
} from "../../../src/core/daemon/node-test-runners.js";
import { environmentHash } from "../../../src/core/keys/environment.js";
import type { NodeTestProject, RunnerAdapter } from "../../../src/core/types/index.js";
import { createNodeTestAdapter } from "../../../src/runners/node-test/adapter.js";
import { fakeCommonDir, open } from "../../store/helpers.js";

/**
 * Review wave 2.6, B1: Node splits `NODE_OPTIONS` with double quotes, so
 * `"--require" ./scripts/setup.cjs` and `"--require=./scripts/setup.cjs"`
 * are require preloads that run before the command line's recorder unless
 * the recorder is prepended there too. The helper such a preload loads by a
 * computed `require` is observed, keyed and makes the project's file
 * affected, and a worktree with another helper keys its environment apart.
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

const CORE = {
  squealVersion: "test",
  nodeVersion: process.version,
  platform: process.platform,
  arch: process.arch,
  installedDependencies: "none",
  env: {},
};

async function envHash(adapter: RunnerAdapter, root: string): Promise<string> {
  const [environment] = await adapter.environment();
  if (environment === undefined) throw new Error("no environment");
  return environmentHash(CORE, environment, (path) =>
    createHash("sha256")
      .update(readFileSync(join(root, path)))
      .digest("hex"),
  );
}

describe("a quoted --require in the project's NODE_OPTIONS (review wave 2.6, B1)", () => {
  it.each(['"--require" ./scripts/setup.cjs', '"--require=./scripts/setup.cjs"'])(
    "%s: observed, keyed, affected, and another helper misses",
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
      const store = open(fakeCommonDir());
      const adapter = await createNodeTestAdapter(project, {
        root,
        observed: observedStore(store, "p"),
      });
      const report = await adapter.run([A], {
        runId: "r",
        logDir: join(logs, randomUUID()),
        timeoutMs: 30_000,
      });
      expect(report).toMatchObject({ end: "completed", completedFiles: [A] });
      expect(report.results.map((r) => `${r.check.fullName}: ${r.outcome}`)).toEqual([
        "the preload's helper ran: pass",
      ]);

      expect(JSON.parse(store.meta.get(nodeTestObservedPreloadsMetaKey("p")) ?? "null")).toEqual([
        HELPER,
        SETUP,
      ]);
      expect(await adapter.invalidate([{ path: HELPER, kind: "change" }])).toEqual({
        recreatedProjects: ["p"],
      });
      expect((await adapter.environment())[0]?.files).toEqual([HELPER, SETUP]);
      expect(await adapter.affected([HELPER])).toEqual({ direct: [], transitive: [A] });

      // A second worktree over the same store, its helper different: its environment misses.
      const same = repo("globalThis.helperValue = 1;\n");
      const other = repo("globalThis.helperValue = 2;\n");
      const open_ = (at: string) =>
        createNodeTestAdapter(project, { root: at, observed: observedStore(store, "p") });
      const base = await envHash(adapter, root);
      expect(await envHash(await open_(same), same)).toBe(base);
      expect(await envHash(await open_(other), other)).not.toBe(base);
    },
  );
});
