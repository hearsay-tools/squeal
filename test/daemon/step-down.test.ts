import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { EnsureDaemonResult } from "../../src/core/types/index.js";
import { resume, stoppedItself, testPause } from "../e2e/restart-evidence.js";
import { runMissingConfig } from "../helpers/baseline.js";
import {
  daemonSuite,
  delay,
  type FixtureRepo,
  LOADED,
  ping,
  readNotes,
  SLOW,
  waitFor,
  withStore,
} from "./helpers.js";
import { stepDownKit } from "./step-down-helpers.js";

/*
 * Lessons, defect 26, against real daemons: a daemon started from a bundle
 * older than the hooks that call it cancels its tiers in flight, persists
 * one note and exits, and the successor the hook spawned with a lock wait
 * serves (task 001-130; row 011-31, C9 as amended 2026-10-20). A daemon from
 * before the request, sent `stop`, lets its running tier finish and store;
 * while it finishes it holds the lock, so a daemon spawned in that window
 * loses it and exits. An equal or newer daemon is left alone.
 * Hooks run in this process at the sources' version (`package.json`).
 */

const suite = daemonSuite();
const { HOOKS, hasCommit, buildAt, releasedCli, start, sockets, hookDeps, hook, exitWithin } =
  stepDownKit(suite);
/** The last release before the step-down request: its daemon answers it "unknown request type". */
const PRE_STEP_DOWN = "8654424";
const hasPreStepDown = hasCommit(PRE_STEP_DOWN);
/** Under a loaded host: Vitest's cancel forces its workers after 1 s, the shutdown follows (as `stop-cancel`). */
const STEP_DOWN_WITHIN_MS = 15_000;
/** The old daemon stops itself between its socket's unlink and its lock release (task 001-355). */
const STOP_GAP = testPause("stop-gap");

/**
 * A slow test file: the tier running it is in flight for `ms` (6 s by
 * default). `started` and `done` appear when it starts and when it is about
 * to pass.
 */
function slowTest(ms = 6_000): { files: Record<string, string>; started: string; done: string } {
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
    `  await new Promise((resolve) => setTimeout(resolve, ${ms}));`,
    `  writeFileSync(${JSON.stringify(`${marker}.done`)}, String(Date.now()));`,
    `}, ${ms + 30_000});`,
    "",
  ].join("\n");
  return {
    files: { "test/slow.test.ts": test },
    started: `${marker}.started`,
    done: `${marker}.done`,
  };
}

/**
 * Row 011-31: steps the old daemon down with a SessionStart while its tier
 * runs a file that would take 60 s. The tier is cancelled: the daemon reaches
 * its lock release within 15 s, stopped there (`STOP_GAP`) while the test
 * reads what it left: the file's row `queued`, no result, one note. Then the
 * hook's successor serves without another boundary.
 */
async function cancelsItsTier(cli: string, version: string, note: RegExp): Promise<void> {
  const slow = slowTest(60_000);
  const repo = suite.fixture({ ...slow.files, "squeal.config.json": runMissingConfig() });
  const old = start(cli, repo, [], STOP_GAP);
  const first = await waitFor(() => ping(repo.socketPath, 500), 60_000, "the old daemon serving");
  expect(first.squealVersion).toBe(version);
  await waitFor(() => existsSync(slow.started), 60_000, "the slow test running");
  const notes = readNotes(repo).length;

  const ensured: EnsureDaemonResult[] = [];
  const deps = hookDeps(repo, ensured);
  sockets.push(repo.socketPath);
  const at = performance.now();
  const took = await hook("session-start", repo, deps);
  if (!LOADED) expect(took).toBeLessThan(1_000);
  expect(ensured).toEqual(["spawned"]);

  const gap = await stoppedItself(first.pid, STEP_DOWN_WITHIN_MS);
  const ms = performance.now() - at;
  try {
    expect(gap, `the old daemon at its lock release within ${STEP_DOWN_WITHIN_MS} ms`).toBe(true);
    console.log(`011-31: the step-down reached the lock release in ${Math.round(ms)} ms`);
    expect(existsSync(slow.done)).toBe(false);
    const left = withStore(repo, (store) => ({
      rows: store.testFileKeys
        .list(repo.worktreeId)
        .filter((r) => r.testFile.path === "test/slow.test.ts"),
      results: store.knownStates
        .list(repo.worktreeId)
        .filter((s) => JSON.stringify(s.check).includes("waits") && s.validity === "current"),
    }));
    expect(left.rows.map((r) => r.pending)).toEqual(["queued"]);
    expect(left.results).toEqual([]);
    // One note: the hook's stop after the step-down writes none of its own.
    const stops = readNotes(repo)
      .slice(notes)
      .filter((n) => /^daemon stopped/.test(n));
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatch(note);
  } finally {
    resume(first.pid);
  }
  expect(await exitWithin(old, 30_000, repo)).toEqual({ code: 0, signal: null });
  await successorServes(repo, first.pid, notes);
}

/** No further boundary: the successor took the lock, recorded itself and serves at the hooks' version. */
async function successorServes(repo: FixtureRepo, old: number, notes: number): Promise<void> {
  const recorded = () => withStore(repo, (store) => store.worktrees.get(repo.worktreeId)?.daemon);
  const next = await waitFor(
    async () => {
      const answer = await ping(repo.socketPath, 500);
      return answer !== null && answer.pid !== old && recorded() ? answer : null;
    },
    60_000,
    "the successor serving",
  ).catch((error: Error) => {
    throw new Error(`${error.message}; notes:\n${readNotes(repo).slice(notes).join("\n")}`);
  });
  expect(next.squealVersion).toBe(HOOKS);
  expect(recorded()?.squealVersion).toBe(HOOKS);
}

/**
 * A daemon from before the step-down request: waits for its tier, steps it
 * down with a SessionStart, which sends it `stop`, and checks the handover:
 * the tier finished and stored, and the hook's successor serves without
 * another boundary.
 */
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
  sockets.push(repo.socketPath);
  const took = await hook("session-start", repo, deps);
  if (!LOADED) expect(took).toBeLessThan(1_000);
  // Task 001-130: the successor, spawned from the hook's own CLI, waits for the lock.
  expect(ensured).toEqual(["spawned"]);

  // The window: the old daemon finishes its tier and still holds the lock.
  expect(existsSync(slow.done)).toBe(false);
  await hook("post-tool-batch", repo, deps);
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
  await successorServes(repo, first.pid, notes);
}

describe("a daemon older than its hooks steps down (defect 26)", SLOW, () => {
  it.runIf(process.platform === "linux")(
    "cancels its tier in flight and is out within 15 s, its file queued, with one note; the hook's successor serves",
    async () => {
      const note = new RegExp(
        `daemon stopped: hooks at Squeal ${HOOKS.replaceAll(".", "\\.")} are newer than this daemon \\(0\\.1\\.0\\)`,
      );
      await cancelsItsTier(buildAt("0.1.0"), "0.1.0", note);
    },
  );

  it.runIf(hasPreStepDown)(
    "a released 0.1.31 daemon, from before the request, is sent stop and exits after its tier; a spawn meanwhile loses the lock",
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
