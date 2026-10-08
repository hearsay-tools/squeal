import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { readHeader } from "../../src/core/delivery/index.js";
import type { HarnessProcess } from "../../src/core/types/index.js";
import { type HookDeps, runHook } from "../../src/harness/claude-code/index.js";
import { findHarnessProcess } from "../../src/harness/shared/harness-process.js";
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
  waitFor,
  waitReady,
  withStore,
} from "./helpers.js";

/*
 * Lessons, defect 24, the human's rule, against a real daemon: when its last
 * session is gone (SessionEnd, or its harness process died) the daemon lets
 * a running tier finish and store, persists one note and exits, 3 s after;
 * a SessionStart within those 3 s keeps it. Hooks run in this process, so
 * each session names its harness process explicitly.
 */

const suite = daemonSuite();
const { fixture, daemon } = suite;
const linux = process.platform === "linux";

/** Heartbeat (5 s) plus the grace (3 s), with slack for the shutdown and a loaded host. */
const HEARTBEAT_AND_GRACE_MS = 5_000 + 3_000;
const GONE_NOTE = /daemon stopped: no session registered for 3 s after its last one ended/;

const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
});

/** A process standing in for a harness: alive until killed. */
function harness(): ChildProcess & { pid: number } {
  const child = spawn("sleep", ["120"], { stdio: "ignore" });
  children.push(child);
  if (child.pid === undefined) throw new Error("sleep did not start");
  return child as ChildProcess & { pid: number };
}

function deps(repo: FixtureRepo, process: () => HarnessProcess | null): HookDeps {
  return { env: repo.env, ensureDaemon: async () => "alive", harnessProcess: process };
}

const self = () => findHarnessProcess({ ppid: process.pid });
const sessions = (repo: FixtureRepo) =>
  withStore(repo, (store) =>
    store.consumers.list(repo.worktreeId).map((r) => r.consumer.sessionId),
  );

async function start(repo: FixtureRepo, sessionId: string, d: HookDeps, source = "startup") {
  await runHook(
    "session-start",
    recorded("session-start", repo.root, { session_id: sessionId, source }),
    d,
  );
}

async function end(repo: FixtureRepo, sessionId: string, d: HookDeps) {
  await runHook("session-end", recorded("session-end", repo.root, { session_id: sessionId }), d);
}

/** Waits until the daemon has no work pending and every fixture check is current. */
async function idle(repo: FixtureRepo, spawned: SpawnedProcess): Promise<void> {
  try {
    await waitFor(
      () =>
        withStore(repo, (store) => {
          const { counts } = readHeader(store, repo.worktreeId);
          return counts.current >= 5 && counts.pending === 0;
        }),
      60_000,
      "the baseline done",
    );
  } catch (error) {
    throw new Error(`${(error as Error).message}\n${diagnose(repo, spawned)}`);
  }
}

async function exitWithin(spawned: SpawnedProcess, ms: number, repo: FixtureRepo) {
  const exit = await Promise.race([spawned.exited, delay(ms).then(() => null)]);
  if (exit === null) {
    throw new Error(`the daemon still runs after ${ms} ms\n${diagnose(repo, spawned)}`);
  }
  return exit;
}

describe("a daemon exits when its last session is gone (defect 24)", SLOW, () => {
  it("within 3 s of the last SessionEnd when idle, with one note", async () => {
    const repo = fixture();
    const spawned = daemon(repo);
    await waitReady(repo, spawned);
    const d = deps(repo, self);
    await start(repo, "s1", d);
    await idle(repo, spawned);
    const notes = readNotes(repo).length;

    const ended = performance.now();
    await end(repo, "s1", d);
    expect(sessions(repo)).toEqual([]);
    expect(await exitWithin(spawned, 30_000, repo)).toEqual({ code: 0, signal: null });
    const took = performance.now() - ended;

    // The grace counts from the last poll that saw the session, so the exit can start just under 3 s.
    expect(took).toBeGreaterThan(2_500);
    if (!LOADED) expect(took).toBeLessThan(3_500);
    expect(readNotes(repo).slice(notes)).toEqual([expect.stringMatching(GONE_NOTE)]);
    expect(withStore(repo, (store) => store.worktrees.get(repo.worktreeId)?.daemon)).toBeNull();
    expect(existsSync(repo.socketPath)).toBe(false);
  });

  it("a SessionStart within the grace keeps it (/clear)", async () => {
    const repo = fixture();
    const spawned = daemon(repo);
    await waitReady(repo, spawned);
    const d = deps(repo, self);
    await start(repo, "s1", d);
    await idle(repo, spawned);

    await end(repo, "s1", d);
    await delay(1_000);
    await start(repo, "s2", d, "clear");
    await delay(5_000);

    expect(spawned.child.exitCode).toBeNull();
    expect(await ping(repo.socketPath, 1_000)).not.toBeNull();
    await end(repo, "s2", d);
    expect(await exitWithin(spawned, 30_000, repo)).toEqual({ code: 0, signal: null });
  });

  it("with a tier running, exits right after that tier's results are stored", async () => {
    const marker = `/tmp/sq-tier-${randomUUID()}`;
    suite.cleanup(() => rmSync(marker, { force: true }));
    const slow = [
      'import { writeFileSync } from "node:fs";',
      'import { it } from "vitest";',
      'it("waits", async () => {',
      `  writeFileSync(${JSON.stringify(`${marker}.started`)}, "");`,
      "  await new Promise((resolve) => setTimeout(resolve, 6_000));",
      `  writeFileSync(${JSON.stringify(`${marker}.done`)}, String(Date.now()));`,
      "}, 30_000);",
      "",
    ].join("\n");
    const repo = fixture({ "test/slow.test.ts": slow });
    const spawned = daemon(repo);
    // Registered as soon as the socket answers, as SessionStart does, not after the baseline.
    await waitFor(() => ping(repo.socketPath, 500), 60_000, "a daemon serving");
    const d = deps(repo, self);
    await start(repo, "s1", d);
    await waitFor(() => existsSync(`${marker}.started`), 60_000, "the slow test running");

    await end(repo, "s1", d);
    expect(await exitWithin(spawned, 60_000, repo)).toEqual({ code: 0, signal: null });
    const exitedAt = Date.now();

    const doneAt = Number(readFileSync(`${marker}.done`, "utf8"));
    expect(exitedAt).toBeGreaterThanOrEqual(doneAt);
    if (!LOADED) expect(exitedAt - doneAt).toBeLessThan(3_000);
    const waits = withStore(repo, (store) =>
      store.knownStates
        .list(repo.worktreeId)
        .find((s) => JSON.stringify(s.check).includes("waits")),
    );
    expect(waits).toMatchObject({ outcome: "pass", validity: "current" });
    expect(readNotes(repo).filter((n) => GONE_NOTE.test(n))).toHaveLength(1);
  });

  it.runIf(linux)(
    "drops a session whose harness is SIGKILLed (no SessionEnd) and exits within a heartbeat plus the grace",
    async () => {
      const repo = fixture();
      const spawned = daemon(repo);
      await waitReady(repo, spawned);
      const killed = harness();
      await start(
        repo,
        "s1",
        deps(repo, () => findHarnessProcess({ ppid: killed.pid })),
      );
      await idle(repo, spawned);
      expect(sessions(repo)).toEqual(["s1"]);

      const at = performance.now();
      killed.kill("SIGKILL");
      expect(await exitWithin(spawned, 30_000, repo)).toEqual({ code: 0, signal: null });
      if (!LOADED) expect(performance.now() - at).toBeLessThan(HEARTBEAT_AND_GRACE_MS + 1_000);
      expect(sessions(repo)).toEqual([]);
    },
  );

  it.runIf(linux)("a PID reused by another process does not count as the session", async () => {
    const repo = fixture();
    const spawned = daemon(repo);
    await waitReady(repo, spawned);
    const live = harness();
    const real = findHarnessProcess({ ppid: live.pid });
    if (real === null) throw new Error("no harness process found");
    // The recorded harness started earlier than the process now holding its PID.
    const reused: HarnessProcess = { ...real, startTime: real.startTime - 1 };
    await start(
      repo,
      "s1",
      deps(repo, () => reused),
    );
    await idle(repo, spawned);

    expect(await exitWithin(spawned, 30_000, repo)).toEqual({ code: 0, signal: null });
    expect(live.exitCode).toBeNull();
    expect(sessions(repo)).toEqual([]);
  });

  it("a daemon that never had a session keeps the idle period (squeal start)", async () => {
    const repo = fixture({ "squeal.config.json": '{"daemon": {"idleExitMinutes": 0.15}}' });
    const started = performance.now();
    const spawned = daemon(repo);
    await waitReady(repo, spawned);
    await delay(5_000);
    expect(spawned.child.exitCode).toBeNull();

    expect(await exitWithin(spawned, 60_000, repo)).toEqual({ code: 0, signal: null });
    expect(performance.now() - started).toBeGreaterThan(9_000);
    expect(readNotes(repo).at(-1)).toMatch(
      /daemon stopped: idle for 9 s with no registered consumers/,
    );
  });
});
