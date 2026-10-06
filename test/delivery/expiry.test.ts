import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { expireConsumers } from "../../src/core/delivery/index.js";
import { storePaths } from "../../src/core/store/index.js";
import {
  CONSUMER_EXPIRY_MS,
  type Consumer,
  type Store,
  WAITERLESS_EXPIRY_MS,
} from "../../src/core/types/index.js";
import { acquireWaiterLock, waiterLockPath } from "../../src/core/waiter-lock/index.js";
import { fakeCommonDir, open } from "../store/helpers.js";

const WT = "0123456789abcdef";
const MIN = 60_000;
const NOW = 100 * 60 * MIN;

const consumer = (sessionId: string, agentId = "main"): Consumer => ({
  worktreeId: WT,
  sessionId,
  agentId,
});

const held: DatabaseSync[] = [];
afterEach(() => {
  for (const db of held.splice(0)) db.close();
});

/** Holds the lock file the way a running waiter would. */
function hold(path: string): void {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA locking_mode = EXCLUSIVE");
  db.exec("BEGIN EXCLUSIVE");
  held.push(db);
}

/** A lock file left behind by a waiter Claude Code killed (137): present, held by no one. */
function leaveLockFile(locksDir: string, c: Consumer): string {
  acquireWaiterLock(locksDir, c)?.release(false);
  const path = waiterLockPath(locksDir, c);
  expect(existsSync(path)).toBe(true);
  return path;
}

function setup(): { store: Store; locksDir: string } {
  const commonDir = fakeCommonDir();
  const store = open(commonDir);
  const { locksDir } = storePaths(commonDir);
  mkdirSync(locksDir, { recursive: true });
  return { store, locksDir };
}

const registered = (store: Store) => store.consumers.list(WT).map((r) => r.consumer.sessionId);

describe("expireConsumers: waiterless interactive consumers (lessons, defects 8 and 10)", () => {
  it("expires an unheld lock file's consumer after 10 minutes and keeps every other one", () => {
    const { store, locksDir } = setup();
    const gone = consumer("gone");
    const waiting = consumer("waiting");
    const headless = consumer("headless");
    const recent = consumer("recent");
    store.consumers.register(gone, NOW - 11 * MIN);
    store.consumers.register(waiting, NOW - 11 * MIN);
    store.consumers.register(headless, NOW - 11 * MIN);
    store.consumers.register(recent, NOW - 9 * MIN);
    const goneLock = leaveLockFile(locksDir, gone);
    hold(leaveLockFile(locksDir, waiting));
    leaveLockFile(locksDir, recent);

    const expired = expireConsumers(store, NOW, { locksDir });

    expect(expired).toEqual([gone]);
    expect(registered(store)).toEqual(["headless", "recent", "waiting"]);
    expect(existsSync(goneLock)).toBe(false);
    expect(existsSync(waiterLockPath(locksDir, waiting))).toBe(true);
    expect(existsSync(waiterLockPath(locksDir, recent))).toBe(true);
  });

  it("counts a delivery as heard from", () => {
    const { store, locksDir } = setup();
    const c = consumer("delivered");
    store.consumers.register(c, NOW - 30 * MIN);
    store.consumers.touch(c, NOW - 30 * MIN, false);
    store.consumers.touch(c, NOW - 5 * MIN, true);
    leaveLockFile(locksDir, c);
    expect(expireConsumers(store, NOW, { locksDir })).toEqual([]);
  });

  it("starts the 10 minutes at the boundary, not before", () => {
    const { store, locksDir } = setup();
    const c = consumer("edge");
    store.consumers.register(c, NOW - WAITERLESS_EXPIRY_MS);
    leaveLockFile(locksDir, c);
    expect(expireConsumers(store, NOW, { locksDir })).toEqual([]);
    expect(expireConsumers(store, NOW + 1, { locksDir })).toEqual([c]);
  });

  it("keeps the 12 hour rule for consumers without a lock file and removes free lock files of those it expires", () => {
    const { store, locksDir } = setup();
    const old = consumer("old", "agent-1");
    store.consumers.register(old, NOW - CONSUMER_EXPIRY_MS - 1);
    store.consumers.register(consumer("young"), NOW - CONSUMER_EXPIRY_MS + MIN);
    const path = waiterLockPath(locksDir, old);
    writeFileSync(path, "");
    expect(expireConsumers(store, NOW, { locksDir })).toEqual([old]);
    expect(registered(store)).toEqual(["young"]);
    expect(existsSync(path)).toBe(false);
  });

  it("without a locks directory applies only the 12 hour rule", () => {
    const { store, locksDir } = setup();
    const c = consumer("gone");
    store.consumers.register(c, NOW - 11 * MIN);
    leaveLockFile(locksDir, c);
    expect(expireConsumers(store, NOW)).toEqual([]);
    expect(registered(store)).toEqual(["gone"]);
  });
});
