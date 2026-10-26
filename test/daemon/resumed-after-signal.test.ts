import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { ensureDaemonProcess } from "../../src/core/daemon/ensure.js";
import { cgroupUnit, signalNote } from "../../src/core/daemon/signals.js";
import { LOCKED_TEXT } from "../../src/core/status/outstanding-text.js";
import type { HarnessProcess } from "../../src/core/types/index.js";
import { runCodexHook } from "../../src/harness/codex/index.js";
import { findHarnessProcess } from "../../src/harness/shared/harness-process.js";
import { codexRecorded } from "../harness/codex/helpers.js";
import {
  daemonSuite,
  delay,
  diagnose,
  type FixtureRepo,
  readNotes,
  SLOW,
  spawnCli,
  waitFor,
  waitReady,
} from "./helpers.js";

/*
 * Row 011-250 (gh-1, `research/issue-1.md` section 4 and open question 1):
 * a Codex session's daemon stops on SIGTERM with the cockpit, the session's
 * Codex process dies with it, and the session resumes. Its SessionStart said
 * "A daemon is starting"; a wait 49 s later said the daemon stopped and named
 * `squeal start`. The daemon a hook spawns registers only once it holds the
 * lock and opened the store, which `quick_check` makes slow on a large store;
 * till then the wait read the cleared record as a stopped daemon.
 */

const suite = daemonSuite();
const SESSION = "01a1172a-085c-7cf1-95ec-d08a995416c1";
const PRELOAD = pathToFileURL(join(import.meta.dirname, "pause-preload.mjs")).href;
/** A daemon the hook spawns stops itself once it holds the lock and opened the store. */
const HELD_AT_STORE_OPEN = { SQUEAL_TEST_PAUSE: "store-open", NODE_OPTIONS: `--import=${PRELOAD}` };

/**
 * A Codex SessionStart of `SESSION` from `source`, under `harness`, through the
 * hook's own code, with `env` added to what the daemon it spawns inherits; the
 * pids it spawned go to `spawned`.
 */
async function sessionStart(
  repo: FixtureRepo,
  source: "startup" | "resume",
  harness: HarnessProcess | null,
  spawned: number[] = [],
  env: NodeJS.ProcessEnv = {},
): Promise<string> {
  const input = codexRecorded("exec", "session-start-resume", repo.root, {
    session_id: SESSION,
    source,
  });
  // The CLI it spawns, and where it finds the socket: the fixture's, not this test runner's.
  const saved = process.env;
  process.env = { ...repo.env, SQUEAL_CLI: suite.cli, ...env };
  try {
    const result = await runCodexHook("session-start", input, {
      env: process.env,
      harnessProcess: () => harness,
      ensureDaemon: async (root, options) => {
        const ensured = await ensureDaemonProcess(root, options);
        if (ensured.pid !== null) spawned.push(ensured.pid);
        return ensured.result;
      },
    });
    return result.stdout;
  } finally {
    process.env = saved;
  }
}

/** A stand-in for the session's first Codex process: a process this test starts and ends. */
async function codexProcess(): Promise<{
  harness: HarnessProcess | null;
  end: () => Promise<void>;
}> {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  const exited = new Promise<void>((done) => child.on("exit", () => done()));
  await new Promise<void>((done) => child.on("spawn", () => done()));
  const harness = findHarnessProcess({ ppid: child.pid ?? 0 });
  return {
    harness,
    end: async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
    },
  };
}

/** The fixture's daemon with a session under a Codex process; then SIGTERM, and that process ends. */
async function stoppedUnderSession(repo: FixtureRepo): Promise<void> {
  const daemon = suite.daemon(repo);
  await waitReady(repo, daemon);
  const first = await codexProcess();
  try {
    await sessionStart(repo, "startup", first.harness);
    daemon.child.kill("SIGTERM");
    expect(await daemon.exited, diagnose(repo, daemon)).toEqual({ code: 0, signal: null });
    expect(readNotes(repo)).toContain(signalNote("SIGTERM", cgroupUnit()));
  } finally {
    await first.end();
  }
}

/** Whether `/proc` shows `pid` stopped by a signal. */
function stopped(pid: number): boolean {
  try {
    return /^\d+ \(.*\) [Tt] /.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return false;
  }
}

/**
 * The session resumed, its SessionStart's daemon held at `store-open`, so it
 * holds the lock and has no record yet; `run` with it held, then it goes on.
 */
async function resumedWithStartHeld(repo: FixtureRepo, run: (pid: number) => Promise<void>) {
  await stoppedUnderSession(repo);
  const spawned: number[] = [];
  try {
    const harness = findHarnessProcess({ ppid: process.pid });
    const text = await sessionStart(repo, "resume", harness, spawned, HELD_AT_STORE_OPEN);
    expect(text).toContain("A daemon is starting");
    const [pid] = spawned;
    if (pid === undefined) throw new Error("the resumed SessionStart spawned no daemon");
    await waitFor(() => stopped(pid), 30_000, "the spawned daemon held at store-open");
    await run(pid);
  } finally {
    // The daemon runs until the suite stops it; resumed here so that stop can end it.
    for (const pid of spawned) if (stopped(pid)) process.kill(pid, "SIGCONT");
  }
}

const statusWait = (repo: FixtureRepo, ...args: string[]) =>
  spawnCli(suite.cli, ["status", "--wait", ...args], { cwd: repo.root, env: repo.env });

const last = (text: string) => text.trimEnd().split("\n").at(-1) ?? "";

describe.runIf(process.platform === "linux")(
  "a session resumed after its daemon's SIGTERM (row 011-250)",
  SLOW,
  () => {
    it("its first wait has the daemon its SessionStart spawned", async () => {
      const repo = suite.fixture();
      await stoppedUnderSession(repo);
      const resumed = await sessionStart(repo, "resume", findHarnessProcess({ ppid: process.pid }));
      expect(resumed).toContain("registered at revision");
      const wait = statusWait(repo, "60000");
      expect((await wait.exited).code, wait.stderr()).toBe(0);
      expect(last(wait.stdout())).toMatch(/^Returned on quiet: /);
    });

    it("its first wait goes on while that daemon holds the lock, and returns once it serves", async () => {
      const repo = suite.fixture();
      await resumedWithStartHeld(repo, async (pid) => {
        const wait = statusWait(repo, "60000");
        // Before row 011-250 it returned within 1.5 s: "the daemon stopped".
        await delay(3_000);
        expect(wait.child.exitCode, wait.stdout()).toBeNull();
        process.kill(pid, "SIGCONT");
        expect((await wait.exited).code, wait.stderr()).toBe(0);
        expect(last(wait.stdout())).toMatch(/^Returned on quiet: /);
        expect(wait.stdout()).not.toMatch(/no daemon/);
      });
    });

    it("a named wait whose deadline passes while the lock is held says so and exits 3", async () => {
      const repo = suite.fixture();
      await resumedWithStartHeld(repo, async () => {
        const wait = statusWait(repo, "3000", "test/math.test.ts");
        expect((await wait.exited).code, wait.stderr()).toBe(3);
        const line = last(wait.stdout());
        expect(line).toMatch(/^Named test files have no verdict: the deadline passed after /);
        expect(line).toContain(LOCKED_TEXT);
        expect(line).not.toContain("squeal start");
      });
    });

    it("with no daemon started and the lock free, the wait says the daemon stopped, as before", async () => {
      const repo = suite.fixture();
      await stoppedUnderSession(repo);
      const wait = statusWait(repo, "60000");
      expect((await wait.exited).code, wait.stderr()).toBe(0);
      expect(last(wait.stdout())).toMatch(
        /^Returned without a daemon: no daemon has validated since \S+: the daemon stopped; /,
      );
    });
  },
);
