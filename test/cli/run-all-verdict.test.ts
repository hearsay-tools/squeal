import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { recordUnknownFiles } from "../../src/core/scheduler/unknown-files.js";
import {
  type CheckId,
  type CheckKey,
  type CheckpointProgress,
  type CheckpointRecord,
  checkpointMetaKey,
  type KnownOutcome,
  type PendingPhase,
  type RevisionNumber,
  type Store,
  type Validity,
} from "../../src/core/types/index.js";
import { appendRevisions, check, fakeRepo, seedStore, state } from "../status/helpers.js";
import { type Answer, closeFakeDaemons, fakeDaemon } from "./fake-daemon.js";

/*
 * Spec 005 D1: `run --all --wait [<ms>]` gives the checkpoint's verdict, 0,
 * 1 or 3, from the store at its end, against a stand-in daemon.
 */

const A = "test/a.test.ts";
const B = "test/b.test.ts";
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

/** A worktree at revision 3 whose recorded daemon listens on `socket`. */
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
  /** `path` listed, with a test and its file-level check; `outcome` for the test. */
  const file = (
    path: string,
    {
      validity = "current",
      outcome = "pass",
      pending = null,
      keyed = true,
      loaded = true,
    }: {
      validity?: Validity;
      outcome?: KnownOutcome;
      pending?: PendingPhase | null;
      keyed?: boolean;
      loaded?: boolean;
    } = {},
  ) => {
    const key = keyed ? (`key-${path}` as CheckKey) : null;
    const row = { worktreeId: id, testFile: ref(path), key, revision: 3 as RevisionNumber };
    store.testFileKeys.upsertMany([{ ...row, pending }]);
    const pendingPhase = validity === "pending" ? ("queued" as const) : null;
    store.knownStates.upsertMany([
      state(id, check(path, "works"), { validity, outcome, pendingPhase, observedAt: 3 }),
      state(id, fileCheck(path), {
        validity,
        outcome: loaded ? "pass" : "fail",
        pendingPhase,
        observedAt: 3,
      }),
    ]);
  };
  const checkpoint = (testFiles: readonly string[]): CheckpointRecord =>
    store.checkpoints.start({
      id: "c1",
      worktreeId: id,
      revision: 3 as RevisionNumber,
      kind: "run-all",
      testFiles: testFiles.map(ref),
      startedAt: Date.now(),
    });
  return { root: repo.main, id, store, socket, file, checkpoint };
}

/** A daemon that records `record` for the request and answers pings; `onRequest` runs before it answers. */
function daemonFor(
  socket: string,
  record: CheckpointRecord,
  extra: Record<string, Answer[]> = {},
  onRequest?: (type: string) => void,
) {
  return fakeDaemon(
    socket,
    {
      "run-all": [{ ok: true, type: "run-all", requestId: "r1", checkpoint: record, error: null }],
      ping: [
        {
          ok: true,
          type: "ping",
          pid: process.pid,
          worktreeId: record.worktreeId,
          root: "/",
          squealVersion: "0.0.0-test",
          phase: "ready",
          startedAt: Date.now(),
        },
      ],
      ...extra,
    },
    onRequest,
  );
}

async function run(argv: string[], cwd: string, env?: CliIo["env"]) {
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
    ...(env === undefined ? {} : { env }),
  };
  const code = await main(argv, io);
  return { code, stdout, stderr, first: stdout.split("\n")[0], second: stdout.split("\n")[1] };
}

const later = (ms: number, fn: () => void) => setTimeout(fn, ms);
const finish = (store: Store, end: "completed" | "abandoned" = "completed") =>
  store.checkpoints.finish("c1", end, Date.now());

describe("run --all --wait: the checkpoint's verdict (spec 005 D1)", () => {
  it("exits 0 when every test file is current and none fails, counting reused and run files", async () => {
    const w = worktree();
    w.file(A);
    w.file(B, { validity: "pending", pending: "queued" });
    await daemonFor(w.socket, w.checkpoint([B]));
    later(100, () => {
      w.file(B);
      finish(w.store);
    });
    const result = await run(["run", "--all", "--wait"], w.root);
    expect(result.first).toBe(
      "Checkpoint c1 completed at revision 3: no known failures; 2 test files, 1 already current, 1 run now",
    );
    expect(result.second).toBe(
      "Checkpoint c1 started at revision 3: 1 test file to run, 1 already current",
    );
    expect(result.stdout).toContain("\n\nRevision: 3\n");
    expect(result.code).toBe(0);
  });

  it("exits 1 with known failures, tests and test files that did not load named apart", async () => {
    const w = worktree();
    w.file(A, { outcome: "fail" });
    w.file(B, { outcome: "fail", loaded: false });
    await daemonFor(w.socket, w.checkpoint([A, B]));
    later(50, () => finish(w.store));
    const result = await run(["run", "--all", "--force", "--wait", "5000"], w.root);
    expect(result.first).toBe(
      "Checkpoint c1 completed at revision 3: 3 known failures: 2 tests, 1 test file that did not load; 2 test files, 0 already current, 2 run now",
    );
    expect(result.code).toBe(1);
  });

  it("waits out a re-run queued after the checkpoint completed, then gives its verdict", async () => {
    const w = worktree();
    w.file(A, { outcome: "fail", validity: "pending", pending: "queued" });
    await daemonFor(w.socket, w.checkpoint([A]));
    finish(w.store);
    later(400, () => w.file(A, { outcome: "fail" }));
    const result = await run(["run", "--all", "--wait"], w.root);
    expect(result.first).toMatch(
      /^Checkpoint c1 completed at revision 3: 1 known failure: 1 test;/,
    );
    expect(result.code).toBe(1);
  });

  it("exits 3 when a revision was recorded during the checkpoint", async () => {
    const w = worktree();
    w.file(A);
    await daemonFor(w.socket, w.checkpoint([A]));
    later(50, () => {
      appendRevisions(w.store, w.id, 1, { head: null, dirty: true });
      finish(w.store);
    });
    const result = await run(["run", "--all", "--wait"], w.root);
    expect(result.first).toBe(
      "Checkpoint c1 has no verdict: revision 4 was recorded after the checkpoint's revision 3",
    );
    expect(result.code).toBe(3);
  });

  it("exits 3 at the deadline with files pending, and the checkpoint goes on", async () => {
    const w = worktree();
    w.file(A);
    w.file(B, { validity: "pending", pending: "running" });
    await daemonFor(w.socket, w.checkpoint([B]));
    const started = Date.now();
    const result = await run(["run", "--all", "--wait=300"], w.root);
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(result.first).toBe(
      "Checkpoint c1 has no verdict: the deadline passed with 1 test file pending at revision 3; the checkpoint goes on in the daemon",
    );
    expect(result.code).toBe(3);
    expect(w.store.checkpoints.get("c1")?.end).toBeNull();
  });

  it("exits 3 when a covered file is unknown at the end", async () => {
    const w = worktree();
    w.file(A);
    w.file(B, { validity: "unknown", keyed: false });
    await daemonFor(w.socket, w.checkpoint([A]));
    later(50, () => finish(w.store));
    const result = await run(["run", "--all", "--wait"], w.root);
    expect(result.first).toBe(
      "Checkpoint c1 has no verdict: 1 test file without a current result at revision 3 (1 unknown). Without a result: test/b.test.ts: no result: no key: its project's environment or closure is not known (a runner call failed), or a closure path is untracked",
    );
    expect(result.code).toBe(3);
  });

  it("exits 3 when the checkpoint was abandoned", async () => {
    const w = worktree();
    w.file(A);
    await daemonFor(w.socket, w.checkpoint([A]));
    later(50, () => finish(w.store, "abandoned"));
    const result = await run(["run", "--all", "--wait"], w.root);
    expect(result.first).toMatch(/^Checkpoint c1 has no verdict: it was abandoned before/);
    expect(result.code).toBe(3);
  });

  it("names the file an abandoned checkpoint lacks, why, and the new paths it read (001-403)", async () => {
    const w = worktree();
    w.file(A);
    w.store.testFileKeys.upsertMany([
      { worktreeId: w.id, testFile: ref(B), key: "kb" as CheckKey, revision: 3, pending: null },
    ]);
    const reason = "3 runs in a row read paths no earlier run had read";
    w.store.transaction(() =>
      recordUnknownFiles(
        w.store,
        w.id,
        [
          {
            testFile: ref(B),
            key: "kb" as CheckKey,
            reason,
            ran: true,
            samples: ["runs/1-artifacts", "runs/2-artifacts"] as never,
            revision: 3 as RevisionNumber,
            at: Date.now(),
          },
        ],
        () => true,
      ),
    );
    await daemonFor(w.socket, w.checkpoint([A, B]));
    later(50, () => finish(w.store, "abandoned"));
    // No harness session in env: the text names the plain `squeal` command, under Codex too.
    const result = await run(["run", "--all", "--wait"], w.root, {});
    const named = `${B}: ran, nothing recorded: ${reason} (paths: runs/1-artifacts, runs/2-artifacts)`;
    expect(result.first).toBe(
      `Checkpoint c1 has no verdict: it was abandoned before every test file had a result (a newer request replaced it, a test file's inputs never held still, a tier crashed or timed out, or the daemon stopped). Without a result: ${named}`,
    );
    // Row 011-29: status's default text names it in its outstanding group, with its retry.
    expect(result.stdout).toContain(
      `\n  1 test file ran, nothing recorded: ${reason}: ${B}; \`squeal retry ${B}\` runs it once\n`,
    );
    expect(result.code).toBe(3);
  });

  it("exits 3 with no daemon, and 1 without --wait as before", async () => {
    const w = worktree();
    const waited = await run(["run", "--all", "--wait"], w.root);
    expect(waited.first).toBe(
      `No verdict: no daemon running for ${w.root}; start one with squeal start`,
    );
    expect(waited.code).toBe(3);
    const bare = await run(["run", "--all"], w.root);
    expect(bare).toMatchObject({ code: 1, stdout: "" });
  });

  it("takes the verdict of the running checkpoint it joined (001-217)", async () => {
    const w = worktree();
    w.file(A);
    w.file(B, { validity: "pending", pending: "running" });
    const open: CheckpointProgress = {
      id: "c0",
      kind: "baseline",
      revision: 3 as RevisionNumber,
      startedAt: Date.now(),
      done: 1,
      total: 2,
    };
    w.store.checkpoints.start({ ...open, worktreeId: w.id, testFiles: [ref(A), ref(B)] });
    w.store.meta.set(checkpointMetaKey(w.id), JSON.stringify(open));
    const c1 = w.checkpoint([]);
    const joined = { ok: true, type: "run-all", requestId: "r1", checkpoint: c1, error: null };
    await daemonFor(w.socket, c1, { "run-all": [{ ...joined, owner: "c0" }] });
    later(100, () => {
      w.file(B);
      finish(w.store);
    });
    const result = await run(["run", "--all", "--wait"], w.root);
    expect(result.first).toBe(
      "Checkpoint c1 completed at revision 3: no known failures; 2 test files, 0 already current, 2 run by the baseline checkpoint c0 it joined",
    );
    expect(result.second).toMatch(
      /, joining the baseline checkpoint c0 already running them \(1 of 2 test files done\); it ends when that one ends$/,
    );
    expect(result.code).toBe(0);
  });

  it("exits 3 and says so when the daemon stopped and the next one owes the checkpoint (001-219)", async () => {
    const w = worktree();
    w.file(A, { validity: "pending", pending: "queued" });
    const owed: CheckpointProgress = {
      id: "c1",
      kind: "run-all",
      revision: 3 as RevisionNumber,
      startedAt: Date.now(),
      done: 0,
      total: 1,
      owed: { ids: ["c1"], remaining: [ref(A)], strict: [] },
    };
    await daemonFor(w.socket, w.checkpoint([A]));
    later(100, () => {
      closeFakeDaemons();
      w.store.meta.set(checkpointMetaKey(w.id), JSON.stringify(owed));
    });
    const result = await run(["run", "--all", "--wait"], w.root);
    expect(result.first).toBe(
      "Checkpoint c1 has no verdict: the daemon stopped before it ended; the next daemon resumes it, and `run --all --wait` then waits for it",
    );
    expect(result.code).toBe(3);
  }, 15_000);

  it("rejects a malformed deadline with exit code 2", async () => {
    const w = worktree();
    const result = await run(["run", "--all", "--wait=soon"], w.root);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--wait takes a whole number of milliseconds");
    expect((await run(["run", "--all", "--wait", "later"], w.root)).stderr).toContain(
      'unknown argument "later"',
    );
  });
});
