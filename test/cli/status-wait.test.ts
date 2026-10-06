import { describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { waitForStatus } from "../../src/cli/status-wait.js";
import { readStatus } from "../../src/core/status/index.js";
import type { KnownState, Store } from "../../src/core/types/index.js";
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

/** A worktree at revision 3 whose checks are `states`. */
function repoWith(...states: ((id: string) => KnownState)[]) {
  const repo = fakeRepo();
  const store = seedStore(repo);
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
    expect(JSON.parse(stdout)).toEqual(readStatus(repo.main, { now: () => NOW }));
    expect(stderr).toMatch(
      /^Returned on timeout after \d+\.\d s: 1 check pending at revision 3\n$/,
    );
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

describe("waitForStatus", () => {
  it("polls at the given interval and reports the outcome with the snapshot", async () => {
    const { repo } = repoWith(currentPass());

    const wait = await waitForStatus(repo.main, { timeoutMs: 1_000, pollMs: 20, settleMs: 0 });

    expect(wait.outcome).toBe("quiet");
    expect(wait.result).toMatchObject({ available: true, revision: 3 });
    expect(wait.waitedMs).toBeLessThan(200);
  });
});
