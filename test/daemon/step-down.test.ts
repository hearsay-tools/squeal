import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { EnsureDaemonResult } from "../../src/core/types/index.js";
import {
  daemonSuite,
  delay,
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
 * older than the hooks that call it lets its running tier finish and store,
 * persists one note and exits, and the successor the hook spawned with a lock
 * wait serves (task 001-130). While the old one finishes it holds the lock,
 * so a daemon spawned in that window loses it and exits. An equal or newer
 * daemon is left alone.
 * Hooks run in this process at the sources' version (`package.json`).
 */

const suite = daemonSuite();
const { HOOKS, hasCommit, buildAt, releasedCli, start, sockets, hookDeps, hook, exitWithin } =
  stepDownKit(suite);
/** The last release before the step-down request: its daemon answers it "unknown request type". */
const PRE_STEP_DOWN = "8654424";
const hasPreStepDown = hasCommit(PRE_STEP_DOWN);

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
 * Waits for the old daemon's tier, steps it down with a SessionStart and
 * checks the handover: the hook's successor serves without another boundary.
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

  // No further boundary: the successor took the lock and serves at the hooks' version.
  const next = await waitFor(
    async () => {
      const answer = await ping(repo.socketPath, 500);
      return answer !== null && answer.pid !== first.pid ? answer : null;
    },
    60_000,
    "the successor serving",
  );
  expect(next.squealVersion).toBe(HOOKS);
  expect(
    withStore(repo, (store) => store.worktrees.get(repo.worktreeId)?.daemon?.squealVersion),
  ).toBe(HOOKS);
}

describe("a daemon older than its hooks steps down (defect 26)", SLOW, () => {
  it("after its running tier, with one note; a spawn meanwhile loses the lock; the hook's successor serves", async () => {
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
