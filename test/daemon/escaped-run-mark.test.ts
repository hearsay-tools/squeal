import { describe, expect, it, onTestFinished } from "vitest";
import { afterEachRun, EscapedChildren } from "../../src/core/daemon/escaped.js";
import { createNodeTestRunners } from "../../src/core/daemon/node-test-runners.js";
import type { NodeTestProject, RunOptions, TestFileRef } from "../../src/core/types/index.js";
import { createFixtureRepo, SLOW } from "./helpers.js";

/*
 * Task 011-21, done-when 3 (spec 011 C4 step 5 as amended 2026-10-19,
 * `research/streaming-lanes.md` finding 1, "The sweep breaks"): an edit's
 * node:test tier runs beside a backlog tier of its lane, so two runs of one
 * lane overlap. The stop after a run reached every carrier of the lane's mark
 * started since it began, the other run's tests among them; each run's
 * processes now carry a mark of their own run.
 */

const NT: NodeTestProject = {
  name: "nt",
  cwd: "nt",
  node: process.execPath,
  argv: [],
  env: {},
  include: ["test/*.test.mjs"],
};

const sleeper = (ms: number) =>
  [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    `test("sleeps", async () => { await new Promise((r) => setTimeout(r, ${ms})); assert.ok(true); });`,
    "",
  ].join("\n");

const FIRST: TestFileRef = { project: "nt", path: "nt/test/first.test.mjs" };
const SECOND: TestFileRef = { project: "nt", path: "nt/test/second.test.mjs" };

const options = (runId: string): RunOptions => ({
  runId,
  logDir: `/tmp/${runId}`,
  timeoutMs: null,
  lane: "node-test",
});

describe.runIf(process.platform === "linux")(
  "afterEachRun, a mark per run where runs of a lane overlap (task 011-21)",
  () => {
    it(
      "3. the first run's stop leaves the overlapping second run's tests running",
      SLOW,
      async () => {
        const repo = createFixtureRepo({
          files: {
            [FIRST.path]: sleeper(1_000),
            [SECOND.path]: sleeper(3_000),
          },
        });
        onTestFinished(repo.cleanup);
        const children = new EscapedChildren();
        const [nodeTest] = createNodeTestRunners([NT], {
          root: repo.root,
          tempDir: repo.runtimeDir,
          childEnv: children.env,
          tierSize: () => 4,
          note: () => {},
        });
        if (nodeTest === undefined) throw new Error("no node:test runner");
        onTestFinished(() => nodeTest.close());
        const notes: string[] = [];
        const runner = afterEachRun(nodeTest, children, ({ text }) => notes.push(text));
        expect(runner.besideBacklog?.(SECOND)).toBe(true);
        await runner.testFiles();

        // The backlog tier's run starts first and ends first; the edit's starts while it runs.
        const first = runner.run([FIRST], options("backlog"));
        await new Promise((resolve) => setTimeout(resolve, 300));
        const second = runner.run([SECOND], options("edit"));
        const ended = await first;
        expect(ended.completedFiles).toEqual([FIRST]);
        const report = await second;

        expect(notes).toEqual([]);
        expect(report.end).toBe("completed");
        expect(report.completedFiles).toEqual([SECOND]);
        expect(report.results.map((r) => r.outcome)).toEqual(["pass"]);
      },
    );
  },
);
