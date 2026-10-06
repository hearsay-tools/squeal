import { describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { waitForStatus } from "../../src/cli/status-wait.js";
import { readStatus } from "../../src/core/status/index.js";
import {
  type DaemonRecord,
  type KnownState,
  refinedMetaKey,
  type Store,
} from "../../src/core/types/index.js";
import { appendRevisions, check, fakeRepo, seedStore, state } from "../status/helpers.js";

/*
 * Spec 001 D7 as amended: "`squeal status --wait <ms>` blocks until nothing
 * is pending at the current revision or a new transition is recorded, then
 * prints the snapshot; it replaces polling with `sleep`." Lessons, surprise 3.
 */

const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);
const ADDS = check("src/a.test.ts", "adds");
const SUBTRACTS = check("src/a.test.ts", "subtracts");

async function run(argv: string[], cwd: string) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd,
    now: () => NOW,
  };
  const started = performance.now();
  const code = await main(argv, io);
  return { code, stdout, stderr, elapsed: performance.now() - started };
}

const LIVE: DaemonRecord = {
  socketPath: "/tmp/squeal-test.sock",
  startedAt: NOW - 60_000,
  heartbeatAt: NOW - 1_000,
  heartbeatIntervalMs: 5_000,
  squealVersion: "0.0.0-test",
};

/** A worktree at revision 3 whose checks are `states`, with a validating daemon unless `daemon` says otherwise. */
function repoWith(...states: ((id: string) => KnownState)[]) {
  return repoWithDaemon(LIVE, ...states);
}

function repoWithDaemon(daemon: DaemonRecord | null, ...states: ((id: string) => KnownState)[]) {
  const repo = fakeRepo();
  const store = seedStore(repo);
  store.worktrees.upsert({
    id: repo.mainId,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon,
  });
  appendRevisions(store, repo.mainId, 3, { head: null, dirty: false });
  store.knownStates.upsertMany(states.map((s) => s(repo.mainId)));
  return { repo, store };
}

const pendingPass =
  (c = ADDS) =>
  (id: string) =>
    state(id, c, { validity: "pending", pendingPhase: "running", observedAt: 2 });
const currentPass =
  (c = ADDS) =>
  (id: string) =>
    state(id, c, { observedAt: 3 });

function later(ms: number, fn: () => void) {
  setTimeout(fn, ms);
}

function settle(store: Store, id: string, ...states: KnownState[]) {
  store.knownStates.upsertMany(states.map((s) => ({ ...s, worktreeId: id })));
}

describe("squeal status --wait <ms>", () => {
  it("returns on quiet once nothing is pending at the current revision", async () => {
    const { repo, store } = repoWith(pendingPass(), currentPass(SUBTRACTS));
    later(400, () => settle(store, repo.mainId, state(repo.mainId, ADDS, { observedAt: 3 })));

    const { code, stdout, stderr, elapsed } = await run(["status", "--wait", "5000"], repo.main);

    expect(code).toBe(0);
    expect(stderr).toBe("");
    const [first, blank, ...rest] = stdout.split("\n");
    expect(first).toMatch(/^Returned on quiet: nothing pending at revision 3 after \d+\.\d s$/);
    expect(blank).toBe("");
    expect(rest.join("\n")).toContain("Revision: 3\nKnown failures: 0\n");
    expect(elapsed).toBeGreaterThanOrEqual(400);
    expect(elapsed).toBeLessThan(2_000);
  });

  it("returns on news when a check changes notably, even with work still pending", async () => {
    const { repo, store } = repoWith(pendingPass(), pendingPass(SUBTRACTS));
    later(300, () =>
      settle(
        store,
        repo.mainId,
        state(repo.mainId, ADDS, {
          outcome: "fail",
          observedAt: 3,
          summary: "expected 3, received 4",
          fingerprint: "AssertionError: expected 3, received 4",
        }),
      ),
    );

    const { code, stdout, elapsed } = await run(["status", "--wait", "5000"], repo.main);

    expect(code).toBe(0);
    expect(stdout.split("\n")[0]).toMatch(
      /^Returned on news: 1 transition since the wait started, at revision 3 after \d+\.\d s$/,
    );
    expect(stdout).toContain("  FAIL  src/a.test.ts > adds\n");
    expect(elapsed).toBeLessThan(2_000);
  });

  it("returns on timeout with what is still pending, and exits 0", async () => {
    const { repo } = repoWith(pendingPass(), pendingPass(SUBTRACTS));

    const { code, stdout, elapsed } = await run(["status", "--wait", "600"], repo.main);

    expect(code).toBe(0);
    expect(stdout.split("\n")[0]).toMatch(
      /^Returned on timeout after \d+\.\d s: 2 checks pending at revision 3$/,
    );
    expect(elapsed).toBeGreaterThanOrEqual(590);
    expect(elapsed).toBeLessThan(1_500);
  });

  it("does not read a quiet store as quiet before a revision could have been recorded", async () => {
    const { repo } = repoWith(currentPass());

    const { stdout, elapsed } = await run(["status", "--wait", "5000"], repo.main);

    expect(stdout.split("\n")[0]).toMatch(/^Returned on quiet/);
    // Spec 001 D2: a revision within 500 ms of quiet; an edit just before the call is not lost.
    expect(elapsed).toBeGreaterThanOrEqual(700);
  });

  it("keeps stdout the snapshot JSON with --json and says why it returned on stderr", async () => {
    const { repo } = repoWith(pendingPass());

    const { code, stdout, stderr } = await run(["status", "--json", "--wait=300"], repo.main);

    expect(code).toBe(0);
    const { wait, ...snapshot } = JSON.parse(stdout) as { wait: unknown };
    expect(snapshot).toEqual(readStatus(repo.main, { now: () => NOW }));
    expect(wait).toEqual({ outcome: "timeout", waitedMs: expect.any(Number), transitions: 0 });
    expect(stderr).toMatch(
      /^Returned on timeout after \d+\.\d s: 1 check pending at revision 3\n$/,
    );
  });

  it("waits while the runner part of the current revision is pending (review wave 4.5, S1)", async () => {
    const { repo, store } = repoWith(currentPass());
    store.meta.set(refinedMetaKey(repo.mainId), "2");

    const { code, stdout } = await run(["status", "--wait", "1000"], repo.main);

    expect(code).toBe(0);
    expect(stdout.split("\n")[0]).toMatch(
      /^Returned on timeout after \d+\.\d s: 0 checks and the runner part of revision 3 pending at revision 3$/,
    );
  });

  it("returns once the runner part was applied", async () => {
    const { repo, store } = repoWith(currentPass());
    store.meta.set(refinedMetaKey(repo.mainId), "2");
    later(900, () => store.meta.set(refinedMetaKey(repo.mainId), "3"));

    const { stdout, elapsed } = await run(["status", "--wait", "5000"], repo.main);

    expect(stdout.split("\n")[0]).toMatch(/^Returned on quiet: nothing pending at revision 3/);
    expect(elapsed).toBeGreaterThanOrEqual(900);
    expect(elapsed).toBeLessThan(2_500);
  });

  it("only reads the store", async () => {
    const { repo, store } = repoWith(pendingPass());
    const before = JSON.stringify([
      store.consumers.list(repo.mainId),
      store.knownStates.list(repo.mainId),
    ]);

    await run(["status", "--wait", "300"], repo.main);

    expect(
      JSON.stringify([store.consumers.list(repo.mainId), store.knownStates.list(repo.mainId)]),
    ).toBe(before);
  });

  it("reports an unavailable status at once and exits 1", async () => {
    const { code, stdout, elapsed } = await run(["status", "--wait", "5000"], fakeRepo().main);

    expect(code).toBe(1);
    expect(stdout).toMatch(/^Status unavailable, no Squeal store at /);
    expect(elapsed).toBeLessThan(500);
  });

  it.each([[["--wait"]], [["--wait", "soon"]], [["--wait", "-5"]], [["--wait=1.5"]]])(
    "rejects %j",
    async (args) => {
      const { code, stderr } = await run(["status", ...args], fakeRepo().main);

      expect(code).toBe(2);
      expect(stderr).toContain("squeal status: --wait takes a whole number of milliseconds");
    },
  );
});

/*
 * Review wave 4.5, S2: quiet ignored liveness, so with no daemon the wait said
 * "nothing pending" whatever the files held. Vision: "It says 'no known
 * failures', not 'everything passes', unless it has actually run everything".
 */
describe("squeal status --wait without a daemon (review wave 4.5, S2)", () => {
  it("returns without a daemon when the heartbeat is stale, and says since when", async () => {
    const stale = { ...LIVE, heartbeatAt: NOW - 60_000 };
    const { repo } = repoWithDaemon(stale, currentPass());

    const { code, stdout, stderr, elapsed } = await run(["status", "--wait", "5000"], repo.main);

    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout.split("\n")[0]).toBe(
      "Returned without a daemon: no daemon has validated since 2026-10-06T11:59:00.000Z; " +
        "results are as of revision 3",
    );
    expect(stdout).toContain("Daemon: no daemon running since 2026-10-06T11:59:00.000Z\n");
    // A daemon a hook just spawned gets the settle time to record its heartbeat.
    expect(elapsed).toBeGreaterThanOrEqual(700);
    expect(elapsed).toBeLessThan(2_000);
  });

  it("returns without a daemon when none ever ran, with pending work it cannot finish", async () => {
    const { repo } = repoWithDaemon(null, pendingPass());

    const { code, stdout, elapsed } = await run(["status", "--wait", "5000"], repo.main);

    expect(code).toBe(0);
    expect(stdout.split("\n")[0]).toBe(
      "Returned without a daemon: no daemon is running; results are as of revision 3",
    );
    expect(elapsed).toBeLessThan(2_000);
  });

  it("names the outcome in a JSON field of its own", async () => {
    const { repo } = repoWithDaemon(null, currentPass());

    const { code, stdout, stderr } = await run(["status", "--json", "--wait", "5000"], repo.main);

    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      daemon: { state: "down", since: null },
      wait: { outcome: "no-daemon", transitions: 0 },
    });
    expect(stderr).toMatch(/^Returned without a daemon: no daemon is running;/);
  });

  it("waits as usual for a daemon that comes alive within the settle time", async () => {
    const { repo, store } = repoWithDaemon(null, pendingPass());
    later(300, () => store.worktrees.setDaemon(repo.mainId, LIVE));
    later(1_000, () => settle(store, repo.mainId, state(repo.mainId, ADDS, { observedAt: 3 })));

    const { stdout } = await run(["status", "--wait", "5000"], repo.main);

    expect(stdout.split("\n")[0]).toMatch(/^Returned on quiet: nothing pending at revision 3/);
  });
});

describe("waitForStatus", () => {
  it("polls at the given interval and reports the outcome with the snapshot", async () => {
    const { repo } = repoWith(currentPass());

    const wait = await waitForStatus(repo.main, {
      timeoutMs: 1_000,
      pollMs: 20,
      settleMs: 0,
      now: () => NOW,
    });

    expect(wait.outcome).toBe("quiet");
    expect(wait.result).toMatchObject({ available: true, revision: 3 });
    expect(wait.waitedMs).toBeLessThan(200);
  });
});
