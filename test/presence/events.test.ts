import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { acquireDaemonLock } from "../../src/core/daemon/lock.js";
import { lifeOf } from "../../src/core/daemon/terminate.js";
import {
  claimHandoff,
  clearHandoff,
  clearRecord,
  clearStartMark,
  clearStopped,
  endHandoff,
  FeedDeliveredRow,
  forgetRest,
  markExit,
  markRest,
  markSpawn,
  markStart,
  markStopped,
  type Registration,
  recordHeartbeat,
  recordRegistration,
  spawnedAfterRest,
  spawnMarkFor,
  startMarkFor,
} from "../../src/core/presence/index.js";
import { storePaths } from "../../src/core/store/index.js";
import type { AbsolutePath, DaemonRecord, EpochMs, Store } from "../../src/core/types/index.js";
import { fakeCommonDir, open, worktree } from "../store/helpers.js";

/*
 * Row 011-294: each presence event stores the bytes its writer stored before
 * the move, in the same meta rows, worktree row and lock-file marks. The
 * literals below were read from the old writers (`daemon/start-mark.ts`,
 * `delivery/liveness.ts`, `delivery/stopped.ts`, `delivery/handoff.ts`,
 * `status/feed-late.ts` and the inline writes of `daemon/daemon.ts` and
 * `daemon/lifecycle.ts` at b9ef6a7e3): this file ran green against them
 * before they moved. A daemon of the previous release reads these bytes.
 */

const ID = "wt-events";
const at = (ms: number) => ms as EpochMs;
const SELF = "0.1.400@500#tok";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A store with the worktree's row, and its common dir. */
function scratch(): { store: Store; commonDir: string } {
  const commonDir = fakeCommonDir();
  const store = open(commonDir);
  store.worktrees.upsert(worktree(ID, "/wt", { commonDir }));
  return { store, commonDir };
}

/** Every row of `meta` and `worktrees` as the database file holds it. */
function stored(commonDir: string): { meta: unknown[]; worktrees: unknown[] } {
  const db = new DatabaseSync(storePaths(commonDir).database, { readOnly: true });
  try {
    const meta = db.prepare("SELECT key, value FROM meta ORDER BY key").all();
    const worktrees = db.prepare("SELECT * FROM worktrees ORDER BY id").all();
    return { meta: meta.map((r) => ({ ...r })), worktrees: worktrees.map((r) => ({ ...r })) };
  } finally {
    db.close();
  }
}

/** The stored `meta` rows whose key ends with the worktree's id, by key. */
function metaOf(commonDir: string): Record<string, string> {
  const rows = stored(commonDir).meta as { key: string; value: string }[];
  return Object.fromEntries(rows.filter((r) => r.key.endsWith(ID)).map((r) => [r.key, r.value]));
}

/** A lock file in a scratch locks directory, made unless `made` is false. */
function lockFile(made = true): AbsolutePath {
  const dir = mkdtempSync("/tmp/sq-events-");
  dirs.push(dir);
  if (made) mkdirSync(join(dir, "locks"));
  return join(dir, "locks", "daemon.lock") as AbsolutePath;
}

const RECORD = {
  socketPath: "/tmp/sq-events.sock" as AbsolutePath,
  startedAt: at(500),
  heartbeatAt: at(1_000),
  heartbeatIntervalMs: 5_000,
  squealVersion: "0.1.400",
  token: "tok",
  executable: "/opt/squeal/cli.mjs",
} satisfies DaemonRecord;

/** The record's token row (`store/repos/worktrees`), written with it. */
const TOKEN_ROW =
  '{"startedAt":500,"squealVersion":"0.1.400","token":"tok","executable":"/opt/squeal/cli.mjs"}';

/**
 * `RECORD`'s registration in worktree `/wt` of `/c`, whose clock reads 999 as
 * the handoff ends and 1000, the record's heartbeat, after the row is written.
 */
function registration(options: { isMain: boolean; exiting: boolean }): Registration {
  const readings = [at(999), RECORD.heartbeatAt];
  const { heartbeatAt: _heartbeat, ...daemon } = RECORD;
  return {
    id: ID,
    root: "/wt" as AbsolutePath,
    commonDir: "/c" as AbsolutePath,
    registeredAt: at(1),
    isMain: () => options.isMain,
    daemon,
    now: () => readings.shift() ?? at(-1),
    exiting: options.exiting,
  };
}

describe("lock-file events store the old marks (row 011-294)", () => {
  it("start marked: this process's pid and start time, by rename; its release removes it first", () => {
    const file = lockFile();
    const lock = acquireDaemonLock(file);
    if (lock === null) throw new Error("the lock is taken");
    const held = markStart(file, lock);
    const start = process.platform === "linux" ? (lifeOf(process.pid)?.start ?? null) : null;
    expect(readFileSync(startMarkFor(file), "utf8")).toBe(
      `{"pid":${process.pid},"startTime":${start}}`,
    );
    held.release();
    expect(existsSync(startMarkFor(file))).toBe(false);
    expect(acquireDaemonLock(file)).not.toBeNull();
  });

  it("spawned: the spawn's time, the locks directory made; the first since the heartbeat keeps its time", () => {
    const file = lockFile(false);
    markSpawn(file, at(1_000), null);
    expect(readFileSync(spawnMarkFor(file), "utf8")).toBe('{"at":1000}');
    markSpawn(file, at(2_000), at(500));
    expect(readFileSync(spawnMarkFor(file), "utf8")).toBe('{"at":1000}');
    markSpawn(file, at(3_000), at(1_000));
    expect(readFileSync(spawnMarkFor(file), "utf8")).toBe('{"at":3000}');
  });

  it("start cleared: removes the start mark and the spawn mark", () => {
    const file = lockFile();
    markSpawn(file, at(1_000), null);
    const lock = acquireDaemonLock(file);
    if (lock === null) throw new Error("the lock is taken");
    const held = markStart(file, lock);
    clearStartMark(file);
    expect([existsSync(startMarkFor(file)), existsSync(spawnMarkFor(file))]).toEqual([
      false,
      false,
    ]);
    held.release();
  });
});

describe("meta events store the old rows (row 011-294)", () => {
  it("rested, spawned after the rest, and the overdue rest forgotten", () => {
    const { store, commonDir } = scratch();
    spawnedAfterRest(store, ID, at(900));
    expect(metaOf(commonDir)).toEqual({});
    markRest(store, ID, at(1_000));
    expect(metaOf(commonDir)).toEqual({ [`daemon-rest:${ID}`]: '{"at":1000}' });
    spawnedAfterRest(store, ID, at(2_000));
    spawnedAfterRest(store, ID, at(3_000));
    expect(metaOf(commonDir)).toEqual({ [`daemon-rest:${ID}`]: '{"at":1000,"spawnedAt":2000}' });
    forgetRest(store, ID);
    expect(metaOf(commonDir)).toEqual({});
  });

  it("stopped by request: time and tree, `untilStart` kept by a plain stop; cleared", () => {
    const { store, commonDir } = scratch();
    const key = `daemon-stopped:${ID}`;
    expect(markStopped(store, ID, at(1_000), "t")).toBe(false);
    expect(metaOf(commonDir)).toEqual({ [key]: '{"at":1000,"tree":"t"}' });
    expect(markStopped(store, ID, at(2_000), null)).toBe(false);
    expect(metaOf(commonDir)).toEqual({ [key]: '{"at":2000,"tree":null}' });
    expect(markStopped(store, ID, at(3_000), "u", true)).toBe(true);
    expect(metaOf(commonDir)).toEqual({ [key]: '{"at":3000,"tree":"u","untilStart":true}' });
    expect(markStopped(store, ID, at(4_000), "v")).toBe(true);
    expect(metaOf(commonDir)).toEqual({ [key]: '{"at":4000,"tree":"v","untilStart":true}' });
    clearStopped(store, ID);
    expect(metaOf(commonDir)).toEqual({});
  });

  it("handoff claimed: one claim per incarnation while it holds, with its bound; ended", () => {
    const { store, commonDir } = scratch();
    const key = `daemon-handoff:${ID}`;
    const claim = { from: SELF, to: "0.1.401", at: at(1_000) };
    expect(claimHandoff(store, ID, claim)).toEqual({ ...claim, boundAt: 131_000 });
    expect(metaOf(commonDir)).toEqual({
      [key]: `{"from":"${SELF}","to":"0.1.401","at":1000,"boundAt":131000}`,
    });
    expect(claimHandoff(store, ID, { ...claim, to: "0.1.402", at: at(130_999) })).toBeNull();
    expect(claimHandoff(store, ID, { ...claim, to: "0.1.402", at: at(131_000) })).not.toBeNull();
    expect(metaOf(commonDir)).toEqual({
      [key]: `{"from":"${SELF}","to":"0.1.402","at":131000,"boundAt":261000}`,
    });
    clearHandoff(store, ID);
    expect(metaOf(commonDir)).toEqual({});
  });

  it("handoff ended short: the mark and one note; any other end clears the mark", () => {
    const { store, commonDir } = scratch();
    claimHandoff(store, ID, { from: "0.1.399@1#old", to: "0.1.401", at: at(1_000) });
    const daemon = { of: SELF, version: "0.1.400", executable: "/k/cli.mjs", at: at(2_000) };
    store.transaction(() => endHandoff(store, ID, daemon));
    const text =
      "the handoff to Squeal 0.1.401 ended with a 0.1.400 daemon from /k/cli.mjs; " +
      "no hook asks it to step down again, and `squeal start` of 0.1.401 replaces it";
    expect(metaOf(commonDir)).toEqual({
      [`daemon-handoff-short:${ID}`]: `{"of":"${SELF}","version":"0.1.400","claimed":"0.1.401","at":2000}`,
      [`notes.${ID}`]: JSON.stringify([{ at: 2_000, revision: null, text }]),
    });
    store.transaction(() => endHandoff(store, ID, { ...daemon, version: "0.1.401" }));
    expect(Object.keys(metaOf(commonDir))).toEqual([`notes.${ID}`]);
  });

  it("feed delivered: the batch's start as a number, once it is 15 s past the stored one", () => {
    const { store, commonDir } = scratch();
    const errors: Error[] = [];
    const row = new FeedDeliveredRow(store, ID, (e) => errors.push(e));
    row.record(at(1_000));
    row.record(at(15_999));
    expect(metaOf(commonDir)).toEqual({ [`feed-delivered:${ID}`]: "1000" });
    row.record(at(16_000));
    expect(metaOf(commonDir)).toEqual({ [`feed-delivered:${ID}`]: "16000" });
    expect(errors).toEqual([]);
  });
});

describe("daemon record events store the old rows (row 011-294)", () => {
  /** What the store holds after `write` over a row with an old exit mark, claim and short mark. */
  function storedAfter(write: (store: Store) => void): { meta: unknown[]; worktrees: unknown[] } {
    const { store, commonDir } = scratch();
    store.transaction(() => {
      markExit(store, ID, "0.1.399@1#old");
      claimHandoff(store, ID, { from: "0.1.399@1#old", to: "0.1.400", at: at(400) });
    });
    write(store);
    const rows = stored(commonDir);
    return {
      ...rows,
      worktrees: rows.worktrees.map((w) => ({ ...(w as object), common_dir: "" })),
    };
  }

  it("exiting: the incarnation, only while the worktree has its row", () => {
    const { store, commonDir } = scratch();
    store.transaction(() => markExit(store, ID, SELF));
    expect(metaOf(commonDir)).toEqual({ [`daemon-exit:${ID}`]: SELF });
    store.worktrees.remove(ID);
    store.transaction(() => markExit(store, ID, SELF));
    expect(metaOf(commonDir)).toEqual({});
  });

  it("registered: the row and record, the exit mark gone, the handoff ended", () => {
    const rows = storedAfter((store) =>
      store.transaction(() =>
        recordRegistration(store, registration({ isMain: false, exiting: false })),
      ),
    );
    expect(rows.meta).toEqual([{ key: `daemon-token:${ID}`, value: TOKEN_ROW }]);
    expect(rows.worktrees).toEqual([
      {
        id: ID,
        root: "/wt",
        common_dir: "",
        is_main: 0,
        registered_at: 1,
        daemon_socket: "/tmp/sq-events.sock",
        daemon_started_at: 500,
        daemon_heartbeat_at: 1000,
        daemon_heartbeat_interval_ms: 5000,
        daemon_version: "0.1.400",
      },
    ]);
  });

  it("registered while its shutdown began: its own exit mark replaces the old one", () => {
    const rows = storedAfter((store) =>
      store.transaction(() =>
        recordRegistration(store, registration({ isMain: true, exiting: true })),
      ),
    );
    expect(rows.meta).toEqual([
      { key: `daemon-exit:${ID}`, value: SELF },
      { key: `daemon-token:${ID}`, value: TOKEN_ROW },
    ]);
  });

  it("beat, then the record cleared: the heartbeat moves, and the row keeps the last one", () => {
    const { store, commonDir } = scratch();
    store.transaction(() =>
      recordRegistration(store, registration({ isMain: false, exiting: false })),
    );
    recordHeartbeat(store, ID, at(6_000));
    expect(stored(commonDir).worktrees).toMatchObject([{ daemon_heartbeat_at: 6000 }]);
    clearRecord(store, ID);
    expect(stored(commonDir).worktrees).toEqual([
      {
        id: ID,
        root: "/wt",
        common_dir: "/c",
        is_main: 0,
        registered_at: 1,
        daemon_socket: null,
        daemon_started_at: 500,
        daemon_heartbeat_at: 6000,
        daemon_heartbeat_interval_ms: null,
        daemon_version: "0.1.400",
      },
    ]);
    expect(store.worktrees.get(ID)?.lastHeartbeatAt).toBe(6_000);
  });
});
