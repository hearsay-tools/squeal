import { randomUUID } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { NodeTestProject } from "../../../src/core/types/index.js";
import { createNodeTestAdapter } from "../../../src/runners/node-test/adapter.js";
import type { NodeTestRuntime } from "../../../src/runners/node-test/runtime.js";

/**
 * Row 004-32 (lessons.md defect 7, last point): two daemons of one Squeal
 * version installed at different paths key a project alike, so a result
 * inherits across them. The recorder's `--require` and the reporter's
 * `--test-reporter` are Squeal's own, keyed by the adapter's version only:
 * neither enters `resolvedConfig`, and what they load lies outside the
 * worktree, so no observed path names them. A slow project's spawned
 * process, which gets the recorder through `NODE_OPTIONS`, keys alike too.
 */

/** The runtime the adapter's runs use, standing in for the plugin root it runs from. */
const where = vi.hoisted(() => ({ runtime: null as NodeTestRuntime | null }));
vi.mock("../../../src/runners/node-test/runtime.js", () => ({
  nodeTestRuntime: () => {
    if (where.runtime === null) throw new Error("no plugin root set");
    return where.runtime;
  },
}));

const FIXTURES = resolve(import.meta.dirname, "../../fixtures/node-test");
const RUNTIME = resolve(import.meta.dirname, "../../../src/runners/node-test/runtime");
const SLOW = { timeout: 60_000 } as const;
const scratch = join(FIXTURES, ".tmp", randomUUID());
const plugins = mkdtempSync(join(tmpdir(), "squeal-node-test-plugin-root-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(plugins, { recursive: true, force: true });
});

/** A copy of the runtime files where a plugin's `dist` puts them. */
function plugin(name: string): NodeTestRuntime {
  const dir = join(plugins, name, "dist", "node-test");
  cpSync(RUNTIME, dir, { recursive: true });
  return { reporter: join(dir, "reporter.mjs"), recorder: join(dir, "recorder.cjs") };
}

function repo(files: Readonly<Record<string, string>>): string {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(scratch, path)), { recursive: true });
    writeFileSync(join(scratch, path), text);
  }
  return realpathSync(scratch);
}

const project: NodeTestProject = {
  name: "p",
  node: process.execPath,
  argv: ["--import", "./scripts/setup.mjs"],
  env: {},
  include: ["test/*.test.mjs"],
  slow: true,
};

describe("Squeal's plugin root (row 004-32)", () => {
  it("keys the same project alike under two plugin roots", SLOW, async () => {
    const root = repo({
      "package.json": `${JSON.stringify({ name: "roots", private: true, type: "module" })}\n`,
      "scripts/setup.mjs": `await import("./marker" + ".mjs");\n`,
      "scripts/marker.mjs": "globalThis.marked = true;\n",
      "bin/tool.mjs": `import "../lib/tool-lib.mjs";\n`,
      "lib/tool-lib.mjs": "export const tool = 1;\n",
      "test/a.test.mjs": [
        `import { execFileSync } from "node:child_process";`,
        `import { test } from "node:test";`,
        `test("spawns", () => execFileSync(process.execPath, ["bin/tool.mjs"]));`,
        "",
      ].join("\n"),
    });
    const keyed = async (runtime: NodeTestRuntime) => {
      where.runtime = runtime;
      const adapter = await createNodeTestAdapter(project, { root });
      const testFile = { project: "p", path: "test/a.test.mjs" };
      const logDir = join(plugins, "logs", randomUUID());
      const report = await adapter.run([testFile], { runId: "r", logDir, timeoutMs: 30_000 });
      expect(report).toMatchObject({ end: "completed", completedFiles: [testFile] });
      const log = readFileSync(join(logDir, "node-test", "p", "run.json"), "utf8");
      expect(JSON.parse(log).files[0].command).toContain(runtime.recorder);
      return { environment: await adapter.environment(), closure: await adapter.closure(testFile) };
    };
    const first = await keyed(plugin("0.1.58-a"));
    expect(first.closure.paths).toContain("lib/tool-lib.mjs");
    expect(first.environment[0]?.files).toContain("scripts/marker.mjs");
    expect(await keyed(plugin("0.1.58-b"))).toEqual(first);
  });
});
