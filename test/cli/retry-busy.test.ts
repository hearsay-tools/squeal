import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CliIo } from "../../src/cli/main.js";
import { type RetryInternal, retryCommand } from "../../src/cli/retry.js";
import { readRetries } from "../../src/core/retry/index.js";
import { storePaths } from "../../src/core/store/index.js";
import type { CheckKey, RevisionNumber } from "../../src/core/types/index.js";
import { appendRevisions, check, fakeRepo, seedStore, state } from "../status/helpers.js";
import { holdLock } from "../status/hold-lock.js";
import { closeFakeDaemons, fakeDaemon } from "./fake-daemon.js";

/*
 * Row 011-212 (gh-86, 011 C13): `squeal retry` asks a store another process
 * holds again until a bound, then says how long it waited and that the store
 * is held, with exit 1 and no stack trace.
 */

const FAILS = "test/fails.test.ts";
const STALE = "test/stale.test.ts";
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

/** A worktree with `FAILS` failing and `STALE` stale at revision 3, and a stand-in daemon. */
async function worktree() {
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
  store.testFileKeys.upsertMany(
    [FAILS, STALE].map((path) => ({
      worktreeId: id,
      testFile: ref(path),
      key: `key-${path}` as CheckKey,
      revision: 3 as RevisionNumber,
      pending: null,
    })),
  );
  store.knownStates.upsertMany([
    state(id, check(FAILS, "works"), { outcome: "fail", observedAt: 3 }),
    state(id, check(STALE, "works"), { validity: "stale", observedAt: 2 }),
  ]);
  const ping = {
    ok: true,
    type: "ping",
    pid: process.pid,
    worktreeId: id,
    root: repo.main,
    squealVersion: "0.0.0-test",
    phase: "ready",
    startedAt: Date.now(),
  };
  const seen = await fakeDaemon(socket, { ping: [ping] });
  return { root: repo.main, database: storePaths(repo.commonDir).database, store, seen };
}

async function retry(
  argv: string[],
  cwd: string,
  internal: RetryInternal = {},
  onLine: (text: string) => void = () => {},
) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
      onLine(text);
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd,
    env: { CLAUDE_CODE_SESSION_ID: "s1" },
  };
  const started = Date.now();
  const code = await retryCommand(argv, io, {
    hostLoad: () => ({ oneMinute: 1, cpus: 8 }),
    ...internal,
  });
  return { code, stdout, stderr, tookMs: Date.now() - started };
}

const BUSY = (not: string, path: string) =>
  new RegExp(
    `^${not}: ${path}: store busy, waited (\\d+) ms: another process holds the store's lock; ` +
      "run the command again for this file once it is released\\.$",
    "m",
  );

describe("squeal retry beside a store another process holds", () => {
  it("queues once when the lock is freed within the bound, past one busy timeout", async () => {
    const { root, database, store, seen } = await worktree();
    const holder = await holdLock(database, "immediate", 2_500);
    try {
      const out = await retry([FAILS, "--reason", "environment"], root);
      expect(out).toMatchObject({ code: 0, stderr: "" });
      expect(out.stdout).toMatch(/^Retry queued \(reason: environment\): test\/fails\.test\.ts /);
      // The CLI's busy timeout is 2 s: a single try would have failed.
      expect(out.tookMs).toBeGreaterThanOrEqual(2_000);
    } finally {
      holder.child.kill();
      await holder.released;
    }
    expect(seen).toContain("retry");
    expect(readRetries(store)).toMatchObject([{ testFile: ref(FAILS), session: "s1", end: null }]);
  });

  it("gives the message and exit 1 with no trace when the lock lasts past the bound", async () => {
    const { root, database, store, seen } = await worktree();
    const holder = await holdLock(database, "immediate", 30_000);
    try {
      const out = await retry([FAILS, "--reason", "load"], root, { busyBoundMs: 600 });
      expect(out).toMatchObject({ code: 1, stderr: "" });
      const waited = Number(BUSY("Not retried", FAILS).exec(out.stdout)?.[1]);
      expect(waited).toBeGreaterThanOrEqual(500);
      // Each try's busy timeout ends at the bound, not 2 s after it.
      expect(out.tookMs).toBeLessThan(1_900);
      const cancel = await retry(["--cancel", FAILS], root, { busyBoundMs: 300 });
      expect(cancel.code).toBe(1);
      expect(cancel.stdout).toMatch(BUSY("Not withdrawn", FAILS));
    } finally {
      holder.child.kill();
      await holder.released;
    }
    expect(seen).not.toContain("retry");
    expect(readRetries(store)).toEqual([]);
  });

  it("prints the first file's line and tells the daemon when the lock comes at the second", async () => {
    const { root, database, store, seen } = await worktree();
    // Taken in this process once the first file's line prints: its connection never lets go during the command.
    const holder = new DatabaseSync(database);
    const out = await retry(
      [FAILS, STALE, "--reason", "load"],
      root,
      { busyBoundMs: 400 },
      (text) => {
        if (text.startsWith("Retry queued")) holder.exec("BEGIN IMMEDIATE");
      },
    );
    holder.exec("ROLLBACK");
    holder.close();
    expect(out).toMatchObject({ code: 1, stderr: "" });
    const [first, second, ...rest] = out.stdout.split("\n");
    expect(first).toMatch(/^Retry queued \(reason: load\): test\/fails\.test\.ts /);
    expect(second).toMatch(BUSY("Not queued", STALE));
    expect(rest).toEqual([""]);
    expect(seen).toContain("retry");
    expect(readRetries(store).map((r) => r.testFile.path)).toEqual([FAILS]);
    // The refused try wrote nothing, so asking again queues the second file once.
    const again = await retry([STALE], root);
    expect(again.stdout).toMatch(/^Run queued: test\/stale\.test\.ts has no result/);
    expect(readRetries(store).map((r) => r.testFile.path)).toEqual([FAILS, STALE]);
  });

  it("answers a repeat after a busy try with spent, not a second request", async () => {
    const { root, database, store } = await worktree();
    const holder = await holdLock(database, "immediate", 2_500);
    try {
      expect((await retry([FAILS, "--reason", "load"], root)).code).toBe(0);
    } finally {
      holder.child.kill();
      await holder.released;
    }
    const repeat = await retry([FAILS, "--reason", "load"], root);
    expect(repeat.code).toBe(1);
    expect(repeat.stdout).toMatch(
      /^Not retried: test\/fails\.test\.ts was already retried in this session at its current inputs \(load; it is still pending\)\. The failure stands\.$/m,
    );
    expect(readRetries(store)).toHaveLength(1);
  });
});
