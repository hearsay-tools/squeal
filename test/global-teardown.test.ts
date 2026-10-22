import { type ChildProcess, spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TestProject } from "vitest/node";
import { userTmpDir } from "../src/core/daemon/paths.js";
import { pidNamespace } from "../src/core/delivery/harness-process.js";
import setup, { namespaceName } from "./global-teardown.js";

/*
 * Task 014-36: a run's temp directories lie under one parent,
 * `/tmp/squeal-vitest-<pid>-XXXXXX`, which its teardown removes, and which
 * the next setup removes when the run was killed before its teardown.
 */

const SETUP = resolve(import.meta.dirname, "global-teardown.ts");
const VITEST = resolve(import.meta.dirname, "../node_modules/vitest/vitest.mjs");
const project = { provide: () => undefined } as unknown as TestProject;

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function scratch(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "squeal-teardown-")));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The PID namespace the setup writes in a parent it makes. */
function namespace(): string {
  return pidNamespace() ?? process.platform;
}

/** A pid no process has any more. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise((done) => child.on("exit", done));
  if (child.pid === undefined) throw new Error("no pid");
  return child.pid;
}

describe("the run's temp parent", () => {
  it("points TMPDIR, TMP and TEMP at one new parent, and teardown removes it and restores them", async () => {
    const root = scratch();
    const env: NodeJS.ProcessEnv = { TMPDIR: "/elsewhere", TMP: "/elsewhere" };
    const teardown = await setup(project, { env, root });
    const entries = readdirSync(root);
    expect(entries).toEqual([expect.stringMatching(`^squeal-vitest-${process.pid}-\\w{6}$`)]);
    const parent = join(root, entries[0] ?? "");
    expect(env).toEqual({ TMPDIR: parent, TMP: parent, TEMP: parent });
    mkdirSync(join(parent, "squeal-helper-abc123"));
    await teardown();
    expect(readdirSync(root)).toEqual([]);
    expect(env).toEqual({ TMPDIR: "/elsewhere", TMP: "/elsewhere" });
  });

  it("makes no parent under a daemon's key directory", async () => {
    const root = scratch();
    const key = join(userTmpDir(), "tmp", "0123456789abcdef");
    const env: NodeJS.ProcessEnv = { TMPDIR: key, TMP: key, TEMP: key };
    const teardown = await setup(project, { env, root });
    expect(readdirSync(root)).toEqual([]);
    expect(env).toEqual({ TMPDIR: key, TMP: key, TEMP: key });
    await teardown();
  });

  it("runs without a parent when it cannot make one", async () => {
    const root = join(scratch(), "missing");
    const env: NodeJS.ProcessEnv = { TMPDIR: "/elsewhere" };
    const teardown = await setup(project, { env, root });
    expect(env).toEqual({ TMPDIR: "/elsewhere" });
    await teardown();
  });

  it("warns and passes when it cannot remove the parent", async () => {
    const root = scratch();
    const env: NodeJS.ProcessEnv = {};
    const teardown = await setup(project, { env, root });
    const locked = join(env.TMPDIR ?? "", "locked");
    mkdirSync(join(locked, "inside"), { recursive: true });
    chmodSync(locked, 0o555);
    cleanups.push(() => chmodSync(locked, 0o755));
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    cleanups.push(() => write.mockRestore());
    await expect(teardown()).resolves.toBeUndefined();
    expect(env).toEqual({});
    // As root the directory goes anyway, and nothing is written.
    if (existsSync(locked)) expect(String(write.mock.calls[0]?.[0])).toContain(root);
  });

  it("removes at setup each parent whose Vitest process is gone, and only those", async () => {
    const root = scratch();
    const pid = await deadPid();
    const dead = join(root, `squeal-vitest-${pid}-gone12`);
    const live = join(root, `squeal-vitest-${process.pid}-live12`);
    const other = join(root, "squeal-helper-abc123");
    for (const dir of [join(dead, "squeal-helper-def456"), live, other]) {
      mkdirSync(dir, { recursive: true });
    }
    for (const dir of [dead, live]) writeFileSync(join(dir, ".pid-namespace"), namespace());
    const teardown = await setup(project, { env: {}, root });
    expect(existsSync(dead)).toBe(false);
    expect(existsSync(live)).toBe(true);
    expect(existsSync(other)).toBe(true);
    await teardown();
  });

  // Review 0.1.267 B1 and S1: a PID names a process only in its own namespace.
  it("keeps a dead PID's parent of another PID namespace, one that names none, a name mkdtemp does not make, and a symlink", async () => {
    const root = scratch();
    const pid = await deadPid();
    const elsewhere = join(root, `squeal-vitest-${pid}-other1`);
    const unnamed = join(root, `squeal-vitest-${pid}-unnamd`);
    const notParent = join(root, `squeal-vitest-${pid}-not-a-run`);
    const badSuffix = join(root, `squeal-vitest-${pid}-ab_c12`);
    const target = join(root, "target");
    const link = join(root, `squeal-vitest-${pid}-link12`);
    for (const dir of [elsewhere, unnamed, notParent, badSuffix, target]) mkdirSync(dir);
    writeFileSync(join(elsewhere, ".pid-namespace"), "pid:[1]");
    for (const dir of [notParent, badSuffix, target]) {
      writeFileSync(join(dir, ".pid-namespace"), namespace());
    }
    symlinkSync(target, link);
    const teardown = await setup(project, { env: {}, root });
    for (const dir of [elsewhere, unnamed, notParent, badSuffix, target, link]) {
      expect(existsSync(dir)).toBe(true);
    }
    await teardown();
  });

  it("names no namespace on Linux without a readable one, so no sweep removes a parent there", () => {
    expect(namespaceName(() => "pid:[4026531836]", "linux")).toBe("pid:[4026531836]");
    expect(namespaceName(() => null, "linux")).toBeNull();
    expect(namespaceName(() => null, "darwin")).toBe("darwin");
  });

  it("leaves a SIGKILLed run's temp directories under one parent that the next setup removes", async () => {
    const fixture = scratch();
    const mark = join(fixture, "made");
    writeFileSync(
      join(fixture, "vitest.config.mjs"),
      `export default { test: { include: ["killed.test.mjs"], globals: true, globalSetup: [${JSON.stringify(SETUP)}] } };\n`,
    );
    writeFileSync(
      join(fixture, "killed.test.mjs"),
      [
        'import { mkdtempSync, writeFileSync } from "node:fs";',
        'import { tmpdir } from "node:os";',
        'import { join } from "node:path";',
        'test("makes a temp directory and waits to be killed", async () => {',
        '  const dir = mkdtempSync(join(tmpdir(), "squeal-killed-"));',
        `  writeFileSync(${JSON.stringify(mark)}, dir);`,
        "  await new Promise(() => {});",
        "}, 120_000);",
        "",
      ].join("\n"),
    );
    // Outside a daemon and with no temp directory set, as CI runs.
    const env: NodeJS.ProcessEnv = { ...process.env, CI: "1", NO_COLOR: "1" };
    for (const name of ["TMPDIR", "TMP", "TEMP"]) delete env[name];
    const run = spawn(process.execPath, [VITEST, "run", "--config", "vitest.config.mjs"], {
      cwd: fixture,
      env,
      detached: true,
      stdio: "ignore",
    });
    let parent: string | undefined;
    cleanups.push(async () => {
      await killGroup(run);
      if (parent !== undefined) rmSync(parent, { recursive: true, force: true });
    });
    const made = await waitForFile(mark, 90_000);
    parent = dirname(made);
    expect(parent).toMatch(new RegExp(`^/tmp/squeal-vitest-${run.pid}-\\w{6}$`));

    await killGroup(run);
    expect(existsSync(made)).toBe(true);
    const teardown = await setup(project, { env: {}, root: "/tmp" });
    expect(existsSync(parent)).toBe(false);
    await teardown();
  }, 120_000);
});

/** SIGKILLs the run's process group, its Vitest process and workers. */
async function killGroup(run: ChildProcess): Promise<void> {
  if (run.pid === undefined || run.exitCode !== null || run.signalCode !== null) return;
  const exited = new Promise((done) => run.once("exit", done));
  try {
    process.kill(-run.pid, "SIGKILL");
  } catch {
    // Already gone.
  }
  await exited;
}

async function waitForFile(path: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      const text = readFileSync(path, "utf8");
      if (text !== "") return text;
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`${path} not written within ${timeoutMs} ms`);
}
