import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { afterEachRun, EscapedChildren, type RunNote } from "../../src/core/daemon/escaped.js";
import { createNodeTestRunners } from "../../src/core/daemon/node-test-runners.js";
import type { RecordedGroup } from "../../src/core/daemon/run-groups.js";
import { AtRunPaths, withRunGroups } from "../../src/core/daemon/run-groups-watch.js";
import { statOf } from "../../src/core/daemon/terminate.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { NodeTestProject } from "../../src/core/types/policy.js";
import { createFixtureRepo, SLOW } from "./helpers.js";

/*
 * Row 023-36 (spec 023 D4 step 11, T3), done-when 1: a test file starts a
 * detached child in a session and group of its own, with an env of its own,
 * as squawk's e2e app is started. Under a `--run` request's run the child is
 * gone when the run returns, and named; under any other run it is left.
 */

const NT: NodeTestProject = {
  name: "nt",
  cwd: "nt",
  node: process.execPath,
  argv: [],
  env: {},
  include: ["test/*.test.mjs"],
};

const FILE: TestFileRef = { project: "nt", path: "nt/test/server.test.mjs" };

/** A node:test file that starts a detached server and writes its pid to `pidFile`. */
const starter = (pidFile: string) =>
  [
    'import { spawn } from "node:child_process";',
    'import { writeFileSync } from "node:fs";',
    'import { test } from "node:test";',
    'test("starts a server", async () => {',
    '  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {',
    '    detached: true, stdio: "ignore", env: {},',
    "  });",
    "  child.unref();",
    `  writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`,
    "  await new Promise((r) => setTimeout(r, 600));",
    "});",
    "",
  ].join("\n");

describe.runIf(process.platform === "linux")("withRunGroups (row 023-36)", () => {
  async function run(flagged: boolean) {
    const pids = mkdtempSync(join(tmpdir(), "squeal-run-groups-"));
    onTestFinished(() => rmSync(pids, { recursive: true, force: true }));
    const pidFile = join(pids, "server.pid");
    const repo = createFixtureRepo({ files: { [FILE.path]: starter(pidFile) } });
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
    const notes: RunNote[] = [];
    const recorded: RecordedGroup[] = [];
    const paths = new AtRunPaths();
    if (flagged) paths.add([FILE.path]);
    const runner = afterEachRun(
      withRunGroups(nodeTest, {
        paths,
        record: { add: (group) => recorded.push(group), remove: () => {} },
        note: (note) => notes.push(note),
      }),
      children,
      (note) => notes.push(note),
    );
    await runner.testFiles();
    const report = await runner.run([FILE], {
      runId: "at-run",
      logDir: join(repo.runtimeDir, "logs"),
      timeoutMs: null,
      lane: "node-test",
    });
    const pid = Number(readFileSync(pidFile, "utf8"));
    onTestFinished(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // gone
      }
    });
    return { report, pid, notes, recorded, paths };
  }

  it("1. a --run run's detached child is gone when the run returns, and named", SLOW, async () => {
    const { report, pid, notes, recorded, paths } = await run(true);
    expect(report.completedFiles).toEqual([FILE]);
    expect(statOf(pid)).toBeNull();
    expect(recorded.map(({ pgid, runId }) => ({ pgid, runId }))).toEqual([
      { pgid: pid, runId: "at-run" },
    ]);
    const texts = notes.map(({ text }) => text).join("\n");
    expect(texts).toMatch(/stopped 1 process in a process group a `--run` run started: /);
    expect(texts).toContain(`${pid} `);
    expect(paths.flagged([FILE])).toBe(false);
  });

  it("2. another run's detached child is left running", SLOW, async () => {
    const { pid, recorded } = await run(false);
    expect(recorded).toEqual([]);
    expect(statOf(pid)).not.toBeNull();
  });
});
