import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { recordVersion } from "../../src/core/delivery/consumer-version.js";
import { departedMetaKey } from "../../src/core/delivery/expiry.js";
import { recordHarness } from "../../src/core/delivery/harness-process.js";
import { discover, phaseOn } from "../../src/core/ps/discover.js";
import type { DaemonWork } from "../../src/core/ps/model.js";
import { createProcSource } from "../../src/core/ps/proc.js";
import type { PsSource } from "../../src/core/ps/source.js";
import { readWork } from "../../src/core/ps/work.js";
import { publishSlowActivity } from "../../src/core/slow/state.js";
import { type Store, worktreeMetaKey } from "../../src/core/types/index.js";
import { startTicksOf } from "./fixture.js";
import {
  daemonProcess,
  daemonRecord,
  type FixtureHost,
  type FixtureRepo,
  lockLine,
  makeHost,
  makeRepo,
  PID_NAMESPACE,
  STARTED_AT,
  withoutLocks,
  writeLocks,
  writeProcesses,
  writeStore,
} from "./fixture-stores.js";

/*
 * Spec 014 D3 (task 014-06): what each daemon's store says of it, read once
 * through a read-only `node:sqlite` connection, never `openStore`: the
 * record, the counts, the open runs and checkpoints since the daemon
 * started, the consumers and their harness processes, the departure and the
 * slow tier, and the settings of its own `squeal.config.json`.
 */

const HOUR = 3_600_000;
let host: FixtureHost;
let alpha: FixtureRepo;
let beta: FixtureRepo;
let source: PsSource;

beforeEach(() => {
  host = makeHost();
  alpha = makeRepo(host.base, "alpha");
  beta = makeRepo(host.base, "beta");
  source = createProcSource({ root: host.base, run: () => null });
});

afterEach(() => {
  rmSync(host.base, { recursive: true, force: true });
});

const key = (path: string): string => source.fileKey(path) ?? "";
/** Daemon `pid` of `repo`, holding its lock unless `held` is false. */
function serve(pid: number, repo: FixtureRepo, held = true): void {
  writeProcesses(host, [daemonProcess({ pid, root: repo.root, lockPath: repo.lockPath })]);
  if (held) writeLocks(host, [lockLine(1, pid, key(repo.lockPath))]);
}
function read(on: PsSource = source) {
  const table = on.processTable();
  return readWork(on, table, discover(on, table, host.places).daemons);
}
/** Each daemon's phase, as the snapshot will assemble it. */
function phases(on: PsSource = source, now = STARTED_AT + 60_000) {
  const table = on.processTable();
  const { daemons } = discover(on, table, host.places);
  const { work } = readWork(on, table, daemons);
  const phase = phaseOn(on);
  return new Map(daemons.map((d) => [d.row.pid, phase(d, work.get(d.row.pid) ?? null, now)]));
}
function workOf(pid: number, on: PsSource = source): DaemonWork {
  const result = read(on).work.get(pid);
  if (result === undefined) throw new Error(`no work for daemon ${pid}`);
  return result;
}
const file = (path: string) => ({ project: "default", path });
const files = (...paths: string[]) => paths.map(file);
function run(store: Store, id: string, startedAt: number, opts: Partial<RunOptions> = {}) {
  store.runs.start({
    id,
    worktreeId: alpha.id,
    revision: 1,
    testFiles: opts.testFiles ?? files("test/a.test.ts"),
    checkpointId: opts.checkpointId ?? null,
    logDir: "/tmp/runs",
    startedAt,
  });
  if (opts.ended === true) store.runs.finish(id, "completed", startedAt + 1_000);
}
interface RunOptions {
  readonly testFiles: ReturnType<typeof files>;
  readonly checkpointId: string;
  readonly ended: boolean;
}

describe("a serving daemon's work", () => {
  test("the record, its token and the pending and running counts", () => {
    serve(800, alpha);
    writeStore(alpha, daemonRecord(alpha), (store) => {
      store.testFileKeys.upsertMany(
        ["a", "b", "c", "d"].map((name, i) => ({
          worktreeId: alpha.id,
          testFile: file(`test/${name}.test.ts`),
          key: `k${i}`,
          revision: 1,
          pending: i < 2 ? "queued" : i === 2 ? "running" : null,
        })),
      );
    });
    const work = workOf(800);
    expect(work.record).toEqual(daemonRecord(alpha));
    expect(work.token).toBe(daemonRecord(alpha).token);
    expect([work.pending, work.running]).toEqual([2, 1]);
    expect(work.lastUse).toBeNull();
  });

  test("open runs and checkpoints only since the daemon started, oldest first, by lane", () => {
    serve(800, alpha);
    writeStore(alpha, daemonRecord(alpha), (store) => {
      // Left open 21.6 h before by an earlier daemon (`research/daemon-discovery.md` 3).
      run(store, "old", STARTED_AT - 21.6 * HOUR);
      store.checkpoints.start({
        id: "cp-old",
        worktreeId: alpha.id,
        revision: 1,
        kind: "run-all",
        testFiles: files("a"),
        startedAt: STARTED_AT - 22 * HOUR,
      });
      store.checkpoints.start({
        id: "cp-slow",
        worktreeId: alpha.id,
        revision: 2,
        kind: "run-all",
        testFiles: files("a", "b", "c"),
        startedAt: STARTED_AT + 1_000,
        lane: "slow",
      });
      store.checkpoints.start({
        id: "cp-done",
        worktreeId: alpha.id,
        revision: 2,
        kind: "baseline",
        testFiles: files("a"),
        startedAt: STARTED_AT + 2_000,
      });
      store.checkpoints.finish("cp-done", "completed", STARTED_AT + 3_000);
      store.checkpoints.start({
        id: "cp-both",
        worktreeId: alpha.id,
        revision: 3,
        kind: "run-all",
        testFiles: files("a", "b"),
        startedAt: STARTED_AT + 4_000,
      });
      store.checkpoints.start({
        id: "cp-fast",
        worktreeId: alpha.id,
        revision: 3,
        kind: "run-all",
        testFiles: files("a"),
        startedAt: STARTED_AT + 4_500,
        lane: "fast",
      });
      run(store, "edit", STARTED_AT + 5_000, { testFiles: files("a", "b") });
      run(store, "ended", STARTED_AT + 6_000, { ended: true });
      run(store, "tier", STARTED_AT + 7_000, { checkpointId: "cp-slow" });
      run(store, "both", STARTED_AT + 8_000, { checkpointId: "cp-both" });
      run(store, "slow", STARTED_AT + 9_000, { testFiles: files("test/e2e/x.test.ts") });
      run(store, "fastcp", STARTED_AT + 9_500, { checkpointId: "cp-fast" });
      publishSlowActivity(store, alpha.id, {
        kind: "running",
        path: "test/e2e/x.test.ts",
        since: STARTED_AT + 9_000,
        lastDurationMs: null,
      });
    });
    const work = workOf(800);
    expect(work.tiers).toEqual([
      // The slow tier names the run it starts, so any other is the fast lane's.
      { runId: "edit", lane: "fast", files: 2, startedAt: STARTED_AT + 5_000, checkpointId: null },
      {
        runId: "tier",
        lane: "slow",
        files: 1,
        startedAt: STARTED_AT + 7_000,
        checkpointId: "cp-slow",
      },
      {
        runId: "both",
        lane: "fast",
        files: 1,
        startedAt: STARTED_AT + 8_000,
        checkpointId: "cp-both",
      },
      { runId: "slow", lane: "slow", files: 1, startedAt: STARTED_AT + 9_000, checkpointId: null },
      {
        runId: "fastcp",
        lane: "fast",
        files: 1,
        startedAt: STARTED_AT + 9_500,
        checkpointId: "cp-fast",
      },
    ]);
    expect(work.checkpoints).toEqual([
      { id: "cp-slow", startedAt: STARTED_AT + 1_000, lane: "slow", files: 3 },
      { id: "cp-both", startedAt: STARTED_AT + 4_000, lane: null, files: 2 },
      { id: "cp-fast", startedAt: STARTED_AT + 4_500, lane: "fast", files: 1 },
    ]);
    expect(work.slowWaiting).toBe(true);
  });

  test("consumers, with their harness process alive, gone, unknown or not recorded", () => {
    const harness = { pid: 900, ppid: 1, pgid: 900, comm: "claude", nice: 0, ageS: 3_000 };
    writeProcesses(host, [
      { ...harness, lifeCpuPct: 3, cmdline: ["claude"] },
      { ...harness, pid: 901, comm: "codex", lifeCpuPct: 3, cmdline: ["codex"] },
    ]);
    serve(800, alpha);
    const consumer = (sessionId: string) => ({ worktreeId: alpha.id, sessionId, agentId: "main" });
    writeStore(alpha, daemonRecord(alpha), (store) => {
      for (const s of ["alive", "reused", "elsewhere", "gone", "none"]) {
        store.consumers.register(consumer(s), STARTED_AT + 10_000);
      }
      const at = (pid: number, startTime: number, pidNamespace = PID_NAMESPACE) => ({
        pid,
        startTime,
        pidNamespace,
      });
      const ticks = startTicksOf({ ...harness, lifeCpuPct: 0, cmdline: [] });
      recordHarness(store, consumer("alive"), at(900, ticks));
      recordHarness(store, consumer("reused"), at(901, ticks - 100));
      recordHarness(store, consumer("elsewhere"), at(902, ticks, "pid:[4026532000]"));
      recordHarness(store, consumer("gone"), at(903, ticks));
      recordVersion(store, consumer("alive"), "0.1.235");
      store.meta.set(departedMetaKey(alpha.id), String(STARTED_AT + 20_000));
    });
    const work = workOf(800);
    const by = new Map(work.consumers.map((c) => [c.sessionId, c]));
    expect([...by.keys()].sort()).toEqual(["alive", "elsewhere", "gone", "none", "reused"]);
    expect(by.get("alive")).toMatchObject({ alive: true, version: "0.1.235", agentId: "main" });
    expect(by.get("alive")?.harness?.pid).toBe(900);
    expect(by.get("alive")?.lastSeenAt).toBe(STARTED_AT + 10_000);
    expect(by.get("reused")?.alive).toBe(false);
    expect(by.get("elsewhere")?.alive).toBeNull();
    expect(by.get("gone")?.alive).toBe(false);
    expect(by.get("none")).toMatchObject({ harness: null, alive: null, version: null });
    expect(work.departedAt).toBe(STARTED_AT + 20_000);
    expect(work.slowWaiting).toBe(false);
  });

  test("the settings of its own squeal.config.json, through the loader that never throws", () => {
    serve(800, alpha);
    serve(801, beta);
    writeLocks(host, [lockLine(1, 800, key(alpha.lockPath)), lockLine(2, 801, key(beta.lockPath))]);
    writeStore(alpha, daemonRecord(alpha));
    writeStore(beta, daemonRecord(beta));
    writeFileSync(
      join(alpha.root, "squeal.config.json"),
      JSON.stringify({ daemon: { idleExitMinutes: 15 }, runner: { timeoutMs: null } }),
    );
    writeFileSync(join(beta.root, "squeal.config.json"), "{ not json");
    // No limit (`null`) is a timeout no process outlives.
    expect(workOf(800).settings).toEqual({
      idleExitMinutes: 15,
      unusedExitMinutes: 30,
      timeoutMs: Number.POSITIVE_INFINITY,
    });
    expect(workOf(801).settings).toEqual({
      idleExitMinutes: 60,
      unusedExitMinutes: 30,
      timeoutMs: 600_000,
    });
  });
});

describe("phases' work", () => {
  test("stopping: no record, and the start time and token its row keeps bound its runs", () => {
    serve(800, alpha);
    writeStore(alpha, daemonRecord(alpha), (store) => {
      run(store, "before", STARTED_AT - HOUR);
      run(store, "mine", STARTED_AT + 1_000);
      store.worktrees.setDaemon(alpha.id, null);
    });
    const work = workOf(800);
    expect(work.record).toBeNull();
    expect(work.recordedStartedAt).toBe(STARTED_AT);
    expect(work.token).toBe(daemonRecord(alpha).token);
    expect(work.tiers.map((t) => t.runId)).toEqual(["mine"]);
    expect(phases().get(800)).toBe("stopping");
  });

  test("serving, and starting in a fresh worktree whose row its lock holder has not written", () => {
    serve(800, alpha);
    writeStore(alpha, daemonRecord(alpha));
    expect(phases().get(800)).toBe("serving");
    // Another worktree of the store: alpha's lock holder found no row of its own yet.
    rmSync(alpha.storePath);
    writeStore({ ...alpha, id: "0000000000000000" }, null);
    const work = workOf(800);
    expect([work.record, work.recordedStartedAt, work.token]).toEqual([null, null, null]);
    expect(phases().get(800)).toBe("starting");
  });

  test("a waiting daemon's row is the lock holder's: only the holder of a duplicate root is read", () => {
    serve(800, alpha);
    writeProcesses(host, [daemonProcess({ pid: 801, root: alpha.root })]);
    writeStore(alpha, daemonRecord(alpha));
    const result = read();
    expect([...result.work.keys()]).toEqual([800]);
    expect(result.unknown).toEqual([]);
  });

  test("where locks cannot be read (D10), the row is read for each daemon of its id", () => {
    writeProcesses(host, [daemonProcess({ pid: 810, root: alpha.root })]);
    writeStore(alpha, daemonRecord(alpha));
    expect(workOf(810, withoutLocks(source)).record).toEqual(daemonRecord(alpha));
  });
});

describe("stores of other schemas, and reading changes nothing", () => {
  const bytesAndTime = (path: string) => ({
    bytes: readFileSync(path).toString("base64"),
    mtimeMs: statSync(path).mtimeMs,
  });

  test("a store at an older user_version is not migrated, and unknown names its daemon", () => {
    serve(800, alpha);
    const db = new DatabaseSync(alpha.storePath);
    db.exec("PRAGMA user_version = 0");
    db.close();
    const before = bytesAndTime(alpha.storePath);
    const result = read();
    expect(result.work.has(800)).toBe(false);
    expect(result.unknown).toEqual([
      { what: "daemon 800 work", why: expect.stringContaining("schema 0") },
    ]);
    expect(bytesAndTime(alpha.storePath)).toEqual(before);
    const after = new DatabaseSync(alpha.storePath, { readOnly: true });
    expect(after.prepare("SELECT count(*) AS n FROM sqlite_master").get()?.n).toBe(0);
    after.close();
  });

  test("a store at a newer user_version is read as far as its tables are known", () => {
    serve(800, alpha);
    writeStore(alpha, daemonRecord(alpha), (store) => run(store, "r", STARTED_AT + 1));
    const db = new DatabaseSync(alpha.storePath);
    db.exec(
      "PRAGMA user_version = 99; ALTER TABLE runs ADD COLUMN lane TEXT; CREATE TABLE later (x INTEGER)",
    );
    db.close();
    const work = workOf(800);
    expect(work.record).toEqual(daemonRecord(alpha));
    expect(work.tiers.map((t) => t.runId)).toEqual(["r"]);
  });

  test("a missing store is named unknown", () => {
    serve(800, alpha);
    expect(read().unknown).toEqual([
      { what: "daemon 800 work", why: expect.stringContaining("cannot be read") },
    ]);
  });

  test("the store's bytes and mtime and its WAL's do not change under a live writer", () => {
    serve(800, alpha);
    writeStore(alpha, daemonRecord(alpha), (store) => run(store, "r", STARTED_AT + 1));
    // The daemon's own connection, with commits still in the WAL.
    const daemon = new DatabaseSync(alpha.storePath);
    try {
      daemon.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0");
      daemon
        .prepare("UPDATE worktrees SET daemon_heartbeat_at = ? WHERE id = ?")
        .run(STARTED_AT + 120_000, alpha.id);
      const wal = `${alpha.storePath}-wal`;
      const before = [bytesAndTime(alpha.storePath), bytesAndTime(wal)];
      const work = workOf(800);
      expect(work.record?.heartbeatAt).toBe(STARTED_AT + 120_000);
      expect([bytesAndTime(alpha.storePath), bytesAndTime(wal)]).toEqual(before);
    } finally {
      daemon.close();
    }
  });

  test("a WAL a killed daemon left is neither checkpointed nor removed", () => {
    serve(800, alpha);
    writeStore(alpha, daemonRecord(alpha));
    // A writer that exits without closing, as a SIGKILLed daemon does: its commit stays in the WAL.
    const writer = spawnSync(process.execPath, ["--input-type=module", "-e", KILLED_WRITER], {
      env: { STORE: alpha.storePath, AT: String(STARTED_AT + 120_000), ID: alpha.id },
    });
    expect(writer.status).toBe(0);
    const wal = `${alpha.storePath}-wal`;
    const before = [bytesAndTime(alpha.storePath), bytesAndTime(wal)];
    // As the last connection, a writable one would checkpoint the WAL into the store and remove it.
    expect(workOf(800).record?.heartbeatAt).toBe(STARTED_AT + 120_000);
    expect([bytesAndTime(alpha.storePath), bytesAndTime(wal)]).toEqual(before);
  });
});

const KILLED_WRITER = `
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.env.STORE);
db.exec("PRAGMA wal_autocheckpoint = 0");
db.prepare("UPDATE worktrees SET daemon_heartbeat_at = ? WHERE id = ?").run(Number(process.env.AT), process.env.ID);
process.exit(0);
`;

test("meta values of a format it does not know read as null, and unknown names each", () => {
  serve(800, alpha);
  const consumer = { worktreeId: alpha.id, sessionId: "s1", agentId: "main" };
  writeStore(alpha, daemonRecord(alpha), (store) => {
    store.consumers.register(consumer, STARTED_AT);
    store.meta.set(departedMetaKey(alpha.id), "soon");
    store.meta.set(worktreeMetaKey("slowTier", alpha.id), JSON.stringify({ kind: "dreaming" }));
    store.meta.set(worktreeMetaKey("harnessProcess", alpha.id), JSON.stringify({ "s1\nmain": 7 }));
    store.meta.set(worktreeMetaKey("consumerVersion", alpha.id), "[");
    // A lane map it cannot read leaves the lane of an open checkpoint unknown.
    store.checkpoints.start({
      id: "cp",
      worktreeId: alpha.id,
      revision: 1,
      kind: "run-all",
      testFiles: files("a"),
      startedAt: STARTED_AT + 1,
    });
    store.meta.set(worktreeMetaKey("checkpointLanes", alpha.id), "nope");
    // With the slow-tier row unreadable, the store cannot tell this run's lane.
    run(store, "edit", STARTED_AT + 2);
  });
  const { work, unknown } = read();
  expect(work.get(800)).toMatchObject({ departedAt: null, slowWaiting: null });
  expect(work.get(800)?.tiers.map((t) => [t.runId, t.lane])).toEqual([["edit", null]]);
  expect(work.get(800)?.checkpoints).toEqual([
    { id: "cp", startedAt: STARTED_AT + 1, lane: null, files: 1 },
  ]);
  expect(work.get(800)?.consumers).toEqual([
    {
      sessionId: "s1",
      agentId: "main",
      lastSeenAt: STARTED_AT,
      harness: null,
      alive: null,
      version: null,
    },
  ]);
  expect(unknown.map((u) => u.what).sort()).toEqual([
    "daemon 800 checkpoint lanes",
    "daemon 800 consumer s1 harness",
    "daemon 800 consumer versions",
    "daemon 800 departedAt",
    "daemon 800 slowWaiting",
  ]);
});
