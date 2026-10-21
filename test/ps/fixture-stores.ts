import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import type { PsPlaces } from "../../src/core/ps/model.js";
import type { PsSource } from "../../src/core/ps/source.js";
import {
  isStoreOpenFailure,
  lockFileFor,
  openStore,
  storePaths,
} from "../../src/core/store/index.js";
import type { DaemonRecord, Store } from "../../src/core/types/index.js";
import {
  BOOT_SECONDS,
  type FixtureProcess,
  UPTIME_SECONDS,
  writeHost,
  writeProcess,
} from "./fixture.js";

/*
 * Fixture hosts for discovery and work (spec 014 D2, D3; task 014-06): real
 * repositories under a temp directory, each with its lock file and a store
 * written through Squeal's own writers, and a fixture `/proc` tree whose
 * daemons point at them. `/proc/locks` names the real lock files by the key
 * `fileKey` gives, so the held-lock join runs as it does on a host.
 */

export const HOME = "/home/user";
export const NODE = `${HOME}/.nvm/versions/node/v24.21.0/bin/node`;
export const PID_NAMESPACE = "pid:[4026531836]";
/** How long the fixture daemons have run. */
export const DAEMON_AGE_S = 600;
/** When they registered: 5 s after their process start, as a daemon does (D2). */
export const STARTED_AT = (BOOT_SECONDS + UPTIME_SECONDS - DAEMON_AGE_S + 5) * 1000;
export const HEARTBEAT_MS = 5_000;

export interface FixtureRepo {
  readonly root: string;
  readonly commonDir: string;
  readonly id: string;
  readonly lockPath: string;
  readonly storePath: string;
}

export interface FixtureHost {
  /** The temp directory; `proc` and the repositories lie under it. */
  readonly base: string;
  readonly places: PsPlaces;
}

/** A temp directory with the host files of `fixture.ts` and a runtime and a temp directory. */
export function makeHost(): FixtureHost {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "squeal-ps-host-")));
  writeHost(base);
  const places = placesUnder(base);
  mkdirSync(places.runtimeDir ?? "");
  mkdirSync(join(places.tempDir, `squeal-${places.uid}`), { recursive: true });
  return { base, places };
}

/** Every `PsPlaces` of these tests: this user's, under `base`. */
export function placesUnder(base: string): PsPlaces {
  return {
    uid: process.getuid?.() ?? 1000,
    home: join(base, "home"),
    runtimeDir: join(base, "run"),
    tempDir: join(base, "tmp"),
    commonDir: null,
  };
}

/** A main worktree at `<base>/<name>`, with its `.git/squeal/locks/<id>.sqlite`. */
export function makeRepo(base: string, name: string): FixtureRepo {
  const root = join(base, name);
  mkdirSync(join(root, ".git", "squeal", "locks"), { recursive: true });
  const commonDir = join(root, ".git");
  const id = worktreeIdFor(root);
  const lockPath = lockFileFor(commonDir, id);
  writeFileSync(lockPath, "");
  return { root, commonDir, id, lockPath, storePath: storePaths(commonDir).database };
}

export interface DaemonOptions {
  readonly pid: number;
  /** The root argument; a repository's root but in the relative-root case. */
  readonly root: string;
  /** The lock file it has open; none for a waiter between its tries. */
  readonly lockPath?: string;
  readonly script?: string;
  readonly awaitLock?: boolean;
  readonly comm?: string;
  readonly ageS?: number;
}

export const cacheScript = (harness: "claude" | "codex", version: string): string =>
  `${HOME}/.${harness}/plugins/cache/hearsay/squeal/${version}/dist/cli/squeal.mjs`;

/** A daemon process as `ensureDaemon` spawns it: `node <cli> daemon <root> [--await-lock <ms>]`. */
export function daemonProcess(o: DaemonOptions): FixtureProcess {
  return {
    pid: o.pid,
    ppid: 1049,
    pgid: o.pid,
    comm: o.comm ?? "MainThread",
    nice: 0,
    ageS: o.ageS ?? DAEMON_AGE_S,
    lifeCpuPct: 2,
    cmdline: [
      NODE,
      o.script ?? cacheScript("claude", "0.1.235"),
      "daemon",
      o.root,
      ...(o.awaitLock === true ? ["--await-lock", "130000"] : []),
    ],
    memoryKb: { anon: 100_000, shmem: 0, swap: 0 },
    fds: o.lockPath === undefined ? { 0: "/dev/null" } : { 0: "/dev/null", 3: o.lockPath },
  };
}

export function writeProcesses(host: FixtureHost, processes: readonly FixtureProcess[]): void {
  for (const p of processes) writeProcess(host.base, p);
}

/** `/proc/locks` lines: a held `POSIX WRITE` lock, or one waiting behind it (`->`). */
export function lockLine(n: number, pid: number, key: string, blocked = false): string {
  return `${n}: ${blocked ? "-> " : ""}POSIX  ADVISORY  WRITE ${pid} ${key} 0 EOF`;
}

export function writeLocks(host: FixtureHost, lines: readonly string[]): void {
  writeFileSync(join(host.base, "proc", "locks"), `${lines.join("\n")}\n`);
}

/** The daemon record of a fixture daemon, as it registers. */
export function daemonRecord(
  repo: FixtureRepo,
  overrides: Partial<DaemonRecord> = {},
): DaemonRecord {
  return {
    socketPath: join("/run/user/1000", `squeal-${repo.id}.sock`),
    startedAt: STARTED_AT,
    heartbeatAt: STARTED_AT + 60_000,
    heartbeatIntervalMs: HEARTBEAT_MS,
    squealVersion: "0.1.235",
    token: "81287f79-65c7-4cd3-b2cb-547bba728456",
    ...overrides,
  };
}

/**
 * Writes `repo`'s store through `openStore` and the repositories, as a
 * daemon and its hooks would, and closes it: its worktree row with `daemon`
 * (`null`: none recorded), then `fill`.
 */
export function writeStore(
  repo: FixtureRepo,
  daemon: DaemonRecord | null,
  fill: (store: Store) => void = () => {},
): void {
  const store = openStore(repo.commonDir);
  if (isStoreOpenFailure(store)) throw new Error(`fixture store: ${JSON.stringify(store)}`);
  try {
    store.transaction(() => {
      store.worktrees.upsert({
        id: repo.id,
        root: repo.root,
        commonDir: repo.commonDir,
        isMain: true,
        registeredAt: STARTED_AT - 86_400_000,
        daemon,
      });
      fill(store);
    });
  } finally {
    store.close();
  }
}

/** `source` as a platform without fds, locks or `ss` sees it (D10): the rest is read through. */
export function withoutLocks(source: PsSource): PsSource {
  return {
    platform: source.platform,
    memoryKind: source.memoryKind,
    readsMarks: source.readsMarks,
    clockTicks: () => source.clockTicks(),
    bootTime: () => source.bootTime(),
    processTable: (pids) => source.processTable(pids),
    cmdline: (pid) => source.cmdline(pid),
    markOf: (pid) => source.markOf(pid),
    memory: (pid) => source.memory(pid),
    fds: () => null,
    cwds: (pids) => source.cwds(pids),
    locks: () => null,
    fileKey: () => null,
    unixListeners: () => null,
    pidNamespace: () => source.pidNamespace(),
    host: () => source.host(),
  };
}
