import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { ensureDaemon } from "../../src/core/daemon/ensure.js";
import { squealVersion } from "../../src/core/daemon/version.js";
import type { EnsureDaemonResult } from "../../src/core/types/index.js";
import { type HookDeps, runHook } from "../../src/harness/claude-code/index.js";
import { recorded } from "../harness/helpers.js";
import {
  daemonSuite,
  delay,
  diagnose,
  type FixtureRepo,
  LOADED,
  ping,
  readNotes,
  SLOW,
  type SpawnedProcess,
  spawnCli,
  stopProcess,
  waitFor,
  withStore,
} from "./helpers.js";

/*
 * Lessons, defect 26, against real daemons: a daemon started from a bundle
 * older than the hooks that call it lets its running tier finish and store,
 * persists one note and exits, and the next hook boundary starts a current
 * one. While the old one finishes it holds the lock, so a daemon spawned in
 * that window loses it and exits. An equal or newer daemon is left alone.
 * Hooks run in this process at the sources' version (`package.json`).
 */

const suite = daemonSuite();
const repoRoot = resolve(import.meta.dirname, "../..");
const HOOKS = squealVersion();
/** The last release before the step-down request: its daemon answers it "unknown request type". */
const PRE_STEP_DOWN = "8654424";
const hasPreStepDown = (() => {
  try {
    execFileSync("git", ["cat-file", "-e", `${PRE_STEP_DOWN}^{commit}`], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
})();

const spawned: SpawnedProcess[] = [];
/** Detached daemons a hook spawned, stopped over their socket. */
const sockets: string[] = [];
afterEach(async () => {
  for (const socketPath of sockets.splice(0)) await stopDetached(socketPath);
  for (const process of spawned.splice(0)) await stopProcess(process);
});

/** Under `node_modules/.cache`, so a CLI there resolves `vitest` and `chokidar`. */
function cacheDir(): string {
  const dir = join(repoRoot, "node_modules/.cache/squeal-test", randomUUID());
  mkdirSync(dir, { recursive: true });
  suite.cleanup(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The suite's build with `package.json` at `version`, so its daemon reports that version. */
function buildAt(version: string): string {
  const dir = cacheDir();
  cpSync(dirname(dirname(suite.cli)), join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "squeal", version }));
  return join(dir, "dist/cli/index.js");
}

/** The Claude Code plugin's CLI bundle as released at `commit`. */
function releasedCli(commit: string): string {
  const dir = cacheDir();
  const archive = execFileSync("git", ["archive", commit, "plugins/claude-code/dist"], {
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
  });
  execFileSync("tar", ["-x", "-C", dir], { input: archive });
  return join(dir, "plugins/claude-code/dist/cli/squeal.mjs");
}

function start(cli: string, repo: FixtureRepo): SpawnedProcess {
  const process = spawnCli(cli, ["daemon", repo.root], { cwd: repo.root, env: repo.env });
  spawned.push(process);
  return process;
}

async function stopDetached(socketPath: string): Promise<void> {
  const answer = await ping(socketPath, 500);
  if (answer === null) return;
  await requestDaemon(socketPath, { type: "stop" }, 1_000).catch(() => null);
  await waitFor(() => !alive(answer.pid), 60_000, "the spawned daemon gone").catch(() =>
    process.kill(answer.pid, "SIGKILL"),
  );
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * A slow test file: the tier running it is in flight for 6 s. `started` and
 * `done` appear when it starts and when it is about to pass.
 */
function slowTest(): { files: Record<string, string>; started: string; done: string } {
  const marker = `/tmp/sq-tier-${randomUUID()}`;
  suite.cleanup(() => {
    rmSync(`${marker}.started`, { force: true });
    rmSync(`${marker}.done`, { force: true });
  });
  const test = [
    'import { writeFileSync } from "node:fs";',
    'import { it } from "vitest";',
    'it("waits", async () => {',
    `  writeFileSync(${JSON.stringify(`${marker}.started`)}, "");`,
    "  await new Promise((resolve) => setTimeout(resolve, 6_000));",
    `  writeFileSync(${JSON.stringify(`${marker}.done`)}, String(Date.now()));`,
    "}, 30_000);",
    "",
  ].join("\n");
  return {
    files: { "test/slow.test.ts": test },
    started: `${marker}.started`,
    done: `${marker}.done`,
  };
}

/**
 * Hook dependencies with the real `ensureDaemon`, spawning the suite's
 * current CLI in the fixture's environment, each result recorded.
 */
function hookDeps(repo: FixtureRepo, ensured: EnsureDaemonResult[]): HookDeps {
  return {
    env: repo.env,
    harnessProcess: () => null,
    ensureDaemon: async (root, options) => {
      // The spawn inherits `process.env`: the fixture's, not this test runner's.
      const saved = process.env;
      process.env = repo.env;
      try {
        const result = await ensureDaemon(root, { ...options, cli: suite.cli, env: repo.env });
        ensured.push(result);
        return result;
      } finally {
        process.env = saved;
      }
    },
  };
}

async function hook(name: string, repo: FixtureRepo, deps: HookDeps): Promise<number> {
  const at = performance.now();
  await runHook(name as never, recorded(name, repo.root, { session_id: "s1" }), deps);
  return performance.now() - at;
}

async function exitWithin(process: SpawnedProcess, ms: number, repo: FixtureRepo) {
  const exit = await Promise.race([process.exited, delay(ms).then(() => null)]);
  if (exit === null) throw new Error(`still running after ${ms} ms\n${diagnose(repo, process)}`);
  return exit;
}

/** Waits for the old daemon's tier, steps it down with a SessionStart and checks the handover. */
async function stepsDownAfterItsTier(cli: string, version: string, note: RegExp): Promise<void> {
  const slow = slowTest();
  const repo = suite.fixture(slow.files);
  const old = start(cli, repo);
  const first = await waitFor(() => ping(repo.socketPath, 500), 60_000, "the old daemon serving");
  expect(first.squealVersion).toBe(version);
  await waitFor(() => existsSync(slow.started), 60_000, "the slow test running");
  const notes = readNotes(repo).length;

  const ensured: EnsureDaemonResult[] = [];
  const deps = hookDeps(repo, ensured);
  const took = await hook("session-start", repo, deps);
  if (!LOADED) expect(took).toBeLessThan(1_000);

  // The window: the old daemon finishes its tier and still holds the lock.
  expect(existsSync(slow.done)).toBe(false);
  await hook("session-start", repo, deps);
  await hook("post-tool-batch", repo, deps);
  expect(ensured.every((result) => result === "alive")).toBe(true);
  const contender = start(suite.cli, repo);
  expect(await exitWithin(contender, 30_000, repo)).toEqual({ code: 0, signal: null });
  expect(old.child.exitCode).toBeNull();
  expect((await ping(repo.socketPath, 500))?.pid).toBe(first.pid);

  expect(await exitWithin(old, 60_000, repo)).toEqual({ code: 0, signal: null });
  const doneAt = Number(readFileSync(slow.done, "utf8"));
  expect(Date.now()).toBeGreaterThanOrEqual(doneAt);
  const waits = withStore(repo, (store) =>
    store.knownStates.list(repo.worktreeId).find((s) => JSON.stringify(s.check).includes("waits")),
  );
  expect(waits).toMatchObject({ outcome: "pass", validity: "current" });
  expect(
    readNotes(repo)
      .slice(notes)
      .filter((n) => note.test(n)),
  ).toHaveLength(1);
  expect(withStore(repo, (store) => store.worktrees.get(repo.worktreeId)?.daemon)).toBeNull();

  // The next boundary finds no daemon and starts a current one.
  sockets.push(repo.socketPath);
  await hook("post-tool-batch", repo, deps);
  expect(ensured.at(-1)).toBe("spawned");
  const next = await waitFor(() => ping(repo.socketPath, 500), 60_000, "a current daemon");
  expect(next.squealVersion).toBe(HOOKS);
}

describe("a daemon older than its hooks steps down (defect 26)", SLOW, () => {
  it("after its running tier, with one note; a spawn meanwhile loses the lock; then a current one starts", async () => {
    const note = new RegExp(
      `daemon stopped: hooks at Squeal ${HOOKS.replaceAll(".", "\\.")} are newer than this daemon \\(0\\.1\\.0\\)`,
    );
    await stepsDownAfterItsTier(buildAt("0.1.0"), "0.1.0", note);
  });

  it.runIf(hasPreStepDown)(
    "a released 0.1.31 daemon, from before the request, is sent stop and exits after its tier",
    async () => {
      await stepsDownAfterItsTier(
        releasedCli(PRE_STEP_DOWN),
        "0.1.31",
        /daemon stopped: squeal stop/,
      );
    },
  );

  it("an equal or newer daemon is untouched", async () => {
    const equal = suite.fixture();
    const newer = suite.fixture();
    const daemons = [
      { repo: equal, process: start(suite.cli, equal) },
      { repo: newer, process: start(buildAt("9.9.9"), newer) },
    ];
    for (const { repo } of daemons) {
      const first = await waitFor(() => ping(repo.socketPath, 500), 60_000, "a daemon serving");
      const ensured: EnsureDaemonResult[] = [];
      await hook("session-start", repo, hookDeps(repo, ensured));
      await hook("post-tool-batch", repo, hookDeps(repo, ensured));
      expect(ensured).toEqual(["alive"]);
      await delay(1_000);
      expect((await ping(repo.socketPath, 500))?.pid).toBe(first.pid);
      expect(readNotes(repo).filter((n) => /newer than this daemon/.test(n))).toEqual([]);
    }
    for (const { process } of daemons) expect(process.child.exitCode).toBeNull();
  });
});
