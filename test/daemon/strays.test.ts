import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TestProject } from "vitest/node";
import setup from "../global-teardown.js";
import { stopStrays } from "./helpers.js";
import { isAlive, killProcesses, TEST_CACHE, testBuildDir } from "./strays.js";

/*
 * Lessons, defect 29 (task 001-138): daemons of the test build never outlive
 * the run. Stand-ins sleep with the command line of a build's daemon.
 */

const sleepers: number[] = [];
afterEach(async () => {
  await killProcesses(sleepers.splice(0).map((pid) => ({ pid, args: "" })));
});

/** A detached process whose command line runs `script`, as a daemon a hook started would; gone within a minute regardless. */
function sleeper(script: string, ...args: string[]): number {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)", script, ...args], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  if (child.pid === undefined) throw new Error("no pid");
  sleepers.push(child.pid);
  return child.pid;
}

async function startRun(): Promise<{ runDir: string; teardown: () => Promise<void> }> {
  let runDir = "";
  const project = {
    provide: (_key: string, value: string) => {
      runDir = value;
    },
  } as unknown as TestProject;
  const teardown = await setup(project);
  return { runDir, teardown };
}

/** A pid no process has any more. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise((done) => child.on("exit", done));
  if (child.pid === undefined) throw new Error("no pid");
  return child.pid;
}

describe("the global teardown", () => {
  it("passes and removes the run's directory when nothing outlived the run", async () => {
    const { runDir, teardown } = await startRun();
    expect(existsSync(runDir)).toBe(true);
    await teardown();
    expect(existsSync(runDir)).toBe(false);
  });

  it("kills what runs from its run's build and fails naming the test file", async () => {
    const { runDir, teardown } = await startRun();
    const leaked = sleeper(
      join(testBuildDir("test/daemon/leaky.test.ts", runDir), "dist/cli/index.js"),
    );
    // Another live run's daemon in the same worktree.
    const other = sleeper(join(TEST_CACHE, `run-${process.pid}-other/b/dist/cli/index.js`));
    await expect(teardown()).rejects.toThrow(
      new RegExp(`test/daemon/leaky\\.test\\.ts: pid ${leaked}, `),
    );
    expect(isAlive(leaked)).toBe(false);
    expect(isAlive(other)).toBe(true);
    expect(existsSync(runDir)).toBe(false);
  });

  it("kills, at setup, what a run that died before its teardown left", async () => {
    const orphan = sleeper(join(TEST_CACHE, `run-${await deadPid()}-gone/c/dist/cli/index.js`));
    const live = sleeper(join(TEST_CACHE, `run-${process.pid}-live/d/dist/cli/index.js`));
    const { teardown } = await startRun();
    expect(isAlive(orphan)).toBe(false);
    expect(isAlive(live)).toBe(true);
    await teardown();
  });
});

describe("stopStrays", () => {
  it("stops every test build daemon of the root, and only of that root", async () => {
    const root = "/tmp/sq-fixture/main";
    const script = join(TEST_CACHE, `run-${process.pid}-s/e/dist/cli/index.js`);
    const plain = sleeper(script, "daemon", root);
    const successor = sleeper(script, "daemon", root, "--await-lock", "120000");
    const sibling = sleeper(script, "daemon", `${root}2`);
    await stopStrays(root);
    expect(isAlive(plain)).toBe(false);
    expect(isAlive(successor)).toBe(false);
    expect(isAlive(sibling)).toBe(true);
  });
});
