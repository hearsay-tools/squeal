import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { META_FULL_CHECK_HOLDER } from "../../src/core/daemon/full-check-claim.js";
import type { DaemonTimings } from "../../src/core/daemon/lifecycle.js";
import { socketPathFor } from "../../src/core/daemon/paths.js";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { readStoreMark } from "../../src/core/store/mark.js";
import { META_FULL_CHECK, META_STORE_RECOVERED, openStore } from "../../src/core/store/open.js";
import { storePaths } from "../../src/core/store/paths.js";
import { git } from "../hash/git-repo.js";
import { damageHeader, damageOverflow, seedOverflow } from "../store/damage.js";
import { childEnv, createFixtureRepo, type FixtureRepo, ping, SLOW, withStore } from "./helpers.js";

/*
 * Row 011-391 (011 "store failures", 001 D12, as amended): a daemon start
 * reads no whole store. Against real daemons on really damaged store files:
 * a start serves a store whose damage its open does not read; the read that
 * hits it marks the store and stops the daemon, every other daemon on the
 * store stops at its heartbeat, and the next start moves the store aside
 * with a note that names what found the damage. A damaged header moves it
 * aside at the start.
 */

/** Each full check ends at once with no fault: no check process runs here. */
vi.mock("../../src/core/daemon/full-check.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/daemon/full-check.js")>();
  return {
    ...actual,
    startFullCheck: (context: Parameters<typeof actual.startFullCheck>[0]) =>
      actual.startFullCheck({
        ...context,
        run: () => ({ pid: undefined, done: Promise.resolve({ ok: true }), stop: () => {} }),
      }),
  };
});

const { startDaemon } = await import("../../src/core/daemon/daemon.js");

const realPrepare = DatabaseSync.prototype.prepare;
const realExec = DatabaseSync.prototype.exec;

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
  const repo = createFixtureRepo();
  onTestFinished(repo.cleanup);
  return repo;
}

/** A daemon in this process, ready, and stopped after the test unless it exited. */
async function start(repo: FixtureRepo, timings: Partial<DaemonTimings> = {}) {
  const daemon = await startDaemon({ root: repo.root, env: repo.env, timings });
  if ("reason" in daemon) throw new Error(daemon.message);
  onTestFinished(async () => {
    await daemon.stop("stop-requested");
  });
  await daemon.ready;
  return daemon;
}

/** Creates the store with `kept: yes` in it. */
function seedKept(repo: FixtureRepo): void {
  const store = openStore(repo.commonDir);
  if ("reason" in store) throw new Error(JSON.stringify(store));
  store.meta.set("kept", "yes");
  store.close();
}

function recoveryNote(repo: FixtureRepo): Record<string, unknown> | null {
  return JSON.parse(withStore(repo, (store) => store.meta.get(META_STORE_RECOVERED)) ?? "null");
}

describe("damage a running daemon's read or write hits (row 011-391)", SLOW, () => {
  it("serves until a read hits the damage, then marks the store; both daemons stop, and the next start moves it aside", async () => {
    const repo = fixture();
    const other = linked(repo);
    // Claimed today, so a start's claim reads the holder row only.
    const store = openStore(repo.commonDir);
    if ("reason" in store) throw new Error(JSON.stringify(store));
    store.meta.set(META_FULL_CHECK, String(Date.now()));
    store.close();
    const timings = { heartbeatMs: 200 };
    const first = await start(other, timings);
    expect(await ping(other.socketPath, 2_000)).toMatchObject({ phase: "ready" });

    // Damage under the serving daemon, in pages it never read: the holder row's value.
    seedOverflow(repo.commonDir, META_FULL_CHECK_HOLDER);
    expect(damageOverflow(repo.commonDir)).toBeGreaterThan(40);
    expect(readStoreMark(repo.commonDir)).toBeNull();

    // This start serves, and its full check's claim reads the holder row.
    const second = await start(repo, timings);
    const [hit, beside] = await Promise.all([second.exited, first.exited]);
    expect(hit).toMatchObject({
      reason: "store-unusable",
      message: expect.stringMatching(
        /^daemon stopped: a daemon's read or write of the store found a fault \(.*(malformed|corrupt)/,
      ),
    });
    expect(beside).toMatchObject({
      reason: "store-unusable",
      message: expect.stringContaining("a daemon's read or write of the store found a fault"),
    });
    const mark = readStoreMark(repo.commonDir);
    expect(mark).toMatchObject({ found: "daemon", problem: expect.any(String) });

    await start(repo);
    expect(readStoreMark(repo.commonDir)).toBeNull();
    expect(recoveryNote(repo)).toMatchObject({
      found: "daemon",
      markedAt: mark?.at,
      reason: mark?.problem,
      movedTo: expect.stringContaining("store.sqlite.corrupt-"),
    });
  });
});

describe("a daemon start (row 011-391)", SLOW, () => {
  it("moves a store whose header is damaged aside at once, and serves a fresh one", async () => {
    const repo = fixture();
    seedKept(repo);
    damageHeader(repo.commonDir);

    await start(repo);
    expect(readStoreMark(repo.commonDir)).toBeNull();
    expect(withStore(repo, (store) => store.meta.get("kept"))).toBeNull();
    expect(recoveryNote(repo)).toMatchObject({
      found: "start",
      reason: expect.stringContaining("not a database"),
    });
  });

  it("issues no whole-store check on a large store", async () => {
    const repo = fixture();
    seedKept(repo);
    const db = new DatabaseSync(storePaths(repo.commonDir).database);
    db.exec("PRAGMA busy_timeout = 10000");
    db.exec("CREATE TABLE bulk(x TEXT)");
    db.prepare(
      "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 20000) " +
        "INSERT INTO bulk SELECT printf('%.1000c', 'x') FROM n",
    ).run();
    db.close();

    const sql: string[] = [];
    const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
    const exec = vi.spyOn(DatabaseSync.prototype, "exec");
    onTestFinished(() => {
      prepare.mockRestore();
      exec.mockRestore();
    });
    prepare.mockImplementation(function (this: DatabaseSync, text: string) {
      sql.push(text);
      return realPrepare.call(this, text);
    });
    exec.mockImplementation(function (this: DatabaseSync, text: string) {
      sql.push(text);
      return realExec.call(this, text);
    });
    await start(repo);
    prepare.mockRestore();
    exec.mockRestore();

    expect(sql.length).toBeGreaterThan(0);
    expect(sql.filter((text) => /quick_check|integrity_check/i.test(text))).toEqual([]);
    expect(withStore(repo, (store) => store.meta.get("kept"))).toBe("yes");
  });
});
