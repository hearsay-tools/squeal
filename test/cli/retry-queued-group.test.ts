import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { retryCommand } from "../../src/cli/retry.js";
import { startTurn } from "../../src/core/delivery/turn.js";
import type { HostLoad } from "../../src/core/retry/index.js";
import { publishGroupActivity } from "../../src/core/slow/state.js";
import { timeText } from "../../src/core/text.js";
import type { CheckKey, Consumer, EpochMs, RevisionNumber } from "../../src/core/types/index.js";
import { appendRevisions, check, fakeRepo, seedStore, state } from "../status/helpers.js";
import { closeFakeDaemons, fakeDaemon } from "./fake-daemon.js";

/*
 * Row 019-27 (spec 019 D3, D6; 019-16's notes, "Found, not fixed"): `squeal
 * retry` of a file a configured group owns says what holds its queued run
 * by its group, as the group's lane published, with `squeal run <group>`
 * where the group's moment holds it; a fast file is never held by a group
 * lane's run. Without a live daemon it reads nothing, as before.
 */

const E2E = "test/e2e/a.test.ts";
const OTHER = "test/e2e/b.test.ts";
const FAST = "test/b.test.ts";
const ref = (path: string) => ({ project: "", path: path as never });
const TAIL =
  "Its FAIL stays counted until a retry passes; squeal status lists the retry while it is pending.";
const queued = (path: string) =>
  `Retry queued (reason: environment): ${path} runs once more in its turn at its normal priority`;

const saved = { ...process.env };
let runtimeDir: string;
beforeEach(() => {
  runtimeDir = mkdtempSync("/tmp/sq-");
  process.env.XDG_RUNTIME_DIR = runtimeDir;
  process.env.XDG_CONFIG_HOME = runtimeDir;
});
afterEach(() => {
  closeFakeDaemons();
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

/** `E2E` and `FAST` failing, `OTHER` passing; `e2e`, at `stop`, owns `test/e2e/**`. */
async function worktree(daemon = true) {
  const repo = fakeRepo();
  const checks = [{ name: "e2e", runner: "vitest", tests: ["test/e2e/**"], at: "stop" }];
  writeFileSync(join(repo.main, "squeal.config.json"), JSON.stringify({ checks }));
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
  if (daemon) {
    const socket = join(runtimeDir, "daemon.sock");
    const record = { socketPath: socket, startedAt: at, heartbeatAt: at, squealVersion: "0" };
    store.worktrees.setDaemon(id, { ...record, heartbeatIntervalMs: 5_000 });
    const ping = { ok: true, type: "ping", pid: process.pid, worktreeId: id, root: repo.main };
    await fakeDaemon(socket, {
      ping: [{ ...ping, squealVersion: "0", phase: "ready", startedAt: at }],
    });
  }
  for (const [path, outcome] of [
    [E2E, "fail"],
    [OTHER, "pass"],
    [FAST, "fail"],
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
  const turn = () => {
    const consumer: Consumer = { worktreeId: id, sessionId: "s-busy", agentId: "main" };
    store.transaction(() => {
      store.consumers.register(consumer, at);
      startTurn(store, consumer);
    });
  };
  return { root: repo.main, store, id, run, turn, at };
}

async function retry(root: string, path: string) {
  let stdout = "";
  const io = { stdout: (t: string) => (stdout += t), stderr: (t: string) => (stdout += t) };
  const env = { CLAUDE_CODE_SESSION_ID: "s1" };
  const load = (): HostLoad => ({ oneMinute: 1.6, cpus: 8 });
  await retryCommand(
    [path, "--reason", "environment"],
    { ...io, cwd: root, env },
    { hostLoad: load },
  );
  return stdout;
}

describe("squeal retry words a configured group's file by its group (019-27)", () => {
  it("waiting for the agent to pause, with the group's run command", async () => {
    const w = await worktree();
    w.turn();
    publishGroupActivity(w.store, w.id, "e2e", { kind: "waiting", for: "idle" });
    expect(await retry(w.root, E2E)).toBe(
      `${queued(E2E)}; it has not started: the e2e group waits for the agent to pause; \`squeal run e2e\` runs it now. ${TAIL}\n`,
    );
  });

  it("behind its group's run of another file", async () => {
    const w = await worktree();
    w.run(OTHER, (w.at + 1_000) as EpochMs);
    const since = w.at + 1_000;
    publishGroupActivity(w.store, w.id, "e2e", {
      kind: "running",
      path: OTHER as never,
      since,
      lastDurationMs: null,
    });
    expect(await retry(w.root, E2E)).toBe(
      `${queued(E2E)}; it has not started: the e2e group runs other files, since ${timeText(since)}. ${TAIL}\n`,
    );
  });

  it("a fast file is not held by the group's run", async () => {
    const w = await worktree();
    w.run(OTHER, (w.at + 1_000) as EpochMs);
    expect(await retry(w.root, FAST)).toBe(
      `${queued(FAST)}; it has not started; what holds it is not known. ${TAIL}\n`,
    );
  });

  it("with no daemon, whose records it does not read", async () => {
    const w = await worktree(false);
    publishGroupActivity(w.store, w.id, "e2e", { kind: "waiting", for: "idle" });
    expect(await retry(w.root, E2E)).toBe(
      `${queued(E2E)}; it has not started; what holds it is not known. ${TAIL}\n` +
        "No daemon took the request now; it waits in the store for the next daemon at this file's inputs (squeal start starts one).\n",
    );
  });
});
