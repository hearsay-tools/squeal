import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CliIo } from "../../src/cli/main.js";
import { retryCommand } from "../../src/cli/retry.js";
import { type HostLoad, readRetries } from "../../src/core/retry/index.js";
import type { CheckKey, RevisionNumber } from "../../src/core/types/index.js";
import { appendRevisions, check, fakeRepo, seedStore, state } from "../status/helpers.js";
import { closeFakeDaemons, fakeDaemon } from "./fake-daemon.js";

/*
 * Spec 001 D6 as amended (001-368): `squeal retry <file>... --reason
 * load|environment` stores one request per file in the shared store and
 * tells the daemon; once per file, key and session; `--cancel` withdraws.
 */

const A = "test/a.test.ts";
const B = "test/b.test.ts";
const ref = (path: string) => ({ project: "", path: path as never });

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

/** A worktree with `A` failing and `B` passing, and a stand-in daemon on its socket. */
async function worktree(withDaemon = true) {
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
  if (withDaemon) {
    store.worktrees.setDaemon(id, {
      socketPath: socket,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
      heartbeatIntervalMs: 5_000,
      squealVersion: "0.0.0-test",
    });
  }
  for (const [path, outcome] of [
    [A, "fail"],
    [B, "pass"],
  ] as const) {
    store.testFileKeys.upsertMany([
      {
        worktreeId: id,
        testFile: ref(path),
        key: `key-${path}` as CheckKey,
        revision: 3 as RevisionNumber,
        pending: null,
      },
    ]);
    store.knownStates.upsertMany([state(id, check(path, "works"), { outcome, observedAt: 3 })]);
  }
  const seen = withDaemon
    ? await fakeDaemon(socket, {
        ping: [
          {
            ok: true,
            type: "ping",
            pid: process.pid,
            worktreeId: id,
            root: repo.main,
            squealVersion: "0.0.0-test",
            phase: "ready",
            startedAt: Date.now(),
          },
        ],
      })
    : [];
  return { root: repo.main, store, seen };
}

const HIGH: HostLoad = { oneMinute: 12.4, cpus: 8 };

async function retry(argv: string[], cwd: string, session = "s1", load = HIGH) {
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
    env: { CLAUDE_CODE_SESSION_ID: session },
  };
  const code = await retryCommand(argv, io, { hostLoad: () => load });
  return { code, stdout, stderr };
}

describe("squeal retry", () => {
  it("queues a load retry, says what it waits for, and tells the daemon", async () => {
    const { root, store, seen } = await worktree();
    const out = await retry([A, "--reason", "load"], root);
    expect(out.code).toBe(0);
    expect(out.stdout).toBe(
      "Retry queued (reason: load): test/a.test.ts runs once more when the one-minute load average falls below the CPU count, however long that takes (load average 12.40 on 8 CPUs now). Its FAIL stays counted until a retry passes; squeal status lists the retry while it is pending.\n",
    );
    expect(seen).toContain("retry");
    expect(readRetries(store)).toMatchObject([
      { testFile: ref(A), key: `key-${A}`, session: "s1", reason: "load", end: null },
    ]);
  });

  it("refuses a second request in the session at the key, and a file with no failure", async () => {
    const { root, store } = await worktree();
    await retry([`${root}/${A}`, "--reason=environment"], join(root, "test"));
    const again = await retry([A, B, "--reason", "load"], root);
    expect(again.code).toBe(1);
    expect(again.stdout).toBe(
      [
        "Not retried: test/a.test.ts was already retried in this session at its current inputs (environment; it is still pending). The failure stands.",
        "Not retried: test/b.test.ts has no known failure in this worktree.",
        "",
      ].join("\n"),
    );
    // Another session has its own retry.
    expect((await retry([A, "--reason", "load"], root, "s2")).code).toBe(0);
    expect(readRetries(store)).toHaveLength(2);
  });

  it("withdraws a pending retry with --cancel", async () => {
    const { root, store } = await worktree();
    await retry([A, "--reason", "load"], root);
    const out = await retry(["--cancel", A], root);
    expect(out).toMatchObject({
      code: 0,
      stdout: "Retry withdrawn: test/a.test.ts (1 request).\n",
    });
    expect(readRetries(store)[0]?.end?.outcome).toBe("cancelled");
    expect((await retry(["--cancel", A], root)).stdout).toBe(
      "No pending retry of test/a.test.ts at its current inputs.\n",
    );
  });

  it("keeps the request in the store when no daemon listens", async () => {
    const { root, store } = await worktree(false);
    const out = await retry([A, "--reason", "environment"], root);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain(
      "No daemon took the request now; it waits in the store for the next daemon at this file's inputs (squeal start starts one).",
    );
    expect(readRetries(store)).toHaveLength(1);
  });

  // Row 011-27: a missing reason is no usage error; `retry-no-reason.test.ts` has its cases.
  // Row 011-134: `retry-unlisted.test.ts` has the paths with no key.
  it("rejects an unknown reason and a missing file", async () => {
    const { root } = await worktree();
    expect((await retry([A, "--reason", "flaky"], root)).stderr).toContain(
      '--reason must be load or environment, not "flaky"',
    );
    expect((await retry(["src/x.ts", "--reason", "load"], root)).stdout).toBe(
      "Not retried: src/x.ts does not exist in this worktree.\n",
    );
  });

  describe("a file with no result at its key (011 C5, gh-36)", () => {
    const U = "test/u.test.ts";
    const N = "test/n.test.ts";
    /** `U` unknown after a withheld run, `N` never run; `pending` sets both rows' work. */
    async function noResult(pending: "queued" | null = null) {
      const w = await worktree();
      const id = w.store.worktrees.list()[0]?.id as string;
      w.store.testFileKeys.upsertMany(
        [U, N].map((path) => ({
          worktreeId: id,
          testFile: ref(path),
          key: `key-${path}` as CheckKey,
          revision: 3 as RevisionNumber,
          pending,
        })),
      );
      w.store.knownStates.upsertMany([
        state(id, check(U, "works"), {
          outcome: "unknown",
          validity: "unknown",
          summary: "vitest adapter: dist/lib.js was written during this run",
        }),
      ]);
      return w;
    }

    it("queues one run at once, whatever the reason, naming the state and the named wait", async () => {
      const { root, store, seen } = await noResult();
      const out = await retry([U, N, "--reason", "load"], root);
      expect(out.code).toBe(0);
      expect(out.stdout).toBe(
        [
          "Run queued: test/u.test.ts has no result at its inputs (unknown: vitest adapter: dist/lib.js was written during this run). It runs once now at its normal priority, whatever the reason; that is its one run at these inputs, and it spends no retry of this session. squeal status --wait 60000 test/u.test.ts waits for its result and moves it ahead in the queue.",
          "Run queued: test/n.test.ts has no result at its inputs (unknown: never run at this key: the baseline is lookup-only, so nothing queued it). It runs once now at its normal priority, whatever the reason; that is its one run at these inputs, and it spends no retry of this session. squeal status --wait 60000 test/n.test.ts waits for its result and moves it ahead in the queue.",
          "",
        ].join("\n"),
      );
      expect(seen).toContain("retry");
      expect(readRetries(store)).toMatchObject([
        { testFile: ref(U), key: `key-${U}`, reason: "load", noResult: true, end: null },
        { testFile: ref(N), key: `key-${N}`, reason: "load", noResult: true, end: null },
      ]);
    });

    it("queues one run of a file whose FAIL is stale, outside the session's retry (review 011 wave 2, B1)", async () => {
      const w = await worktree();
      const id = w.store.worktrees.list()[0]?.id as string;
      w.store.knownStates.upsertMany([
        state(id, check(A, "works"), { outcome: "fail", validity: "stale", observedAt: 2 }),
      ]);
      const out = await retry([A, "--reason", "load"], w.root);
      expect(out.code).toBe(0);
      expect(out.stdout).toMatch(/^Run queued: test\/a\.test\.ts has no result at its inputs \(/);
      expect(out.stdout).not.toContain("FAIL stays counted");
      expect(readRetries(w.store)).toMatchObject([
        { testFile: ref(A), reason: "load", noResult: true, end: null },
      ]);
    });

    it("queues nothing more while its run is asked", async () => {
      const { root, store } = await noResult();
      await retry([U, "--reason", "environment"], root);
      const again = await retry([U, "--reason", "environment"], root, "s2");
      expect(again).toMatchObject({
        code: 0,
        stdout:
          "test/u.test.ts has a run asked at its inputs already, pending, so nothing more is queued. squeal status --wait 60000 test/u.test.ts waits for its result and moves it ahead in the queue.\n",
      });
      expect(readRetries(store)).toHaveLength(1);
    });

    it("queues nothing more while it is queued or running", async () => {
      const queued = await noResult("queued");
      const out = await retry([N, "--reason", "load"], queued.root);
      expect(out).toMatchObject({
        code: 0,
        stdout:
          "test/n.test.ts has a run queued or running at its inputs already, so nothing more is queued. squeal status --wait 60000 test/n.test.ts waits for its result and moves it ahead in the queue.\n",
      });
      expect(readRetries(queued.store)).toEqual([]);
    });
  });

  it("names what clears a failed global setup instead (001-382)", async () => {
    const { root, store } = await worktree();
    const id = store.worktrees.list()[0]?.id as string;
    store.knownStates.upsertMany([
      state(
        id,
        { kind: "setup", project: "e2e", testPath: "e2e/setup.ts" as never },
        { outcome: "fail", observedAt: 3 },
      ),
    ]);
    expect((await retry(["e2e/setup.ts", "--reason", "environment"], root)).stdout).toBe(
      "Not retried: e2e/setup.ts is a global setup, which has no inputs to retry at; its FAIL clears when a run of its project starts, as the next edit or squeal run --all does.\n",
    );
  });
});
