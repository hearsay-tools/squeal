import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { Checkpoints } from "../../src/core/scheduler/checkpoints.js";
import type { CheckKey, CheckpointRecord, RevisionNumber } from "../../src/core/types/index.js";
import {
  appendRevisions,
  check,
  fakeRepo,
  fileCheck,
  seedStore,
  state,
} from "../status/helpers.js";
import { closeFakeDaemons, fakeDaemon } from "./fake-daemon.js";

/*
 * Review wave-3, B4: `run --all` counts a checkpoint's work as joined only
 * when the daemon says the request joined it (`RunAllResponse.owner`), never
 * because both ended in the same millisecond. The real checkpoint tracker
 * records both requests at a fixed clock.
 */

const A = "test/a.test.ts";
const ref = { project: "", path: A as never };
const AT = 1234;

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

/**
 * A worktree at revision 1 with one current test file, a baseline `c0` open
 * on it in the real tracker, and a stand-in daemon on its socket that runs
 * `onRequest` with the tracker when `run --all` arrives and answers with the
 * record and owner it returns (`owner` absent: an older daemon).
 */
async function daemonWith(
  onRequest: (checkpoints: Checkpoints) => { record: CheckpointRecord; owner?: string },
) {
  const repo = fakeRepo();
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
  appendRevisions(store, id, 1, { head: null, dirty: false });
  const socket = join(runtimeDir, "daemon.sock");
  store.worktrees.setDaemon(id, {
    socketPath: socket,
    startedAt: Date.now(),
    heartbeatAt: Date.now(),
    heartbeatIntervalMs: 5_000,
    squealVersion: "0.0.0-test",
  });
  const row = { worktreeId: id, testFile: ref, key: `key-${A}` as CheckKey, revision: 1 };
  store.testFileKeys.upsertMany([{ ...row, revision: 1 as RevisionNumber, pending: null }]);
  store.knownStates.upsertMany([
    state(id, check(A, "works"), { validity: "current", outcome: "pass", observedAt: 1 }),
    state(id, fileCheck(A), { validity: "current", outcome: "pass", observedAt: 1 }),
  ]);
  const checkpoints = new Checkpoints(store, id, () => AT);
  checkpoints.start("c0", "baseline", 1 as RevisionNumber, [ref]);
  const answer: Record<string, unknown> = {
    ok: true,
    type: "run-all",
    requestId: "r1",
    error: null,
  };
  await fakeDaemon(socket, { "run-all": [answer] }, (type) => {
    if (type !== "run-all") return;
    const { record, owner } = onRequest(checkpoints);
    answer.checkpoint = store.checkpoints.get(record.id);
    if (owner !== undefined) answer.owner = owner;
  });
  return { root: repo.main, store };
}

async function run(cwd: string) {
  let stdout = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: () => {},
    cwd,
  };
  const code = await main(["run", "--all", "--wait"], io);
  const [first, second] = stdout.split("\n");
  return { code, first, second };
}

describe("run --all counts a joined checkpoint's work only when the daemon joined it (review wave-3, B4)", () => {
  it("counts the owner's files for a join that completed before run --all read it", async () => {
    const w = await daemonWith((checkpoints) => {
      const record = checkpoints.join("c1", "run-all", 1 as RevisionNumber, [ref]);
      checkpoints.finish("completed");
      return { record, owner: "c0" };
    });
    const result = await run(w.root);
    expect(w.store.checkpoints.get("c1")).toMatchObject({ end: "completed", completedAt: AT });
    expect(result.first).toBe(
      "Checkpoint c1 completed at revision 1: no known failures; 1 test file, 0 already current, 1 run by the baseline checkpoint c0 it joined",
    );
    expect(result.second).toBe(
      "Checkpoint c1 started at revision 1: 1 test file to run, 0 already current, joining the baseline checkpoint c0 already running them; both had ended when this command read them",
    );
    expect(result.code).toBe(0);
  });

  it("counts an independent empty request as already current, though its neighbour ended in the same millisecond", async () => {
    const w = await daemonWith((checkpoints) => {
      checkpoints.finish("completed");
      const record = checkpoints.start("c1", "run-all", 1 as RevisionNumber, []);
      return { record, owner: "c1" };
    });
    const result = await run(w.root);
    const owner = w.store.checkpoints.get("c0");
    const request = w.store.checkpoints.get("c1");
    expect([request?.end, request?.completedAt]).toEqual(["completed", AT]);
    expect([owner?.end, owner?.completedAt]).toEqual([request?.end, request?.completedAt]);
    expect(result.first).toBe(
      "Checkpoint c1 completed at revision 1: no known failures; 1 test file, 1 already current, 0 run now",
    );
    expect(result.second).toBe(
      "Checkpoint c1 started at revision 1: 0 test files to run, 1 already current",
    );
    expect(result.code).toBe(0);
  });

  it("claims no join from an older daemon that names no owner, and counts the request's own files", async () => {
    const w = await daemonWith((checkpoints) => {
      const record = checkpoints.join("c1", "run-all", 1 as RevisionNumber, [ref]);
      checkpoints.finish("completed");
      return { record };
    });
    const result = await run(w.root);
    expect(result.first).toBe(
      "Checkpoint c1 completed at revision 1: no known failures; 1 test file, 0 already current, 1 run now",
    );
    expect(result.second).toBe(
      "Checkpoint c1 started at revision 1: 1 test file to run, 0 already current",
    );
    expect(result.code).toBe(0);
  });
});
