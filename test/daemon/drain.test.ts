import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { HarnessProcess } from "../../src/core/types/index.js";
import { type HookDeps, runHook } from "../../src/harness/claude-code/index.js";
import { findHarnessProcess } from "../../src/harness/shared/harness-process.js";
import { recorded } from "../harness/helpers.js";
import {
  daemonSuite,
  delay,
  diagnose,
  type FixtureRepo,
  ping,
  readNotes,
  SLOW,
  type SpawnedProcess,
  waitFor,
  withStore,
} from "./helpers.js";
import { resultOf } from "./scratch-helpers.js";

/*
 * Task 004-29, the human's rules (board row 001-162), against a real daemon:
 * slow files pending when the last session leaves (the end of every
 * `codex exec` and `claude -p`) run before the daemon exits, for at most
 * `daemon.idleExitMinutes`; a session that starts during the drain is served,
 * its fast work beside the slow file, and the daemon stays after the drain.
 * The one slow file holds until the test writes its flag. Review wave 4, S2
 * (task 004-37): slow files an in-turn session left queued and unstarted
 * start when it ends, and a session arriving before the next file starts is
 * served first.
 */

const suite = daemonSuite();

const DRAIN_NOTE = /^the last session ended with slow files pending; this daemon runs them/;
const DRAINED_NOTE = /daemon stopped: the slow files pending when its last session ended have run/;
const GONE_NOTE = /daemon stopped: no session registered for 3 s after its last one ended/;
const BOUND_NOTE = /daemon stopped: slow files were still pending 6 s after its last session ended/;

function slowTest(dir: string): string {
  const at = (name: string) => JSON.stringify(join(dir, name));
  return `import { existsSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
it("holds until the flag", async () => {
  writeFileSync(${at("started")}, "");
  const deadline = Date.now() + 150_000;
  while (!existsSync(${at("flag")}) && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 100));
  }
  expect(existsSync(${at("flag")})).toBe(true);
}, 170_000);
`;
}

const self = () => findHarnessProcess({ ppid: process.pid });

function deps(repo: FixtureRepo, harness: () => HarnessProcess | null = self): HookDeps {
  return { env: repo.env, ensureDaemon: async () => "alive", harnessProcess: harness };
}

async function start(repo: FixtureRepo, sessionId: string) {
  const payload = recorded("session-start", repo.root, {
    session_id: sessionId,
    source: "startup",
  });
  await runHook("session-start", payload, deps(repo));
}

async function end(repo: FixtureRepo, sessionId: string) {
  const payload = recorded("session-end", repo.root, { session_id: sessionId });
  await runHook("session-end", payload, deps(repo));
}

async function exitWithin(spawned: SpawnedProcess, ms: number, repo: FixtureRepo) {
  const exit = await Promise.race([spawned.exited, delay(ms).then(() => null)]);
  if (exit === null) {
    throw new Error(`the daemon still runs after ${ms} ms\n${diagnose(repo, spawned)}`);
  }
  return exit;
}

/** A daemon whose session `s1` is registered and whose slow file is running. */
async function draining(idleExitMinutes?: number) {
  const dir = mkdtempSync(join(tmpdir(), "sq-004-29-"));
  suite.cleanup(() => rmSync(dir, { recursive: true, force: true }));
  const repo = suite.fixture({
    "test/slow.test.ts": slowTest(dir),
    // The load guard (spec 004 D3) would defer the slow file on a loaded host past the waits.
    "squeal.config.json": `${JSON.stringify({
      slow: { include: ["test/slow.test.ts"], maxLoadPerCpu: 1000 },
      ...(idleExitMinutes === undefined ? {} : { daemon: { idleExitMinutes } }),
    })}\n`,
  });
  const spawned = suite.daemon(repo);
  // Registered as soon as the socket answers, as SessionStart does, before the idle period.
  await waitFor(() => ping(repo.socketPath, 500), 60_000, "a daemon serving");
  await start(repo, "s1");
  await waitFor(() => existsSync(join(dir, "started")), 150_000, "the slow file started").catch(
    (error: Error) => {
      throw new Error(`${error.message}\n${diagnose(repo, spawned)}`);
    },
  );
  return { repo, spawned, release: () => writeFileSync(join(dir, "flag"), "") };
}

/** A Vitest file that appends to `started-<name>` and holds until `release-<name>` exists. */
function heldTest(dir: string, name: string): string {
  const at = (file: string) => JSON.stringify(join(dir, `${file}-${name}`));
  return `import { appendFileSync, existsSync } from "node:fs";
import { expect, it } from "vitest";
it("holds until released", async () => {
  appendFileSync(${at("started")}, "x");
  const deadline = Date.now() + 150_000;
  while (!existsSync(${at("release")}) && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 100));
  }
  expect(existsSync(${at("release")})).toBe(true);
}, 170_000);
`;
}

const SLOW_NAMES = ["a", "b"] as const;
const slowPath = (name: string) => `test/slow-${name}.test.ts`;

/**
 * Review wave 4, S2: a daemon whose session `s1` is in a turn, so its two
 * slow files stay queued, unstarted, after the fast baseline.
 */
async function queuedInTurn(maxParallel: number) {
  const dir = mkdtempSync(join(tmpdir(), "sq-004-37-"));
  suite.cleanup(() => rmSync(dir, { recursive: true, force: true }));
  const files: Record<string, string> = {
    "squeal.config.json": `${JSON.stringify({
      runner: { tierSize: 1 },
      slow: { include: ["test/slow-*.test.ts"], maxParallel, maxLoadPerCpu: 1000 },
    })}\n`,
  };
  for (const name of SLOW_NAMES) files[slowPath(name)] = heldTest(dir, name);
  const repo = suite.fixture(files);
  const spawned = suite.daemon(repo);
  await waitFor(() => ping(repo.socketPath, 500), 60_000, "a daemon serving");
  await start(repo, "s1");
  await prompt(repo, "s1");
  await waitFor(
    () => (outcome(repo, "test/math.test.ts") === "pass" ? true : null),
    120_000,
    "the fast baseline",
  ).catch((error: Error) => {
    throw new Error(`${error.message}\n${diagnose(repo, spawned)}`);
  });
  const starts = () =>
    SLOW_NAMES.map((name) => {
      const path = join(dir, `started-${name}`);
      return existsSync(path) ? readFileSync(path, "utf8").length : 0;
    });
  const release = (name: string) => writeFileSync(join(dir, `release-${name}`), "");
  suite.cleanup(() => {
    for (const name of SLOW_NAMES) release(name);
  });
  return { repo, spawned, starts, release };
}

async function prompt(repo: FixtureRepo, sessionId: string) {
  const payload = recorded("user-prompt-submit", repo.root, { session_id: sessionId });
  await runHook("user-prompt-submit", payload, deps(repo));
}

async function stop(repo: FixtureRepo, sessionId: string) {
  const payload = recorded("stop", repo.root, { session_id: sessionId });
  await runHook("stop", payload, deps(repo));
}

const outcome = (repo: FixtureRepo, path: string) =>
  withStore(
    repo,
    (store) =>
      store.knownStates
        .list(repo.worktreeId)
        .find((s) => s.check.kind === "test" && s.check.testPath === path)?.outcome,
  );

describe.runIf(process.platform === "linux")(
  "a daemon drains pending slow files before it exits (task 004-29)",
  SLOW,
  () => {
    it("runs the slow file after the last session ended, then exits with one note", async () => {
      const { repo, spawned, release } = await draining();
      await end(repo, "s1");
      await delay(5_000);
      expect(spawned.child.exitCode).toBeNull();
      expect(await ping(repo.socketPath, 1_000)).not.toBeNull();
      expect(readNotes(repo).filter((n) => DRAIN_NOTE.test(n))).toHaveLength(1);

      release();
      expect(await exitWithin(spawned, 60_000, repo)).toEqual({ code: 0, signal: null });
      expect(await resultOf(repo, spawned, "test/slow.test.ts")).toMatchObject({
        outcome: "pass",
        validity: "current",
      });
      const notes = readNotes(repo);
      expect(notes.filter((n) => DRAINED_NOTE.test(n))).toHaveLength(1);
      expect(notes.filter((n) => GONE_NOTE.test(n))).toEqual([]);
    });

    it("a session that starts during the drain is served, fast work first, and the daemon stays", async () => {
      const { repo, spawned, release } = await draining();
      await end(repo, "s1");
      await waitFor(
        () => readNotes(repo).some((n) => DRAIN_NOTE.test(n)) || null,
        30_000,
        "the drain",
      );
      // `/clear`, `/new`, or a reopened harness.
      await start(repo, "s2");
      writeFileSync(
        join(repo.root, "src/math.ts"),
        "export const add = (a: number, b: number) => a - b;\n",
      );
      await waitFor(
        () => outcome(repo, "test/math.test.ts") === "fail" || null,
        120_000,
        "the edit's fast file reported",
      );
      // The slow file is still running: the fast tier did not wait behind it.
      expect(outcome(repo, "test/slow.test.ts")).not.toBe("pass");

      release();
      expect((await resultOf(repo, spawned, "test/slow.test.ts")).outcome).toBe("pass");
      await delay(5_000);
      expect(spawned.child.exitCode).toBeNull();
      expect(await ping(repo.socketPath, 1_000)).not.toBeNull();

      await end(repo, "s2");
      expect(await exitWithin(spawned, 30_000, repo)).toEqual({ code: 0, signal: null });
      expect(readNotes(repo).filter((n) => GONE_NOTE.test(n))).toHaveLength(1);
    });

    it("is bounded by daemon.idleExitMinutes: at the bound it exits once the running file stored", async () => {
      const { repo, spawned, release } = await draining(0.1);
      await end(repo, "s1");
      await waitFor(
        () => readNotes(repo).some((n) => BOUND_NOTE.test(n)) || null,
        30_000,
        "the bound",
      );
      // The slow file in flight still stores its result (001 D10).
      release();
      expect(await exitWithin(spawned, 60_000, repo)).toEqual({ code: 0, signal: null });
      expect(outcome(repo, "test/slow.test.ts")).toBe("pass");
      expect(readNotes(repo).filter((n) => DRAINED_NOTE.test(n))).toEqual([]);
    });

    it("starts the queued slow files an in-turn session left, all at once, and stores them before exit", async () => {
      const { repo, spawned, starts, release } = await queuedInTurn(2);
      // In a turn: the baseline is done and no slow file started (D2).
      await delay(3_000);
      expect(starts()).toEqual([0, 0]);

      await end(repo, "s1");
      // Both start together, runner.tierSize 1 notwithstanding: an idle tier of slow.maxParallel files.
      await waitFor(() => (starts().every((n) => n === 1) ? true : null), 60_000, "both started");
      expect(spawned.child.exitCode).toBeNull();
      for (const name of SLOW_NAMES) release(name);
      expect(await exitWithin(spawned, 60_000, repo)).toEqual({ code: 0, signal: null });
      expect(starts()).toEqual([1, 1]);
      for (const name of SLOW_NAMES) expect(outcome(repo, slowPath(name))).toBe("pass");
      expect(readNotes(repo).filter((n) => DRAINED_NOTE.test(n))).toHaveLength(1);
    });

    it("serves a session and its first edit that arrive before the second slow file starts", async () => {
      const { repo, spawned, starts, release } = await queuedInTurn(1);
      await end(repo, "s1");
      await waitFor(() => (starts().includes(1) ? true : null), 60_000, "the first slow file");
      const first = starts()[0] === 1 ? "a" : "b";
      const second = first === "a" ? "b" : "a";
      const secondAt = SLOW_NAMES.indexOf(second);

      await start(repo, "s2");
      await prompt(repo, "s2");
      writeFileSync(
        join(repo.root, "src/math.ts"),
        "export const add = (a: number, b: number) => a - b;\n",
      );
      await waitFor(
        () => outcome(repo, "test/math.test.ts") === "fail" || null,
        120_000,
        "the edit's fast file reported",
      );
      release(first);
      await waitFor(() => outcome(repo, slowPath(first)) === "pass" || null, 60_000, "the first");
      // s2 is in a turn: the second file waits, and the daemon stays.
      await delay(3_000);
      expect(starts()[secondAt]).toBe(0);
      expect(spawned.child.exitCode).toBeNull();

      // The agent fixes its edit and stops: idle, the second file starts.
      writeFileSync(
        join(repo.root, "src/math.ts"),
        "export const add = (a: number, b: number) => a + b;\n",
      );
      await waitFor(
        () => outcome(repo, "test/math.test.ts") === "pass" || null,
        120_000,
        "the fix reported",
      );
      await stop(repo, "s2");
      await waitFor(() => starts()[secondAt] === 1 || null, 60_000, "the second slow file");
      release(second);
      await waitFor(() => outcome(repo, slowPath(second)) === "pass" || null, 60_000, "the second");
      await end(repo, "s2");
      expect(await exitWithin(spawned, 30_000, repo)).toEqual({ code: 0, signal: null });
      expect(starts()).toEqual([1, 1]);
    });
  },
);
