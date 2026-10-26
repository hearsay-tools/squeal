import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { DaemonTimings } from "../../src/core/daemon/daemon.js";
import type { FullCheck } from "../../src/core/daemon/full-check.js";
import { socketPathFor } from "../../src/core/daemon/paths.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import {
  META_FULL_CHECK,
  META_STORE_RECOVERED,
  readStoreMark,
  storePaths,
} from "../../src/core/store/index.js";
import type { AbsolutePath } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { seedIndexFault } from "../store/helpers.js";
import { until } from "./full-check-helpers.js";
import { childEnv, createFixtureRepo, type FixtureRepo, ping, SLOW, withStore } from "./helpers.js";

/*
 * Row 011-226 (spec 011, store failures as amended 2026-10-25), against real
 * daemons of two worktrees on one store: the start's quick check passes an
 * index fault; the full check runs once in 24 h, after serving, in a process
 * of its own, so the socket answers meanwhile; a fault it finds stops both
 * daemons at their next heartbeat, and the next start moves the store aside.
 */

/**
 * Each full check a daemon starts, the real one; `hold` stops its process at
 * once, and `fail` makes the start throw before a process starts.
 */
const checks = vi.hoisted(() => ({ runs: [] as FullCheck[], hold: false, fail: false }));

vi.mock("../../src/core/daemon/full-check.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/daemon/full-check.js")>();
  return {
    ...actual,
    startFullCheck: (context: Parameters<typeof actual.startFullCheck>[0]) =>
      actual.startFullCheck({
        ...context,
        run: (database) => {
          if (checks.fail) throw new Error("spawn E2BIG");
          const check = actual.runFullCheck(database);
          if (checks.hold && check.pid !== undefined) process.kill(check.pid, "SIGSTOP");
          checks.runs.push(check);
          return check;
        },
      }),
  };
});

const { startDaemon } = await import("../../src/core/daemon/daemon.js");
const { requestDaemon } = await import("../../src/core/daemon/client.js");

const DAY_MS = 24 * 60 * 60_000;

/** A linked worktree of `repo`, never registered. */
function linked(repo: FixtureRepo): FixtureRepo {
  const path = join(dirname(repo.root), `linked-${Math.random().toString(36).slice(2)}`);
  git(repo.root, ["worktree", "add", "-q", "--detach", path]);
  const root = realpathSync(path);
  const worktreeId = worktreeIdFor(root);
  return {
    ...repo,
    root,
    worktreeId,
    socketPath: socketPathFor(worktreeId, { XDG_RUNTIME_DIR: repo.runtimeDir }),
    env: childEnv(repo.runtimeDir),
  };
}

function fixture(): FixtureRepo {
  checks.runs.length = 0;
  checks.hold = false;
  checks.fail = false;
  const repo = createFixtureRepo();
  onTestFinished(repo.cleanup);
  return repo;
}

/** A daemon in this process, ready, and stopped after the test unless it exited. */
async function start(
  repo: FixtureRepo,
  timings: Partial<DaemonTimings> = {},
  log: (line: string) => void = () => {},
) {
  const daemon = await startDaemon({ root: repo.root, env: repo.env, timings, log });
  if ("reason" in daemon) throw new Error(daemon.message);
  onTestFinished(async () => {
    await daemon.stop("stop-requested");
  });
  await daemon.ready;
  return daemon;
}

describe("the full integrity check after serving (row 011-226)", SLOW, () => {
  it("runs once for two daemons on one store, not again within 24 h, and again after", async () => {
    const repo = fixture();
    const [main] = await Promise.all([start(repo), start(linked(repo))]);
    expect(checks.runs).toHaveLength(1);
    expect(await checks.runs[0]?.done).toEqual({ ok: true });
    const claimed = withStore(repo, (store) => Number(store.meta.get(META_FULL_CHECK)));

    await main.stop("stop-requested");
    const again = await start(repo);
    expect(checks.runs).toHaveLength(1);
    expect(withStore(repo, (store) => Number(store.meta.get(META_FULL_CHECK)))).toBe(claimed);

    // The claim a day old: the next start runs it.
    withStore(repo, (store) => store.meta.set(META_FULL_CHECK, String(claimed - DAY_MS)));
    await again.stop("stop-requested");
    await start(repo);
    expect(checks.runs).toHaveLength(2);
    expect(await checks.runs[1]?.done).toEqual({ ok: true });
  });

  it("answers a hook while the full check runs", async () => {
    const repo = fixture();
    checks.hold = true;
    const daemon = await start(repo);
    const pid = checks.runs[0]?.pid;
    const check = checks.runs[0];
    if (check === undefined || pid === undefined) throw new Error("no full check started");
    const resume = () => {
      try {
        process.kill(pid, "SIGCONT");
      } catch {
        // Ended already.
      }
    };
    onTestFinished(resume);

    // Its process stopped: the check has not ended while the daemon answers.
    expect(await ping(repo.socketPath, 2_000)).toMatchObject({ phase: "ready" });
    const synced = await requestDaemon(repo.socketPath as AbsolutePath, { type: "sync" }, 10_000);
    expect(synced).toMatchObject({ ok: true, type: "sync" });
    expect(await Promise.race([check.done, Promise.resolve("running")])).toBe("running");

    resume();
    expect(await check.done).toEqual({ ok: true });
    await daemon.stop("stop-requested");
  });

  it("logs a full check whose start throws and goes on serving (row 011-229)", async () => {
    const repo = fixture();
    checks.fail = true;
    const logs: string[] = [];
    const daemon = await start(repo, {}, (line) => void logs.push(line));
    await until(() => logs.includes("full integrity check failed: Error: spawn E2BIG"));

    expect(await ping(repo.socketPath, 2_000)).toMatchObject({ phase: "ready" });
    const synced = await requestDaemon(repo.socketPath as AbsolutePath, { type: "sync" }, 10_000);
    expect(synced).toMatchObject({ ok: true, type: "sync" });
    expect(checks.runs).toHaveLength(0);
    await daemon.stop("stop-requested");
  });
});

describe("a store with only an index fault (row 011-226)", SLOW, () => {
  it("starts both daemons; the full check stops both, and the next start moves the store aside", async () => {
    const repo = fixture();
    seedIndexFault(repo.commonDir);
    const timings = { heartbeatMs: 200 };
    const daemons = await Promise.all([start(repo, timings), start(linked(repo), timings)]);
    expect(checks.runs).toHaveLength(1);

    const exits = await Promise.all(daemons.map((daemon) => daemon.exited));
    for (const exit of exits) {
      expect(exit).toMatchObject({
        reason: "store-unusable",
        message: expect.stringContaining("the full integrity check of the store found a fault"),
      });
    }
    expect(readStoreMark(repo.commonDir)?.problem).toContain("missing from index fault_a");

    await start(repo);
    expect(readStoreMark(repo.commonDir)).toBeNull();
    const recovered = withStore(repo, (store) => store.meta.get(META_STORE_RECOVERED));
    expect(JSON.parse(recovered ?? "null")).toMatchObject({
      check: "full",
      reason: expect.stringContaining("missing from index fault_a"),
    });
    const db = new DatabaseSync(storePaths(repo.commonDir).database, { readOnly: true });
    try {
      expect(db.prepare("SELECT name FROM sqlite_schema WHERE name = 'fault'").all()).toEqual([]);
    } finally {
      db.close();
    }
  });
});
