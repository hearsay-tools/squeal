import { describe, expect, it } from "vitest";
import { fileEntry } from "../../src/cli/named-file-lines.js";
import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import { namedText } from "../../src/cli/status-wait-lines.js";
import { waitForNamed } from "../../src/cli/status-wait-paths.js";
import { testFileId } from "../../src/core/keys/index.js";
import { publishPromotions } from "../../src/core/scheduler/promotions.js";
import type { EpochMs, RevisionNumber, Store } from "../../src/core/types/index.js";
import { check, state } from "../status/helpers.js";
import { A, B, key, later, NOW, ref, repoWith } from "./status-wait-fixture.js";

/*
 * Task 011-13 (011 C15): a pending selected file the live daemon published as
 * promoted reads `queued, promoted, behind the <lane> tier ...` while its
 * promotion holds, and `queued` after its deadline, from a predecessor's
 * row, or from a daemon that publishes none (older than 011-13).
 */

const clock = (at: number) => {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const STARTED = NOW - 30_000;
const DAEMON_STARTED = NOW - 60_000;

const synced = (): SyncState => ({
  state: "synced",
  revision: 4 as RevisionNumber,
  incarnation: null,
});
const sync = () => (): DaemonSync => ({ current: synced, stop: () => {} });

async function timedOut(root: string, paths: readonly string[]) {
  const wait = await waitForNamed(root, paths, {
    timeoutMs: 60,
    pollMs: 20,
    settleMs: 0,
    now: () => NOW,
    sync: sync(),
    promote: () => {},
  });
  if (wait.outcome === "unavailable") throw new Error("unavailable");
  return { wait, text: namedText(wait, NOW) };
}

/** A running in an open tier of the vitest lane, B queued behind it. */
function behindA() {
  const { repo, store } = repoWith([B]);
  key(store, repo.mainId, A, "running");
  store.knownStates.upsertMany([
    state(repo.mainId, check(A, "holds"), { validity: "pending", pendingPhase: "running" }),
  ]);
  store.runs.start({
    id: "run-a",
    worktreeId: repo.mainId,
    revision: 4 as RevisionNumber,
    testFiles: [ref(A)],
    checkpointId: null,
    logDir: "/tmp/run-a",
    startedAt: STARTED,
  });
  return { repo, store };
}

function promoteB(store: Store, worktreeId: string, until: number, at = NOW - 1_000) {
  publishPromotions(
    store,
    worktreeId,
    [{ files: [testFileId(ref(B))], until: until as EpochMs }],
    at as EpochMs,
  );
}

const behind = `behind the vitest tier of 1 test file running since ${clock(STARTED)}`;

describe("a named wait says when the daemon promoted a pending file (011-13)", () => {
  it("queued, promoted, behind the lane's tier while the promotion holds", async () => {
    const { repo, store } = behindA();
    promoteB(store, repo.mainId, NOW + 60_000);

    const { wait, text } = await timedOut(repo.main, [A, B]);

    expect(text).toContain(`  1 queued, promoted, ${behind}: ${B}; `);
    expect(text.trimEnd().split("\n").at(-1)).toContain(`1 queued, promoted, ${behind}.`);
    const entry = wait.files.find((f) => f.testFile.path === B);
    expect(entry && fileEntry(entry, "squeal").reason).toBe(`queued, promoted, ${behind}`);
    // The running file is not promoted by being named beside it.
    expect(text).toContain(`  1 running since ${clock(STARTED)} in the vitest lane: ${A}\n`);
  });

  it("queued, promoted, behind the lane's tier when its own promotion ends with the wait (011-63)", async () => {
    // gh-51 3: the promotion lasts until the wait's deadline, which its last read is at or after.
    const { repo, store } = behindA();
    const started = performance.now();
    const now = () => (NOW + Math.round(performance.now() - started)) as EpochMs;
    const wait = await waitForNamed(repo.main, [B], {
      timeoutMs: 200,
      pollMs: 20,
      settleMs: 0,
      now,
      sync: sync(),
      // As the daemon does: until its own clock plus the time left (011-11), published (011-13).
      promote: (_root, files, withinMs) =>
        later(0, () => {
          const until = (now() + Math.round(withinMs)) as EpochMs;
          publishPromotions(store, repo.mainId, [{ files: files.map(testFileId), until }], now());
        }),
    });
    if (wait.outcome === "unavailable") throw new Error("unavailable");

    expect(wait.outcome).toBe("timeout");
    const text = namedText(wait, now());
    expect(text).toContain(`  1 queued, promoted, ${behind}: ${B}; `);
    expect(text.trimEnd().split("\n").at(-1)).toContain(
      `still pending at revision 4: 1 queued, promoted, ${behind}. Worktree: `,
    );
  });

  it("queued after the deadline", async () => {
    const { repo, store } = behindA();
    promoteB(store, repo.mainId, NOW);

    const { text } = await timedOut(repo.main, [B]);

    expect(text).toContain(`  1 queued ${behind}: ${B}; `);
    expect(text).not.toContain("promoted");
  });

  it("queued from an older daemon, which publishes nothing, and from a predecessor's row", async () => {
    const older = behindA();
    expect((await timedOut(older.repo.main, [B])).text).toContain(`  1 queued ${behind}: ${B}; `);

    const successor = behindA();
    promoteB(successor.store, successor.repo.mainId, NOW + 60_000, DAEMON_STARTED - 1);
    const { text } = await timedOut(successor.repo.main, [B]);
    expect(text).toContain(`  1 queued ${behind}: ${B}; `);
    expect(text).not.toContain("promoted");
  });

  it("queued, promoted, with no tier in its lane", async () => {
    const { repo, store } = repoWith([B]);
    promoteB(store, repo.mainId, NOW + 60_000);

    const { text } = await timedOut(repo.main, [B]);

    expect(text).toContain(`Pending (1):\n  1 queued, promoted: ${B}\n`);
  });
});
