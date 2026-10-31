import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { retryCommand } from "../../src/cli/retry.js";
import type { HostLoad } from "../../src/core/retry/index.js";
import { publishSlowActivity } from "../../src/core/slow/state.js";
import { timeText } from "../../src/core/text.js";
import type { CheckKey, EpochMs, RevisionNumber } from "../../src/core/types/index.js";
import { appendRevisions, check, fakeRepo, seedStore, state } from "../status/helpers.js";
import { closeFakeDaemons, fakeDaemon } from "./fake-daemon.js";

/*
 * Row 011-272 (gh-114): `squeal retry` says a retry is queued, never that
 * it runs now, and, past the load gate, where its run stands as the live
 * daemon recorded it: not started and what holds it, or the file's own run
 * open, or that what holds it is not known.
 */

const A = "test/a.test.ts";
const B = "test/b.test.ts";
const ref = (path: string) => ({ project: "", path: path as never });
const TAIL =
  "Its FAIL stays counted until a retry passes; squeal status lists the retry while it is pending.";
const QUEUED = `Retry queued (reason: environment): ${A} runs once more in its turn at its normal priority`;

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

/** `A` failing and slow, `B` passing and fast; with `daemon`, a live one on its socket. */
async function worktree(daemon = true) {
  const repo = fakeRepo();
  writeFileSync(join(repo.main, "squeal.config.json"), JSON.stringify({ slow: { include: [A] } }));
  const store = seedStore(repo);
  const id = repo.mainId;
  const at = Date.now();
  store.worktrees.upsert({
    id,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  appendRevisions(store, id, 3, { head: null, dirty: false });
  const socket = join(runtimeDir, "daemon.sock");
  if (daemon) {
    const record = { socketPath: socket, startedAt: at, heartbeatAt: at, squealVersion: "0" };
    store.worktrees.setDaemon(id, { ...record, heartbeatIntervalMs: 5_000 });
    const ping = { ok: true, type: "ping", pid: process.pid, worktreeId: id, root: repo.main };
    await fakeDaemon(socket, {
      ping: [{ ...ping, squealVersion: "0", phase: "ready", startedAt: at }],
    });
  }
  for (const [path, outcome] of [
    [A, "fail"],
    [B, "pass"],
  ] as const) {
    const key = `key-${path}` as CheckKey;
    const row = { worktreeId: id, testFile: ref(path), key, revision: 3 as RevisionNumber };
    store.testFileKeys.upsertMany([{ ...row, pending: null }]);
    store.knownStates.upsertMany([state(id, check(path, "works"), { outcome, observedAt: 3 })]);
  }
  const run = (path: string, startedAt: EpochMs) => {
    store.testFileKeys.upsertMany([
      {
        worktreeId: id,
        testFile: ref(path),
        key: `key-${path}` as CheckKey,
        revision: 3 as RevisionNumber,
        pending: "running",
      },
    ]);
    store.runs.start({
      id: `run-${path}`,
      worktreeId: id,
      revision: 3 as RevisionNumber,
      testFiles: [ref(path)],
      checkpointId: null,
      logDir: `/tmp/run-${path}` as never,
      startedAt,
    });
  };
  return { root: repo.main, store, id, run, at };
}

async function retry(root: string, reason: "load" | "environment", load: HostLoad) {
  let stdout = "";
  const io = { stdout: (t: string) => (stdout += t), stderr: (t: string) => (stdout += t) };
  const env = { CLAUDE_CODE_SESSION_ID: "s1" };
  const code = await retryCommand(
    [A, "--reason", reason],
    { ...io, cwd: root, env },
    {
      hostLoad: () => load,
    },
  );
  return { code, stdout };
}

const CALM: HostLoad = { oneMinute: 1.6, cpus: 8 };

describe("squeal retry says queued, and what holds the run (row 011-272, gh-114)", () => {
  it("behind fast work: an open fast run", async () => {
    const w = await worktree();
    w.run(B, (w.at + 1_000) as EpochMs);
    expect(await retry(w.root, "environment", CALM)).toEqual({
      code: 0,
      stdout: `${QUEUED}; it has not started: fast work goes first (a run open since ${timeText(w.at + 1_000)}). ${TAIL}\n`,
    });
  });

  it("behind the slot another daemon holds, as its slow tier published", async () => {
    const w = await worktree();
    publishSlowActivity(w.store, w.id, { kind: "waiting", for: "slot" });
    expect((await retry(w.root, "environment", CALM)).stdout).toBe(
      `${QUEUED}; it has not started: the slow tier waits for capacity; whether the slow slot or the shared worker pool holds it is not known. ${TAIL}\n`,
    );
  });

  it("while its own run at these inputs is open", async () => {
    const w = await worktree();
    w.run(A, (w.at + 2_000) as EpochMs);
    expect((await retry(w.root, "environment", CALM)).stdout).toBe(
      `${QUEUED}; a run of it at these inputs is running since ${timeText(w.at + 2_000)}. ${TAIL}\n`,
    );
  });

  it("with no blocker evidence", async () => {
    const w = await worktree();
    expect((await retry(w.root, "environment", CALM)).stdout).toBe(
      `${QUEUED}; it has not started; what holds it is not known. ${TAIL}\n`,
    );
  });

  it("a load retry the load lets through is queued in its turn, not run now", async () => {
    const w = await worktree();
    const { stdout } = await retry(w.root, "load", CALM);
    expect(stdout).toBe(
      `Retry queued (reason: load): ${A} runs once more in its turn at its normal priority: the one-minute load average is below the CPU count (load average 1.60 on 8 CPUs); it has not started; what holds it is not known. ${TAIL}\n`,
    );
    expect(stdout).not.toMatch(/runs once more now|runs at once/);
  });

  it("with no daemon, whose records it does not read", async () => {
    const w = await worktree(false);
    publishSlowActivity(w.store, w.id, { kind: "waiting", for: "slot" });
    expect((await retry(w.root, "environment", CALM)).stdout).toBe(
      `${QUEUED}; it has not started; what holds it is not known. ${TAIL}\n` +
        "No daemon took the request now; it waits in the store for the next daemon at this file's inputs (squeal start starts one).\n",
    );
  });
});
