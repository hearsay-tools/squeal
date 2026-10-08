import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EnsureDaemonResult } from "../../src/core/types/index.js";
import { runNode } from "../harness/bundle-helpers.js";
import { recorded } from "../harness/helpers.js";
import { daemonSuite, delay, type FixtureRepo, ping, readNotes, SLOW, waitFor } from "./helpers.js";
import { stepDownKit } from "./step-down-helpers.js";

/*
 * Task 001-130, review wave 12b B1, with released bundles: a step-down never
 * ends in a daemon older than the one that left, whatever mix of plugins
 * shares the worktree. A session of an older plugin keeps the daemon from
 * being asked; with none, the requesting hook's successor serves without
 * another boundary once it is retrying at the lock; an older hook's spawn
 * before that can still win (D10, 001-145), so the case waits for it there.
 */

const suite = daemonSuite();
const {
  HOOKS,
  hasCommit,
  buildAt,
  releasedCli,
  releasedDist,
  start,
  sockets,
  hookDeps,
  hook,
  successorAtLock,
  exitWithin,
} = stepDownKit(suite);
/** Releases 0.1.31 (before the step-down request) and 0.1.32 (before this row). */
const R31 = "8654424";
const R32 = "dbeb862";
const hasReleases = hasCommit(R31) && hasCommit(R32) && process.platform === "linux";

/** Runs released Claude Code hook bundle `name` of `dist` for `sessionId`, as hooks.json does. */
async function releasedHook(dist: string, name: string, repo: FixtureRepo, sessionId: string) {
  const run = await runNode(
    ["--disable-warning=ExperimentalWarning", join(dist, `${name}.mjs`)],
    recorded(name, repo.root, { session_id: sessionId }),
    { XDG_RUNTIME_DIR: repo.runtimeDir },
  );
  expect(run.code, run.stderr).toBe(0);
}

/** Every version answering on the socket for `ms`, polled. */
async function versionsFor(repo: FixtureRepo, ms: number): Promise<Set<string>> {
  const seen = new Set<string>();
  const until = performance.now() + ms;
  while (performance.now() < until) {
    const answer = await ping(repo.socketPath, 500);
    if (answer !== null) seen.add(answer.squealVersion);
    await delay(50);
  }
  return seen;
}

describe.runIf(hasReleases)(
  "a step-down with released bundles of other versions (B1)",
  SLOW,
  () => {
    it("a 0.1.32 daemon, a current hook, then a released 0.1.31 hook: a current daemon serves", async () => {
      const repo = suite.fixture();
      const old = start(releasedCli(R32), repo);
      const first = await waitFor(() => ping(repo.socketPath, 500), 60_000, "0.1.32 serving");
      expect(first.squealVersion).toBe("0.1.32");

      const ensured: EnsureDaemonResult[] = [];
      sockets.push(repo.socketPath);
      await hook("session-start", repo, hookDeps(repo, ensured), "new");
      expect(ensured).toEqual(["spawned"]);
      // D10's handover: the successor retries the lock while the old daemon
      // stops. Its start (Node, its modules, git) can outlast an idle daemon's
      // stop, about 0.7 s against 0.5 s at load 140, and an older hook's
      // daemon that takes the lock then serves, D10's accepted limit (task
      // 001-145). So the older boundary comes once the successor retries.
      await waitFor(() => successorAtLock(repo), 30_000, "the successor at the lock");
      // The first boundary after the handover is an older plugin's.
      await releasedHook(releasedDist(R31), "post-tool-batch", repo, "old");
      expect(await exitWithin(old, 30_000, repo)).toEqual({ code: 0, signal: null });

      await waitFor(
        async () => (await ping(repo.socketPath, 500))?.squealVersion === HOOKS,
        30_000,
        "the successor serving",
      );
      expect(await versionsFor(repo, 2_000)).toEqual(new Set([HOOKS]));
      expect(readNotes(repo).filter((n) => /successor daemon gave up/.test(n))).toEqual([]);
    });

    it("with a released 0.1.31 session registered, a current hook asks nothing: 0.1.32 keeps serving", async () => {
      const repo = suite.fixture();
      const old = start(releasedCli(R32), repo);
      const first = await waitFor(() => ping(repo.socketPath, 500), 60_000, "0.1.32 serving");
      const r31 = releasedDist(R31);
      await releasedHook(r31, "session-start", repo, "old");

      const ensured: EnsureDaemonResult[] = [];
      await hook("session-start", repo, hookDeps(repo, ensured), "new");
      await hook("post-tool-batch", repo, hookDeps(repo, ensured), "new");
      await releasedHook(r31, "post-tool-batch", repo, "old");
      expect(ensured).toEqual(["alive"]);
      await delay(1_000);
      expect(await ping(repo.socketPath, 500)).toMatchObject({
        pid: first.pid,
        squealVersion: "0.1.32",
      });
      expect(old.child.exitCode).toBeNull();
    });
  },
);

describe("the successor's lock wait (squeal daemon --await-lock)", SLOW, () => {
  it("exits with a note when the lock is still held at its bound; the holder keeps serving", async () => {
    const repo = suite.fixture();
    const holder = start(buildAt("0.1.0"), repo);
    const first = await waitFor(() => ping(repo.socketPath, 500), 60_000, "a daemon serving");
    const notes = readNotes(repo).length;
    const successor = start(suite.cli, repo, ["--await-lock", "1500"]);
    const at = performance.now();
    expect(await exitWithin(successor, 30_000, repo)).toEqual({ code: 0, signal: null });
    expect(performance.now() - at).toBeGreaterThanOrEqual(1_400);
    expect(successor.stderr()).toMatch(/successor daemon gave up/);
    expect(readNotes(repo).slice(notes)).toEqual([
      expect.stringMatching(/successor daemon gave up: the lock was still held after 1500 ms/),
    ]);
    expect((await ping(repo.socketPath, 500))?.pid).toBe(first.pid);
    expect(holder.child.exitCode).toBeNull();
  });

  it("takes over once the older holder stops, and serves", async () => {
    const repo = suite.fixture();
    const holder = start(buildAt("0.1.0"), repo);
    const first = await waitFor(() => ping(repo.socketPath, 500), 60_000, "a daemon serving");
    const successor = start(suite.cli, repo, ["--await-lock", "60000"]);
    await delay(500);
    expect(successor.child.exitCode).toBeNull();
    holder.child.kill("SIGTERM");
    expect(await exitWithin(holder, 30_000, repo)).toEqual({ code: 0, signal: null });
    const next = await waitFor(
      async () => {
        const answer = await ping(repo.socketPath, 500);
        return answer !== null && answer.pid !== first.pid ? answer : null;
      },
      30_000,
      "the successor serving",
    );
    expect(next.pid).toBe(successor.child.pid);
  });

  it("exits at once, with no note, while a daemon at least as new holds the lock", async () => {
    const repo = suite.fixture();
    start(suite.cli, repo);
    const first = await waitFor(() => ping(repo.socketPath, 500), 60_000, "a daemon serving");
    const notes = readNotes(repo).length;
    const successor = start(suite.cli, repo, ["--await-lock", "60000"]);
    expect(await exitWithin(successor, 30_000, repo)).toEqual({ code: 0, signal: null });
    expect(successor.stderr()).toMatch(/another daemon serves/);
    expect(readNotes(repo).slice(notes)).toEqual([]);
    expect((await ping(repo.socketPath, 500))?.pid).toBe(first.pid);
  });

  it("refuses a malformed wait", async () => {
    const repo = suite.fixture();
    for (const args of [["--await-lock"], ["--await-lock", "soon"], ["--await", "10"]]) {
      const usage = start(suite.cli, repo, args);
      expect(await exitWithin(usage, 30_000, repo)).toEqual({ code: 2, signal: null });
    }
  });
});
