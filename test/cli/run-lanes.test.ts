import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import type {
  CheckId,
  CheckKey,
  CheckpointRecord,
  RevisionNumber,
  Validity,
} from "../../src/core/types/index.js";
import { appendRevisions, check, fakeRepo, seedStore, state } from "../status/helpers.js";
import { closeFakeDaemons, fakeDaemon, received } from "./fake-daemon.js";

/*
 * Task 004-61: `--fast` and `--slow` select lanes for a full run. `--fast`
 * asks the daemon for the fast lane's checkpoint, which says it is not a
 * full-suite one and gives its verdict on the fast lane's files; `--all
 * --slow` is `run --slow`; both flags are `--all`.
 */

const FAST = "test/a.test.ts";
const SLOW = "test/e2e/b.test.ts";
const ref = (path: string) => ({ project: "", path: path as never });
const fileCheck = (path: string): CheckId => ({ kind: "file", project: "", testPath: path });

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

/** A worktree at revision 3 with one fast and one slow file, and its daemon's socket. */
function worktree() {
  const repo = fakeRepo();
  writeFileSync(
    join(repo.main, "squeal.config.json"),
    JSON.stringify({ slow: { include: ["test/e2e/**"] } }),
  );
  const store = seedStore(repo);
  const id = repo.mainId;
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
  store.worktrees.setDaemon(id, {
    socketPath: socket,
    startedAt: Date.now(),
    heartbeatAt: Date.now(),
    heartbeatIntervalMs: 5_000,
    squealVersion: "0.0.0-test",
  });
  const file = (path: string, validity: Validity) => {
    const pending = validity === "pending" ? ("queued" as const) : null;
    store.testFileKeys.upsertMany([
      {
        worktreeId: id,
        testFile: ref(path),
        key: `key-${path}` as CheckKey,
        revision: 3 as RevisionNumber,
        pending,
      },
    ]);
    store.knownStates.upsertMany([
      state(id, check(path, "works"), { validity, pendingPhase: pending, observedAt: 3 }),
      state(id, fileCheck(path), { validity, pendingPhase: pending, observedAt: 3 }),
    ]);
  };
  const checkpoint = (lane?: "fast"): CheckpointRecord =>
    store.checkpoints.start({
      id: "c1",
      worktreeId: id,
      revision: 3 as RevisionNumber,
      kind: "run-all",
      testFiles: [ref(FAST)],
      startedAt: Date.now(),
      ...(lane === undefined ? {} : { lane }),
    });
  return { root: repo.main, store, socket, file, checkpoint };
}

function daemonFor(socket: string, record: CheckpointRecord) {
  return fakeDaemon(socket, {
    "run-all": [{ ok: true, type: "run-all", requestId: "r1", checkpoint: record, error: null }],
    "run-slow": [
      { ok: true, type: "run-slow", requestId: "r2", requested: { revision: 3, queued: 1 } },
    ],
  });
}

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
  };
  const code = await main(argv, io);
  return { code, stdout, stderr, first: stdout.split("\n")[0] };
}

const sent = () => received.filter((r) => r.type === "run-all" || r.type === "run-slow");

describe("run lane flags (task 004-61)", () => {
  it("--fast asks for the fast lane and its verdict waits for no slow file", async () => {
    const w = worktree();
    w.file(FAST, "current");
    w.file(SLOW, "pending");
    const record = w.checkpoint("fast");
    w.store.checkpoints.finish("c1", "completed", Date.now());
    await daemonFor(w.socket, record);
    const result = await run(["run", "--fast", "--wait", "5000"], w.root);
    expect(sent()).toEqual([{ type: "run-all", force: false, lane: "fast" }]);
    expect(result.first).toBe(
      "Checkpoint c1 (the fast lane only, not a full-suite checkpoint: slow test files are not in it) completed at revision 3: no known failures; 1 test file, 0 already current, 1 run now",
    );
    expect(result.code).toBe(0);
  });

  it("names the lane when the checkpoint starts", async () => {
    const w = worktree();
    w.file(FAST, "pending");
    await daemonFor(w.socket, w.checkpoint("fast"));
    const result = await run(["run", "--all", "--fast"], w.root);
    expect(result.stdout).toBe(
      "Checkpoint c1 (the fast lane only, not a full-suite checkpoint: slow test files are not in it) started at revision 3: 1 test file to run, 0 already current\n",
    );
  });

  it("says when a daemon from before lanes ran both", async () => {
    const w = worktree();
    w.file(FAST, "pending");
    await daemonFor(w.socket, w.checkpoint());
    const result = await run(["run", "--fast"], w.root);
    expect(result.first).toBe(
      "Checkpoint c1 (both lanes: this daemon predates `--fast`) started at revision 3: 1 test file to run, 0 already current",
    );
  });

  it("--fast --slow is --all, and --all --slow is run --slow", async () => {
    const w = worktree();
    w.file(FAST, "pending");
    await daemonFor(w.socket, w.checkpoint());
    expect((await run(["run", "--fast", "--slow"], w.root)).code).toBe(0);
    expect((await run(["run", "--all"], w.root)).code).toBe(0);
    expect((await run(["run", "--all", "--slow"], w.root)).stdout).toMatch(
      /^Slow tier requested at revision 3: 1 slow file queued/,
    );
    expect(sent()).toEqual([
      { type: "run-all", force: false },
      { type: "run-all", force: false },
      { type: "run-slow" },
    ]);
  });
});
