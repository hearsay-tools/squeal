import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createConnection, createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { onTestFinished, vi } from "vitest";
import { COVERAGE_RECORD_VERSION, decodeRecord } from "../../../src/core/code/coverage/record.js";
import { Keeper } from "../../../src/core/code/gate/keep.js";
import type { DaemonWaits } from "../../../src/core/code/gate/keep-sent.js";
import { isCodeStoreOpenFailure, openCodeStore } from "../../../src/core/code/store/open.js";
import { DaemonWrites } from "../../../src/core/daemon/busy-writes.js";
import { createHandlers } from "../../../src/core/daemon/handlers.js";
import { keepInDaemon } from "../../../src/core/daemon/keep-request.js";
import { acquireDaemonLock } from "../../../src/core/daemon/lock.js";
import { createDaemonServer } from "../../../src/core/daemon/server.js";
import { worktreeIdFor } from "../../../src/core/fs/git-layout.js";
import type { Hasher } from "../../../src/core/hash/hasher.js";
import { StatCache } from "../../../src/core/hash/stat-cache.js";
import { testFileId } from "../../../src/core/keys/reverse-index.js";
import type { WorktreeKeys } from "../../../src/core/scheduler/keying.js";
import { BusyWaits } from "../../../src/core/store/busy.js";
import { describeHolders, lockHolders } from "../../../src/core/store/lock-holders.js";
import { isStoreOpenFailure, openStore } from "../../../src/core/store/open.js";
import { lockFileFor, storePaths } from "../../../src/core/store/paths.js";
import type { AbsolutePath, EpochMs, WorktreeId } from "../../../src/core/types/common.js";
import type { DaemonPhase } from "../../../src/core/types/daemon.js";
import type { KeepRequest } from "../../../src/core/types/daemon-writes.js";
import type { CheckKey, TestFileRef } from "../../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";
import type { CheckRunResult, RunReport } from "../../../src/core/types/runner.js";

/*
 * Spec 021 D15 (row 021-20, part two): the kit of the keeper-through-daemon
 * tests. A worktree whose daemon holds its lock and serves its socket in
 * this process, with the daemon's own handlers and `keepInDaemon` on store
 * connections of its own, its writes in an async context of their own so a
 * counter tells them from the gate's; a proxy socket between them that can
 * delay or drop an answer (review 0.1.450 B2).
 */

export const A: TestFileRef = { project: "", path: "test/a.test.ts" };
export const B: TestFileRef = { project: "", path: "test/b.test.ts" };
export const KEY_A = "a".repeat(64) as CheckKey;
export const KEY_B = "b".repeat(64) as CheckKey;
export const RECORD = { v: 1, sources: [], unread: ["src/a.mjs"] } as never;
export const POLICY = {
  ...DEFAULT_POLICY,
  complexity: { ...DEFAULT_POLICY.complexity, enabled: true },
};
export const BOTH = [
  [A, KEY_A],
  [B, KEY_B],
] as const;

const inputOf = (ref: TestFileRef) => ref.path.replace(/^test\/(\w+)\.test\.ts$/, "src/$1.mjs");
const STAT = { mtimeMs: 1, ctimeMs: 1, size: 1, inode: 1 };

/** Inputs that hold until `move` changes one, as `keep-busy.test.ts` makes them. */
export function inputs() {
  const moved = new Set<string>();
  const hasher: Hasher = {
    stat: async (path) => (moved.has(path) ? { ...STAT, mtimeMs: 2, size: 2 } : STAT),
    hash: async (path) => (moved.has(path) ? "moved" : "h"),
    now: () => 1_000_000,
  };
  const cache = new StatCache([A, B].map((ref) => ({ path: inputOf(ref), ...STAT, hash: "h" })));
  const keys = {
    cache,
    stabilityPaths: (ref: TestFileRef) => [inputOf(ref)],
    beginRun: () => 1,
    endRun: () => {},
    observes: () => false,
    environmentFiles: () => [],
  } as unknown as WorktreeKeys;
  return { hasher, keys, move: (ref: TestFileRef) => moved.add(inputOf(ref)) };
}

export function report(
  completed: readonly TestFileRef[],
  results: readonly CheckRunResult[] = [],
): RunReport {
  return {
    end: "completed",
    durationMs: 1,
    completedFiles: completed,
    results,
    fileErrors: [],
    failure: null,
  };
}

/** The daemon's own async context: its writes are the daemon's. */
const daemonSide = new AsyncLocalStorage<true>();

/** A request line as the proxy reads it. */
export interface ProxiedRequest {
  readonly type: string;
  readonly write?: { readonly kind: string };
}

/**
 * What the proxy does with one connection's request: pass it and its
 * answer; drop it unsent, closing the connection; or pass it and hold its
 * answer `answerAfterMs`, past the gate's wait.
 */
export type ProxyPlan = (
  request: ProxiedRequest,
) => "forward" | "drop" | { readonly answerAfterMs: number };

export interface Served {
  readonly root: AbsolutePath;
  readonly commonDir: AbsolutePath;
  readonly worktreeId: WorktreeId;
  /** The daemon's store schema, which a keep request names. */
  readonly storeSchema: number;
  /** The daemon's socket, not the proxy's. */
  readonly socketPath: AbsolutePath;
  /** The keep requests the daemon ran. */
  readonly keeps: KeepRequest[];
  /** Holds the store's write lock from another connection until the returned release. */
  hold(): { readonly holder: string; release(): void };
}

export interface ServedOptions {
  /** False: a daemon before the keep request. */
  readonly takesKeeps?: boolean;
  readonly phase?: DaemonPhase;
  /** Records a proxy as the daemon's socket, with this plan for each request. */
  readonly proxy?: ProxyPlan;
  /** Runs before the daemon's write of each keep request. */
  readonly beforeKeep?: (request: KeepRequest) => Promise<void>;
}

/** A worktree whose daemon holds its lock and serves it, all removed when the test ends. */
export async function served(options: ServedOptions = {}): Promise<Served> {
  const root = mkdtempSync(join(tmpdir(), "squeal-keep-d-")) as AbsolutePath;
  const commonDir = join(root, ".git") as AbsolutePath;
  mkdirSync(commonDir);
  const worktreeId = worktreeIdFor(root);
  const store = openStore(commonDir);
  if (isStoreOpenFailure(store)) throw new Error(store.reason);
  const socketPath = join(root, "d.sock") as AbsolutePath;
  const keeps: KeepRequest[] = [];
  const writes = new DaemonWrites(new BusyWaits({ now: Date.now, note: () => {} }));
  const requestKeep = async (request: KeepRequest) => {
    await options.beforeKeep?.(request);
    keeps.push(request);
    return daemonSide.run(true, () =>
      keepInDaemon(
        { commonDir, worktreeId, store, policy: () => POLICY, writes, now: Date.now },
        request,
      ),
    );
  };
  const server = await createDaemonServer(
    socketPath,
    createHandlers({
      worktreeId,
      root,
      squealVersion: "0.0.0-test",
      startedAt: 1 as EpochMs,
      token: "t",
      phase: () => options.phase ?? "ready",
      requestFullSuite: () => Promise.reject(new Error("not in this test")),
      onActivity: () => {},
      onStop: () => {},
      onStepDown: () => {},
      storeSchema: store.schemaVersion,
      ...(options.takesKeeps === false ? {} : { requestKeep }),
    }),
  );
  const recorded =
    options.proxy === undefined
      ? socketPath
      : await proxyTo(socketPath, join(root, "p.sock") as AbsolutePath, options.proxy);
  store.worktrees.upsert({
    id: worktreeId,
    root,
    commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  store.worktrees.setDaemon(worktreeId, {
    socketPath: recorded,
    startedAt: 1 as EpochMs,
    heartbeatAt: Date.now() as EpochMs,
    heartbeatIntervalMs: 3_600_000,
    squealVersion: "0.0.0-test",
  });
  const lock = acquireDaemonLock(lockFileFor(commonDir, worktreeId));
  if (lock === null) throw new Error("the worktree's lock is held");
  onTestFinished(async () => {
    lock.release();
    await server.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  const hold = () => {
    const holder = new DatabaseSync(storePaths(commonDir).database);
    holder.exec("BEGIN IMMEDIATE");
    const release = () => {
      if (!holder.isOpen) return;
      holder.exec("ROLLBACK");
      holder.close();
    };
    onTestFinished(release);
    return { holder: describeHolders(lockHolders(storePaths(commonDir).database)), release };
  };
  const { schemaVersion: storeSchema } = store;
  return { root, commonDir, worktreeId, storeSchema, socketPath, keeps, hold };
}

/** A socket at `path` that passes each request to `target` as `plan` says; closed when the test ends. */
async function proxyTo(
  target: AbsolutePath,
  path: AbsolutePath,
  plan: ProxyPlan,
): Promise<AbsolutePath> {
  const server = createServer((client: Socket) => {
    let line = "";
    client.on("error", () => {});
    client.on("data", (chunk) => {
      line += chunk.toString("utf8");
      const end = line.indexOf("\n");
      if (end < 0) return;
      const what = plan(JSON.parse(line.slice(0, end)) as ProxiedRequest);
      if (what === "drop") {
        client.destroy();
        return;
      }
      const upstream = createConnection(target);
      upstream.on("error", () => client.destroy());
      upstream.on("data", (answer) => {
        const send = () => {
          if (!client.destroyed) client.end(answer);
        };
        if (what === "forward") send();
        else setTimeout(send, what.answerAfterMs);
      });
      upstream.write(line.slice(0, end + 1));
    });
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return path;
}

/**
 * Write transactions this process opens on `store.sqlite` or `code.sqlite`
 * outside the daemon's context until `stop`: the gate's own writes.
 */
export function countGateWrites(): { stop(): number } {
  const exec = DatabaseSync.prototype.exec;
  let count = 0;
  const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
    this: DatabaseSync,
    sql: string,
  ) {
    const file = this.location() ?? "";
    const store = file.endsWith("store.sqlite") || file.endsWith("code.sqlite");
    if (store && /^\s*BEGIN\s+IMMEDIATE/i.test(sql) && daemonSide.getStore() !== true) count++;
    return exec.call(this, sql);
  });
  onTestFinished(() => spy.mockRestore());
  return {
    stop: () => {
      spy.mockRestore();
      return count;
    },
  };
}

export interface KeptOptions {
  readonly busyBoundMs?: number;
  readonly files?: readonly (readonly [TestFileRef, CheckKey])[];
  readonly onBusy?: (moved: ReturnType<typeof inputs>) => void;
  /** Each file's coverage record; default `RECORD`. */
  readonly record?: unknown;
  /** The run's results; default none, so each file stores its file check alone. */
  readonly results?: readonly CheckRunResult[];
  readonly daemonWaits?: DaemonWaits;
}

/** `files` run and flushed by a keeper of `at`'s worktree; `onBusy` runs at the busy note. */
export async function kept(at: Served, notes: string[], options: KeptOptions = {}): Promise<void> {
  const { busyBoundMs = 5_000, files = [[A, KEY_A]], onBusy = () => {} } = options;
  const moving = inputs();
  const keep = new Keeper({
    root: at.root,
    commonDir: at.commonDir,
    policy: POLICY,
    head: async () => ({ head: "a".repeat(40), dirty: false }),
    note: (text) => {
      notes.push(text);
      if (text.startsWith("the store is busy")) onBusy(moving);
    },
    busyBoundMs,
    ...(options.daemonWaits === undefined ? {} : { daemonWaits: options.daemonWaits }),
  });
  keep.expect("vitest", moving.keys, moving.hasher, new Map(files));
  const refs = files.map(([ref]) => ref);
  const record = options.record ?? RECORD;
  await keep.ran({
    runner: "vitest",
    files: refs,
    report: report(refs, options.results),
    records: new Map(refs.map((ref) => [testFileId(ref), { record: record as never }])),
  });
  await keep.flush();
}

export function resultsAt(commonDir: string, key: CheckKey = KEY_A): number {
  const db = new DatabaseSync(storePaths(commonDir).database, { readOnly: true });
  try {
    return Number(db.prepare("SELECT count(*) AS n FROM results WHERE key = ?").get(key)?.n);
  } finally {
    db.close();
  }
}

export function recordAt(commonDir: AbsolutePath, key: CheckKey = KEY_A): unknown {
  const code = openCodeStore(commonDir, POLICY, { create: false });
  if (isCodeStoreOpenFailure(code)) return null;
  try {
    const bytes = code.coverage.get({ resultKey: key, providerVersion: COVERAGE_RECORD_VERSION });
    return bytes === null ? null : decodeRecord(bytes);
  } finally {
    code.close();
  }
}
