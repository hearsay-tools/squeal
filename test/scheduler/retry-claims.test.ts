import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { askRetry, claimRetries, readRetries } from "../../src/core/retry/index.js";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import { Ledger } from "../../src/core/scheduler/ledger.js";
import { takeRetries } from "../../src/core/scheduler/retries.js";
import { createStateSink } from "../../src/core/state/index.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/index.js";
import {
  type CheckKey,
  DEFAULT_POLICY,
  type Store,
  type TestFileRef,
  type WorktreeId,
} from "../../src/core/types/index.js";
import { HARNESS_DAEMON } from "./store-wait.js";

/*
 * Review 001-398, S1: a daemon gives back the retry claims it holds on a
 * test file once the file leaves the request's key here, its removal
 * included, so another live worktree still at the key runs the request.
 */

const A = "wt-398-a" as WorktreeId;
const B = "wt-398-b" as WorktreeId;
const FILE: TestFileRef = { project: "", path: "test/a.test.ts" };
const K = "k".repeat(64) as CheckKey;
const NOTHING = new Set<never>();
const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

/** A store where `A` and `B` both have a live daemon. */
function open(): Store {
  const dir = mkdtempSync(join(tmpdir(), "sq-398-"));
  const store = openStore(dir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(store)) throw new Error(`store: ${JSON.stringify(store)}`);
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  cleanups.push(() => store.close());
  for (const id of [A, B]) {
    store.worktrees.upsert({
      id,
      root: join(dir, id),
      commonDir: dir,
      isMain: id === A,
      registeredAt: Date.now(),
      daemon: {
        ...HARNESS_DAEMON,
        socketPath: `/tmp/squeal-398-${id}.sock`,
        heartbeatAt: Date.now(),
        heartbeatIntervalMs: 600_000,
      },
    });
  }
  return store;
}

/** `A`'s ledger, with the file at `keys`' key unless it is `gone`, and the context `takeRetries` reads. */
function daemonA(store: Store, keys: Map<string, CheckKey>, gone = false) {
  const context = {
    store,
    sink: createStateSink(store),
    worktreeId: A,
    policy: DEFAULT_POLICY,
    now: Date.now,
    hostLoad: () => ({ oneMinute: 0, cpus: 8 }),
    keys: {
      runnerOf: () => undefined,
      index: { key: (ref: TestFileRef) => keys.get(ref.path) ?? null, keysReadAsOne: () => null },
      removeTestFile: () => {},
    },
  } as unknown as SchedulerContext;
  const ledger = new Ledger(context);
  if (gone) return { context, ledger, file: null };
  const file = ledger.addFile(FILE);
  ledger.settle([FILE], NOTHING);
  return { context, ledger, file };
}

/** `A` claims a request asked at `K` and queues its forced run, which has not run yet. */
function queuedRetry() {
  const store = open();
  const keys = new Map([[FILE.path, K]]);
  const a = daemonA(store, keys);
  const file = a.file as NonNullable<typeof a.file>;
  askRetry(store, {
    testFile: FILE,
    key: K,
    session: "s1",
    reason: "environment",
    at: 1,
    worktreeId: A,
  });
  expect(takeRetries(a.context, a.ledger)).toBe(true);
  expect(file.retryKey).toBe(K);
  expect(a.ledger.queue.isForced(FILE)).toBe(true);
  expect(readRetries(store)[0]?.claim?.worktreeId).toBe(A);
  return { store, keys, ...a, file };
}

const bTakes = (store: Store) => claimRetries(store, FILE, K, B, Date.now(), () => true);

describe("a claimed retry whose file leaves its key", () => {
  it("is given back when its file is removed, so a live worktree at the key takes it", () => {
    const { store, ledger, file } = queuedRetry();
    expect(bTakes(store)).toBe(false);
    ledger.removeFile(file);
    expect(readRetries(store)[0]).toMatchObject({ key: K, claim: null, end: null });
    expect(bTakes(store)).toBe(true);
  });

  it("is given back when its file's key moves, so a live worktree at the key takes it", () => {
    const { store, keys, ledger, file } = queuedRetry();
    keys.set(FILE.path, "m".repeat(64) as CheckKey);
    ledger.settle([FILE], NOTHING);
    expect(file.retryKey).toBeNull();
    expect(readRetries(store)[0]).toMatchObject({ key: K, claim: null, end: null });
    expect(bTakes(store)).toBe(true);
  });

  it("is given back by the worktree's next daemon when the file went while none ran", () => {
    const { store, keys } = queuedRetry();
    const next = daemonA(store, keys, true);
    expect(takeRetries(next.context, next.ledger)).toBe(false);
    expect(readRetries(store)[0]).toMatchObject({ key: K, claim: null, end: null });
    expect(bTakes(store)).toBe(true);
  });
});
