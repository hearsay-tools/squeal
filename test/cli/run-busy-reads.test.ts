import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { checkpointVerdictLine } from "../../src/cli/run.js";
import type { DaemonDown } from "../../src/cli/wait/table.js";
import { Checkpoints } from "../../src/core/scheduler/checkpoints.js";
import type { RevisionNumber } from "../../src/core/types/common.js";
import type { CheckKey } from "../../src/core/types/keys.js";
import { checkpointMetaKey } from "../../src/core/types/scheduler.js";
import type { CheckpointRecord } from "../../src/core/types/store-records.js";
import {
  appendRevisions,
  check,
  fakeRepo,
  fileCheck,
  seedStore,
  state,
} from "../status/helpers.js";
import { closeFakeDaemons, fakeDaemon, lockStore } from "./fake-daemon.js";

/*
 * Row 011-334 (review 0.1.474 N1): the reads beside the run waits
 * (`run.ts` `filesText`, `joinedCheckpoint`, `owedText`) meet a store a
 * second connection holds the write lock of. Pinned to today: each throws
 * "database is locked" out of the command.
 */

const A = "test/a.test.ts";
const ref = { project: "", path: A as never };

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

/** A worktree at revision 1 with one current test file and a baseline `c0` open on it. */
function worktree() {
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
  const row = { worktreeId: id, testFile: ref, key: `key-${A}` as CheckKey };
  store.testFileKeys.upsertMany([{ ...row, revision: 1 as RevisionNumber, pending: null }]);
  store.knownStates.upsertMany([
    state(id, check(A, "works"), { validity: "current", outcome: "pass", observedAt: 1 }),
    state(id, fileCheck(A), { validity: "current", outcome: "pass", observedAt: 1 }),
  ]);
  const checkpoints = new Checkpoints(store, id, () => 1234);
  checkpoints.start("c0", "baseline", 1 as RevisionNumber, [ref]);
  return { repo, store, id, checkpoints };
}

/**
 * The worktree with a stand-in daemon on its socket. At `run --all` it
 * records the request with `onRequest`, then closes the seed connection
 * and takes the store's lock (`lockStore`) before it answers.
 */
async function lockedAtRequest(
  onRequest: (checkpoints: Checkpoints) => { record: CheckpointRecord; owner: string },
) {
  const w = worktree();
  const socket = join(runtimeDir, "daemon.sock");
  w.store.worktrees.setDaemon(w.id, {
    socketPath: socket,
    startedAt: Date.now(),
    heartbeatAt: Date.now(),
    heartbeatIntervalMs: 5_000,
    squealVersion: "0.0.0-test",
  });
  const answer: Record<string, unknown> = {
    ok: true,
    type: "run-all",
    requestId: "r1",
    error: null,
  };
  await fakeDaemon(socket, { "run-all": [answer] }, (type) => {
    if (type !== "run-all") return;
    const { record, owner } = onRequest(w.checkpoints);
    answer.checkpoint = w.store.checkpoints.get(record.id);
    answer.owner = owner;
    // An exclusive lock on a WAL store needs every other connection closed.
    w.store.close();
    lockStore(w.repo.commonDir);
  });
  return w.repo.main;
}

async function run(argv: string[], cwd: string) {
  let stdout = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: () => {},
    cwd,
  };
  const code = await main(argv, io);
  return { code, stdout };
}

describe("the reads beside the run waits on a locked store (row 011-334)", () => {
  it("filesText: run --all --wait throws before its wait (review 0.1.474 N1)", async () => {
    const root = await lockedAtRequest((checkpoints) => {
      checkpoints.finish("completed");
      return {
        record: checkpoints.start("c1", "run-all", 1 as RevisionNumber, [ref]),
        owner: "c1",
      };
    });
    await expect(run(["run", "--all", "--wait", "300"], root)).rejects.toThrow(
      "database is locked",
    );
  });

  it("joinedCheckpoint: run --all that joined a running checkpoint throws", async () => {
    const root = await lockedAtRequest((checkpoints) => ({
      record: checkpoints.join("c1", "run-all", 1 as RevisionNumber, [ref]),
      owner: "c0",
    }));
    await expect(run(["run", "--all"], root)).rejects.toThrow("database is locked");
  });

  it("owedText: the stopped line of a checkpoint the next daemon may owe throws", () => {
    const w = worktree();
    const checkpoint = w.checkpoints.join("c1", "run-all", 1 as RevisionNumber, [ref]);
    const progress = { id: "c1", kind: "run-all", revision: 1, startedAt: 1, done: 0, total: 1 };
    const due = { ids: ["c1"], remaining: [ref], strict: [] };
    w.store.meta.set(checkpointMetaKey(w.id), JSON.stringify({ ...progress, owed: due }));
    w.store.close();
    lockStore(w.repo.commonDir);
    expect(() =>
      checkpointVerdictLine(
        w.repo.main,
        checkpoint,
        { kind: "stopped", daemon: STOPPED },
        null,
        "squeal",
      ),
    ).toThrow("database is locked");
  });
});

/** A daemon `squeal stop` cleared, as daemon presence's wait view reads it. */
const STOPPED: DaemonDown = {
  state: "down",
  reason: "stopped",
  liveness: { state: "down", since: Date.UTC(2026, 10, 13, 21) },
};
