import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import type { CheckId } from "../../src/core/types/check.js";
import type { RevisionNumber } from "../../src/core/types/common.js";
import type { CheckKey } from "../../src/core/types/keys.js";
import { appendRevisions, check, fakeRepo, seedStore, state } from "../status/helpers.js";
import { closeFakeDaemons, fakeDaemon } from "./fake-daemon.js";

/*
 * Row 011-325: the `run-all`, `run-slow` and `run-group` answers carry the
 * id of the request's covered files as one optional field. A CLI before
 * card 3's row 011-328, this one, ignores it: each command prints and
 * exits as with an answer without it.
 */

const A = "test/a.test.ts";
const ref = { project: "", path: A as never };
const fileCheck: CheckId = { kind: "file", project: "", testPath: A };

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

/** A worktree at revision 3 with `A` current and a completed checkpoint `c1` over it; its socket. */
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
  appendRevisions(store, id, 3, { head: null, dirty: false });
  const socket = join(runtimeDir, "daemon.sock");
  store.worktrees.setDaemon(id, {
    socketPath: socket,
    startedAt: Date.now(),
    heartbeatAt: Date.now(),
    heartbeatIntervalMs: 5_000,
    squealVersion: "0.0.0-test",
  });
  const key = `key-${A}` as CheckKey;
  store.testFileKeys.upsertMany([
    { worktreeId: id, testFile: ref, key, revision: 3 as RevisionNumber, pending: null },
  ]);
  store.knownStates.upsertMany([
    state(id, check(A, "works"), { validity: "current", outcome: "pass", observedAt: 3 }),
    state(id, fileCheck, { validity: "current", outcome: "pass", observedAt: 3 }),
  ]);
  const checkpoint = store.checkpoints.start({
    id: "c1",
    worktreeId: id,
    revision: 3 as RevisionNumber,
    kind: "run-all",
    testFiles: [ref],
    startedAt: Date.now(),
  });
  store.checkpoints.finish("c1", "completed", Date.now());
  return { root: repo.main, socket, checkpoint };
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
  return { code, stdout, stderr };
}

/** What `argv` prints against a daemon whose answers name the id `coveredId` (`undefined`: none). */
async function printed(argv: string[], coveredId: string | undefined) {
  const w = worktree();
  const id = coveredId === undefined ? {} : { coveredId };
  const requested = { revision: 3, queued: 1, ...id };
  await fakeDaemon(w.socket, {
    "run-all": [
      {
        ok: true,
        type: "run-all",
        requestId: "r1",
        checkpoint: w.checkpoint,
        owner: "c1",
        error: null,
        ...id,
      },
    ],
    "run-slow": [{ ok: true, type: "run-slow", requestId: "r2", requested, error: null }],
    "run-group": [
      {
        ok: true,
        type: "run-group",
        requestId: "r3",
        group: "tests",
        requested,
        unknown: false,
        error: null,
      },
    ],
  });
  const result = await run(argv, w.root);
  closeFakeDaemons();
  return result;
}

describe("an answer's covered files id, to a CLI that does not read it (row 011-325)", () => {
  it.each([
    ["run --all --wait", ["run", "--all", "--wait", "5000"]],
    ["run --slow", ["run", "--slow"]],
    ["run tests", ["run", "tests"]],
  ])("%s prints and exits as without it", async (_, argv) => {
    const without = await printed(argv, undefined);
    expect(without.code).toBe(0);
    expect(await printed(argv, "r-covered")).toEqual(without);
  });
});
