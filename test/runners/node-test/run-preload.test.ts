import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { NodeTestProject } from "../../../src/core/types/index.js";
import { runNodeTest } from "../../../src/runners/node-test/run/run.js";
import { nodeTestRuntime } from "../../../src/runners/node-test/runtime.js";

/**
 * The recorder is the first `--require` of a test file's process and, when
 * the project's `NODE_OPTIONS` holds a `--require`, first there too (task
 * 003-28, review wave 2.5 B1): the project's argv follows it unchanged, and
 * the per-file child `node --test` spawns records as well.
 */

const FIXTURES = resolve(import.meta.dirname, "../../fixtures/node-test");
const SLOW = { timeout: 60_000 } as const;
const scratch = join(FIXTURES, ".tmp", randomUUID());
const logs = mkdtempSync(join(tmpdir(), "squeal-node-test-run-preload-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(logs, { recursive: true, force: true });
});

const FILES: Readonly<Record<string, string>> = {
  "package.json": `${JSON.stringify({ name: "run-preload", private: true })}\n`,
  "scripts/argv.cjs": `require("./argv-helper" + ".cjs");\n`,
  "scripts/argv-helper.cjs": "globalThis.argvHelper = 1;\n",
  "scripts/env.cjs": `require("./env-helper" + ".cjs");\n`,
  "scripts/env-helper.cjs": "globalThis.envHelper = 1;\n",
  "test/a.test.cjs": [
    `const assert = require("node:assert/strict");`,
    `const { test } = require("node:test");`,
    `test("both preloads ran", () => assert.deepEqual([globalThis.argvHelper, globalThis.envHelper], [1, 1]));`,
    "",
  ].join("\n"),
};

/** The runtime files copied under a directory whose name `NODE_OPTIONS` must quote. */
function quotedRuntime(): ReturnType<typeof nodeTestRuntime> {
  const source = nodeTestRuntime();
  const dir = join(logs, `a b"c`);
  mkdirSync(dir, { recursive: true });
  const runtime = { reporter: join(dir, "reporter.mjs"), recorder: join(dir, "recorder.cjs") };
  copyFileSync(source.reporter, runtime.reporter);
  copyFileSync(source.recorder, runtime.recorder);
  return runtime;
}

describe("the recorder runs before every preload (task 003-28)", () => {
  it("observes argv and NODE_OPTIONS --require preloads in the test child", SLOW, async () => {
    for (const [path, text] of Object.entries(FILES)) {
      mkdirSync(dirname(join(scratch, path)), { recursive: true });
      writeFileSync(join(scratch, path), text);
    }
    const root = realpathSync(scratch);
    const project: NodeTestProject = {
      name: "p",
      node: process.execPath,
      argv: ["--require", "./scripts/argv.cjs"],
      env: { NODE_OPTIONS: "--require ./scripts/env.cjs" },
      include: ["test/*.test.cjs"],
    };
    const runtime = quotedRuntime();
    const logDir = join(logs, randomUUID());
    const testFile = { project: "p", path: "test/a.test.cjs" };
    const { report, observed } = await runNodeTest({
      root,
      project,
      files: [testFile],
      logDir,
      timeoutMs: 30_000,
      runtime,
    });

    expect(report.results.map((r) => `${r.check.fullName}: ${r.outcome}`)).toEqual([
      "both preloads ran: pass",
    ]);
    expect(observed).toEqual([
      {
        testFile,
        paths: ["test/a.test.cjs"],
        preloadPaths: [
          "scripts/argv-helper.cjs",
          "scripts/argv.cjs",
          "scripts/env-helper.cjs",
          "scripts/env.cjs",
        ],
      },
    ]);
    // The runner process and the test file's child each wrote a graph.
    expect(readdirSync(logDir).filter((n) => n.startsWith("graph-0-")).length).toBe(2);
    const command = JSON.parse(readFileSync(join(logDir, "run.json"), "utf8")).files[0].command;
    expect(command.slice(1, 6)).toEqual([
      "--enable-source-maps",
      "--require",
      runtime.recorder,
      "--require",
      "./scripts/argv.cjs",
    ]);
  });
});
