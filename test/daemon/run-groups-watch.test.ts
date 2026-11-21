import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { afterEachRun, EscapedChildren, type RunNote } from "../../src/core/daemon/escaped.js";
import { createNodeTestRunners } from "../../src/core/daemon/node-test-runners.js";
import { type RecordedRun, RUN_GROUP_VARIABLE } from "../../src/core/daemon/run-groups.js";
import { AtRunRequests, withRunGroups } from "../../src/core/daemon/run-groups-watch.js";
import { type ProcessEntry, statOf } from "../../src/core/daemon/terminate.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { NodeTestProject } from "../../src/core/types/policy.js";
import { createFixtureRepo, SLOW } from "./helpers.js";

/*
 * Row 023-36 (spec 023 D4 step 11, T3; review wave-20 B7): a test file
 * starts a detached child in a session and group of its own, with an env of
 * its own (`env: {}`), and returns at once, so its starter is gone before
 * any look. Under a run of an accepted `--run` request's file the child is
 * gone when the run returns, and named; under any other run it is left. A
 * process outside the run, and one carrying another run's token, survive.
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

/** A node:test file that starts a detached server, writes its pid to `pidFile` and ends at once. */
const starter = (pidFile: string) =>
  [
    'import { spawn } from "node:child_process";',
    'import { writeFileSync } from "node:fs";',
    'import { test } from "node:test";',
    'test("starts a server", () => {',
    '  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {',
    '    detached: true, stdio: "ignore", env: {},',
    "  });",
    "  child.unref();",
    `  writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`,
    "});",
    "",
  ].join("\n");

/** A sleeping node in a group of its own with `env`, ended when the test finishes. */
async function detached(env: NodeJS.ProcessEnv): Promise<ProcessEntry> {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: true,
    stdio: "ignore",
    env,
  });
  child.unref();
  const pid = child.pid;
  if (pid === undefined) throw new Error("no pid");
  onTestFinished(() => kill(pid));
  for (let i = 0; i < 100; i++) {
    const found = statOf(pid);
    if (found !== null && found.pgrp === pid) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`process ${pid} did not start`);
}

function kill(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // gone
  }
}

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
  const recorded: RecordedRun[] = [];
  const removed: string[] = [];
  const requests = new AtRunRequests();
  if (flagged) requests.accepted("covered-1", [FILE]);
  const runner = afterEachRun(
    withRunGroups(nodeTest, {
      requests,
      record: {
        add: (one) => recorded.push(one),
        saw: () => {},
        remove: (tokens) => removed.push(...tokens),
      },
      note: (note) => notes.push(note),
    }),
    children,
    (note) => notes.push(note),
  );
  await runner.testFiles();
  const outside = await detached({});
  const otherRun = await detached({ [RUN_GROUP_VARIABLE]: "another-run-0123456789abcdef" });
  const report = await runner.run([FILE], {
    runId: "at-run",
    logDir: join(repo.runtimeDir, "logs"),
    timeoutMs: null,
    lane: "node-test",
  });
  const pid = Number(readFileSync(pidFile, "utf8"));
  onTestFinished(() => kill(pid));
  return { report, pid, notes, recorded, removed, requests, outside, otherRun };
}

describe.runIf(process.platform === "linux")("withRunGroups (row 023-36)", () => {
  it(
    "1. a --run run's no-delay detached child is gone when the run returns, and named",
    SLOW,
    async () => {
      const { report, pid, notes, recorded, removed, requests, outside, otherRun } =
        await run(true);
      expect(report.completedFiles).toEqual([FILE]);
      expect(statOf(pid)).toBeNull();
      expect(recorded).toHaveLength(1);
      expect(recorded[0]?.runId).toBe("at-run");
      expect(removed).toEqual([recorded[0]?.token]);
      const texts = notes.map(({ text }) => text).join("\n");
      expect(texts).toMatch(/stopped 1 process a `--run` run started: /);
      expect(texts).toContain(`${pid} `);
      expect(requests.flagged([FILE])).toBe(false);
      // Outside the run, and another run's: never signalled.
      expect(statOf(outside.pid)?.start).toBe(outside.start);
      expect(statOf(otherRun.pid)?.start).toBe(otherRun.start);
    },
  );

  it("2. another run's detached child is left running", SLOW, async () => {
    const { pid, recorded, outside } = await run(false);
    expect(recorded).toEqual([]);
    expect(statOf(pid)).not.toBeNull();
    expect(statOf(outside.pid)?.start).toBe(outside.start);
  });
});
