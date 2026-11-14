import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { type CoveredFile, writeCoveredFiles } from "../../src/core/store/covered-files.js";
import type { CheckId } from "../../src/core/types/check.js";
import type { EpochMs, RevisionNumber } from "../../src/core/types/common.js";
import type { CheckKey } from "../../src/core/types/keys.js";
import type { NarrowRun } from "../../src/core/types/scheduler.js";
import type { CheckpointLane } from "../../src/core/types/store-records.js";
import { appendRevisions, check, fakeRepo, seedStore, state } from "../status/helpers.js";
import { closeFakeDaemons, fakeDaemon } from "./fake-daemon.js";

/*
 * Row 011-328: the run commands read the request's covered files from the
 * scheduler's record, by the id in the daemon's answer (`coveredId`, row
 * 011-325), in place of their guess from the policy. An answer without an
 * id (an older daemon) and an id whose record is gone print and exit as
 * before. Each row's record and guess differ, so the output says which
 * one the command read.
 */

const A = "test/a.test.ts";
const B = "test/b.test.ts";
const E2E = "test/e2e/a.test.ts";
const E2E_B = "test/e2e/b.test.ts";
const ref = (path: string) => ({ project: "", path: path as never });
const fileCheck = (path: string): CheckId => ({ kind: "file", project: "", testPath: path });
const SLOW_CONFIG = { slow: { include: ["test/e2e/**"] } };
const GROUPS = {
  checks: [{ name: "e2e", runner: "vitest", tests: ["test/e2e/**"], at: "stop" }],
};
/** The record's id in the rows; "gone" names none. */
const RECORD = "r1";

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
 * A worktree at revision 3 under `config` with `files` current, a
 * completed checkpoint `c1` of `lane` over the first, and the record
 * `RECORD` of `covered`; its socket.
 */
function worktree(
  config: object | undefined,
  files: readonly string[],
  covered: readonly CoveredFile[],
  lane?: CheckpointLane,
) {
  const repo = fakeRepo();
  if (config !== undefined) {
    writeFileSync(join(repo.main, "squeal.config.json"), JSON.stringify(config));
  }
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
  for (const path of files) {
    const key = `key-${path}` as CheckKey;
    const revision = 3 as RevisionNumber;
    store.testFileKeys.upsertMany([
      { worktreeId: id, testFile: ref(path), key, revision, pending: null },
    ]);
    store.knownStates.upsertMany([
      state(id, check(path, "works"), { validity: "current", outcome: "pass", observedAt: 3 }),
      state(id, fileCheck(path), { validity: "current", outcome: "pass", observedAt: 3 }),
    ]);
  }
  const checkpoint = store.checkpoints.start({
    id: "c1",
    worktreeId: id,
    revision: 3 as RevisionNumber,
    kind: "run-all",
    testFiles: [ref(files[0] ?? A)],
    startedAt: Date.now(),
    ...(lane === undefined ? {} : { lane }),
  });
  store.checkpoints.finish("c1", "completed", Date.now());
  writeCoveredFiles(
    store,
    {
      id: RECORD,
      worktreeId: id,
      revision: 3 as RevisionNumber,
      recordedAt: Date.now() as EpochMs,
      files: covered,
    },
    { listed: () => true, pending: () => false, leftAt: () => null, knownSince: 0 as EpochMs },
  );
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
  return { code, stdout, stderr, lines: stdout.split("\n") };
}

type Worktree = ReturnType<typeof worktree>;

/** A daemon whose answers name `coveredId` (`undefined`: none), taking each request at once. */
function daemon(w: Worktree, coveredId: string | undefined, narrow?: NarrowRun) {
  const id = coveredId === undefined ? {} : { coveredId };
  const requested = { revision: 3, queued: 1, ...id };
  const group = {
    ok: true,
    type: "run-group",
    group: "e2e",
    requested,
    unknown: false,
    error: null,
  };
  return fakeDaemon(w.socket, {
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
    "run-group": [{ ...group, requestId: "r3", group: "tests" }],
    "run-group-paths": [
      { ...group, requestId: "r4", requested: { ...requested, queued: 0 }, narrow },
    ],
  });
}

/** What `argv` prints in a fresh worktree against `daemon` with `coveredId`. */
async function printed(
  make: () => Worktree,
  argv: string[],
  coveredId: string | undefined,
  narrow?: NarrowRun,
) {
  const w = make();
  await daemon(w, coveredId, narrow);
  const result = await run(argv, w.root);
  closeFakeDaemons();
  return result;
}

describe("an answer without an id, or one whose record is gone (row 011-328)", () => {
  const make = () => worktree(undefined, [A], []);
  it.each([
    ["run --all --wait", ["run", "--all", "--wait", "5000"]],
    ["run --slow", ["run", "--slow"]],
    ["run tests --wait", ["run", "tests", "--wait", "5000"]],
  ])("%s prints and exits as before", async (_, argv) => {
    const without = await printed(make, argv, undefined);
    expect(without.code).toBe(0);
    expect(await printed(make, argv, "gone")).toEqual(without);
  });
});

describe("an answer that names a record: the command reads its files (row 011-328)", () => {
  it("run --all --fast --wait: the start line and the verdict count the record's files, not the lane's", async () => {
    // The policy puts A and B in the fast lane; the record has A only.
    const make = () =>
      worktree(SLOW_CONFIG, [A, B], [{ testFile: ref(A), state: "queued" }], "fast");
    const argv = ["run", "--all", "--fast", "--wait", "5000"];
    const lane =
      "Checkpoint c1 (the fast lane only, not a full-suite checkpoint: slow test files are not in it)";
    const recorded = await printed(make, argv, RECORD);
    expect(recorded.lines.slice(0, 2)).toEqual([
      `${lane} completed at revision 3: no known failures; 1 test file, 0 already current, 1 run now`,
      `${lane} started at revision 3: 1 test file to run, 0 already current`,
    ]);
    expect(recorded.code).toBe(0);
    expect((await printed(make, argv, "gone")).lines.slice(0, 2)).toEqual([
      `${lane} completed at revision 3: no known failures; 2 test files, 1 already current, 1 run now`,
      `${lane} started at revision 3: 1 test file to run, 1 already current`,
    ]);
  });

  it("run <group> --wait: the verdict counts the record's files, not the group's by the policy", async () => {
    const make = () => worktree(GROUPS, [E2E, E2E_B], [{ testFile: ref(E2E_B), state: "current" }]);
    const argv = ["run", "e2e", "--wait", "5000"];
    const completed = "Group e2e completed at revision 3: no known failures;";
    expect((await printed(make, argv, RECORD)).lines[0]).toBe(
      `${completed} 1 test file, 1 queued by this request`,
    );
    expect((await printed(make, argv, "gone")).lines[0]).toBe(
      `${completed} 2 test files, 1 queued by this request`,
    );
  });

  it("run <group> <path>: the not-run files and their reasons are the record's, not the answer's", async () => {
    const reason = "Squeal cannot key it";
    const make = () =>
      worktree(GROUPS, [E2E], [{ testFile: ref(E2E), state: "not-queued", reason }]);
    // The answer says the selected file is current; the record says it is not queued, and why.
    const narrow: NarrowRun = {
      selected: [ref(E2E)],
      reached: 0,
      others: [],
      unmatched: [],
      current: 1,
      notRun: [],
    };
    const argv = ["run", "e2e", E2E];
    expect((await printed(make, argv, RECORD, narrow)).stdout).toBe(
      `Group e2e at revision 3: these paths select 1 test file; 1 not run.\n${E2E} is not current and does not run, because ${reason}.\n`,
    );
    expect((await printed(make, argv, "gone", narrow)).stdout).toBe(
      "Group e2e at revision 3: these paths select 1 test file, current; none runs again.\n",
    );
  });
});
