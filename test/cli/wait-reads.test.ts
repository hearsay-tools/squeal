import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import type { DaemonSync } from "../../src/cli/status-sync.js";
import { STATUS_WAIT_POLL_MS, waitForStatus } from "../../src/cli/status-wait.js";
import { waitForNamed } from "../../src/cli/status-wait-paths.js";
import type { openStore as OpenStore } from "../../src/core/store/index.js";
import type { RevisionNumber } from "../../src/core/types/index.js";
import { appendRevisions, check, fakeRepo, seedStore, state } from "../status/helpers.js";
import { sessions } from "./counting-store.js";
import { closeFakeDaemons, fakeDaemon } from "./fake-daemon.js";
import { A, answering, B, key, NOW, repoWith, SLOW_FILE } from "./status-wait-fixture.js";

/*
 * Task 011-42 (C6 as amended 2026-10-20): a wait the agent asked for polls
 * once a second, and a poll that cannot end it reads no known state it does
 * not hold for. Each wait here runs 2.5 s: polls at 0, 1 and 2 s and the
 * deadline's at 2.5 s, one more just before it when the deadline's timer
 * fires a fraction early (`wait-clock.ts`), and one when its sync answers,
 * where a 250 ms poll made 11.
 */

vi.mock("../../src/core/store/index.js", async (importOriginal) => {
  const original = await importOriginal<{ openStore: typeof OpenStore }>();
  const { counting } = await import("./counting-store.js");
  return { ...original, openStore: counting(original.openStore) };
});

const WAIT_MS = 2_500;
const saved = { ...process.env };
let runtimeDir: string;
beforeEach(() => {
  runtimeDir = mkdtempSync("/tmp/sq-");
  process.env.XDG_RUNTIME_DIR = runtimeDir;
});
afterEach(() => {
  closeFakeDaemons();
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

const io = (cwd: string): CliIo => ({ stdout: () => {}, stderr: () => {}, cwd, now: () => NOW });

/** `answering`'s daemon, which also says when it answered, as `syncDaemon` does. */
function announcing(sync: () => DaemonSync, answerMs: number): () => DaemonSync {
  return () => ({ ...sync(), answered: sleep(answerMs + 10) });
}

/** The polls between a wait's first read and the one that ended it. */
function between<T>(polls: readonly T[]): readonly T[] {
  expect(polls.length).toBeGreaterThanOrEqual(3);
  expect(polls.length).toBeLessThanOrEqual(6);
  return polls.slice(1, -1);
}

describe("a wait polls once a second and reads only what decides it (C6, 011-42)", () => {
  it("status --wait reads no state while the daemon has not named the edit's files", async () => {
    const { repo, store } = repoWith([A], [B]);
    const { sync } = answering(store, repo.mainId, [A], undefined, 60_000);
    sessions.length = 0;

    const wait = await waitForStatus(repo.main, { timeoutMs: WAIT_MS, now: () => NOW, sync });

    expect(wait.outcome).toBe("timeout");
    expect(sessions[0]?.reads).toEqual(["states"]);
    for (const poll of between(sessions)) expect(poll.reads).toEqual([]);
  });

  it("status --wait reads the edit's files' states once the daemon named them", async () => {
    const { repo, store } = repoWith([A], [B]);
    const { sync } = answering(store, repo.mainId, [A]);
    sessions.length = 0;

    const wait = await waitForStatus(repo.main, { timeoutMs: WAIT_MS, now: () => NOW, sync });

    expect(wait).toMatchObject({ outcome: "timeout", edit: { testFiles: 1, pending: 1 } });
    for (const poll of between(sessions)) expect(poll.reads).toEqual(["file-states"]);
  });

  it("status --wait <path> reads the selected files' states, and every state only at its end", async () => {
    const { repo } = repoWith([A], [B]);
    sessions.length = 0;

    const code = await main(["status", "--wait", String(WAIT_MS), A], io(repo.main));

    expect(code).toBe(3);
    const polls = sessions.filter((s) => s.reads.includes("file-states"));
    for (const poll of between(polls)) expect(poll.reads).toEqual(["file-states"]);
    expect(sessions.slice(0, -1).filter((s) => s.reads.includes("states"))).toEqual([]);
    expect(sessions.at(-1)?.reads).toContain("states");
  });

  it("status --wait <slow file> under slow.trigger idle reads only its states while it runs", async () => {
    const { repo, store } = repoWith([SLOW_FILE]);
    key(store, repo.mainId, SLOW_FILE, "running");
    writeFileSync(
      join(repo.main, "squeal.config.json"),
      JSON.stringify({ slow: { include: [SLOW_FILE], trigger: "idle" } }),
    );
    const synced = { state: "synced", revision: 4 as RevisionNumber, incarnation: null } as const;
    const sync = (): DaemonSync => ({ current: () => synced, stop: () => {} });
    sessions.length = 0;

    const wait = await waitForNamed(repo.main, [SLOW_FILE], {
      timeoutMs: WAIT_MS,
      pollMs: 1_000,
      settleMs: 0,
      now: () => NOW,
      sync,
    });

    expect(wait.outcome).toBe("timeout");
    // Reviews/011-42.md: `pauseOnlyIds` read every state on each poll that found the wait ready.
    for (const poll of between(sessions)) expect(poll.reads).not.toContain("states");
  });

  // CI on cand/0.1.227: a quiet wait read its sync's answer a poll late and ended 2 s in.
  it("status --wait reads the store when its sync answers, not a poll later", async () => {
    const { repo, store } = repoWith([], [A]);
    const { sync } = answering(store, repo.mainId, [], undefined, 50);

    const wait = await waitForStatus(repo.main, {
      timeoutMs: WAIT_MS,
      now: () => NOW,
      sync: announcing(sync, 50),
    });

    expect(wait.outcome).toBe("quiet");
    expect(wait.waitedMs).toBeLessThan(STATUS_WAIT_POLL_MS);
  });

  it("status --wait <path> reads the store when its sync answers, not a poll later", async () => {
    const { repo, store } = repoWith([], [A]);
    const { sync } = answering(store, repo.mainId, [], undefined, 50);

    const wait = await waitForNamed(repo.main, [A], {
      timeoutMs: WAIT_MS,
      pollMs: STATUS_WAIT_POLL_MS,
      settleMs: 0,
      now: () => NOW,
      sync: announcing(sync, 50),
    });

    expect(wait.outcome).toBe("settled");
    expect(wait.waitedMs).toBeLessThan(STATUS_WAIT_POLL_MS);
  });

  it("status --wait polls once a second after its sync answered", async () => {
    const { repo, store } = repoWith([A], [B]);
    const { sync } = answering(store, repo.mainId, [A], undefined, 50);
    sessions.length = 0;

    const wait = await waitForStatus(repo.main, {
      timeoutMs: WAIT_MS,
      now: () => NOW,
      sync: announcing(sync, 50),
    });

    expect(wait.outcome).toBe("timeout");
    // An answered sync wakes no other read.
    between(sessions);
  });

  it("run --all --wait reads the checkpoint and the revision until it ends, and the verdict at the deadline", async () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    const id = repo.mainId;
    const socket = join(runtimeDir, "daemon.sock");
    store.worktrees.upsert({
      id,
      root: repo.main,
      commonDir: repo.commonDir,
      isMain: true,
      registeredAt: 1,
      daemon: {
        socketPath: socket,
        startedAt: Date.now(),
        heartbeatAt: Date.now(),
        heartbeatIntervalMs: 5_000,
        squealVersion: "0.0.0-test",
      },
    });
    appendRevisions(store, id, 3, { head: null, dirty: false });
    store.testFileKeys.upsertMany([
      { worktreeId: id, testFile: { project: "", path: A }, key: null, revision: 3, pending: null },
    ]);
    store.knownStates.upsertMany([state(id, check(A, "adds"), { observedAt: 3 })]);
    const checkpoint = store.checkpoints.start({
      id: "c1",
      worktreeId: id,
      revision: 3 as RevisionNumber,
      kind: "run-all",
      testFiles: [{ project: "", path: A }],
      startedAt: Date.now(),
    });
    const ok = { ok: true, type: "run-all", requestId: "r1", checkpoint, error: null };
    await fakeDaemon(socket, { "run-all": [ok] });
    sessions.length = 0;

    const code = await main(["run", "--all", `--wait=${WAIT_MS}`], {
      ...io(repo.main),
      now: Date.now,
    });

    expect(code).toBe(3);
    const polls = sessions.filter((s) => s.reads[0] === "checkpoint");
    for (const poll of between(polls)) expect(poll.reads).toEqual(["checkpoint"]);
    expect(polls.at(-1)?.reads).toEqual(["checkpoint", "states"]);
  });
});
