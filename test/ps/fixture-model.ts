import { mkdirSync, mkdtempSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
  Attribution,
  ConsumerState,
  DaemonWork,
  FoundDaemon,
  LocksRead,
  PoolReading,
  PsModel,
  PsPlaces,
  SocketFile,
} from "../../src/core/ps/model.js";
import type { LockEntry, ProcessRow, ProcessTable, PsSource } from "../../src/core/ps/source.js";
import type { DaemonRecord } from "../../src/core/types/index.js";
import { BOOT_SECONDS, CLOCK_TICKS, UPTIME_SECONDS } from "./fixture.js";

/*
 * Models for the flags (spec 014 D7, task 014-10): a `PsModel` held in
 * memory, as the snapshot assembles it from the stages, over a temp
 * directory that holds the files the flags read: roots, bundles, plugin
 * caches, sockets, pool marks and temp directories. Every process row is
 * this user's, so the uid rules see what a host's own processes give.
 */

export const BOOT_MS = BOOT_SECONDS * 1000;
/** The snapshot's clock: the fixture host's uptime after boot. */
export const NOW = (BOOT_SECONDS + UPTIME_SECONDS) * 1000;
export const UID = process.getuid?.() ?? 1000;
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

/** When a process `ageS` old started, as `startTicks`. */
export const ticksAt = (ageS: number): number => (UPTIME_SECONDS - ageS) * CLOCK_TICKS;
/** When a process `ageS` old started, in epoch ms. */
export const startedAt = (ageS: number): number => NOW - ageS * 1000;

export interface ModelHost {
  readonly base: string;
  readonly places: PsPlaces;
  /** `<tempDir>/squeal-<uid>`: sockets without a runtime dir, the pool, the temp keys. */
  readonly userDir: string;
}

export function modelHost(): ModelHost {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "squeal-flags-")));
  const places: PsPlaces = {
    uid: UID,
    home: join(base, "home"),
    userConfig: join(base, "home", ".config", "squeal", "config.json"),
    runtimeDir: join(base, "run"),
    tempDir: join(base, "tmp"),
    commonDir: null,
  };
  const userDir = join(places.tempDir, `squeal-${UID}`);
  mkdirSync(join(places.runtimeDir ?? "", "squeal"), { recursive: true });
  mkdirSync(join(userDir, "tmp"), { recursive: true });
  return { base, places, userDir };
}

/** A file at `path`, its directories made, its mtime `ageMs` before `NOW`. */
export function writeAged(path: string, ageMs = 0, body = ""): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  return age(path, ageMs);
}

/** A directory at `path` with one file of `bytes`, its mtime `ageMs` before `NOW`. */
export function dirAged(path: string, ageMs: number, bytes = 10): string {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "file"), "x".repeat(bytes));
  return age(path, ageMs);
}

function age(path: string, ageMs: number): string {
  const at = new Date(NOW - ageMs);
  utimesSync(path, at, at);
  return path;
}

/** A worktree root with a `.git` directory, and its common dir. */
export function makeRoot(host: ModelHost, name: string): { root: string; commonDir: string } {
  const root = join(host.base, name);
  mkdirSync(join(root, ".git", "squeal", "locks"), { recursive: true });
  return { root, commonDir: join(root, ".git") };
}

/** A daemon script inside a plugin cache under `home`, written so its bundle exists. */
export function installScript(home: string, harness: "claude" | "codex", version: string): string {
  const script = join(home, `.${harness}`, "plugins", "cache", "hearsay", "squeal", version);
  return writeAged(join(script, "dist", "cli", "squeal.mjs"));
}

/** Claude Code's `installed_plugins.json` naming `version` at user scope. */
export function claudeInstalled(home: string, version: string): void {
  const plugins = { "squeal@hearsay": [{ scope: "user", version }] };
  writeAged(
    join(home, ".claude", "plugins", "installed_plugins.json"),
    0,
    JSON.stringify({ version: 2, plugins }),
  );
}

export interface ProcessSpec {
  readonly pid: number;
  readonly ppid?: number;
  readonly comm?: string;
  readonly ageS?: number;
  readonly uid?: number | null;
  readonly cmdline?: readonly string[];
  readonly mark?: string;
  readonly cwd?: string;
}

export function rowOf(p: ProcessSpec): ProcessRow {
  return {
    pid: p.pid,
    ppid: p.ppid ?? 1,
    pgid: p.pid,
    comm: p.comm ?? "node",
    state: "S",
    startTicks: ticksAt(p.ageS ?? 600),
    cpuTicks: 0,
    childTicks: 0,
    nice: 0,
    uid: p.uid === undefined ? UID : p.uid,
  };
}

export interface DaemonSpec {
  readonly pid: number;
  readonly root: string | null;
  readonly commonDir?: string | null;
  readonly script?: string;
  readonly ageS?: number;
  readonly holdsLock?: boolean | null;
  readonly awaitLock?: boolean;
  readonly worktreeId?: string;
}

/** A daemon as `discover` finds it: from a cache by default, holding its lock. */
export function foundDaemon(s: DaemonSpec): FoundDaemon {
  const script =
    s.script ?? "/nowhere/.claude/plugins/cache/hearsay/squeal/0.1.235/dist/cli/squeal.mjs";
  const cache = /\/\.(claude|codex)\/plugins\/cache\/[^/]+\/squeal\/([^/]+)\//.exec(script);
  const commonDir =
    s.commonDir === undefined ? (s.root === null ? null : join(s.root, ".git")) : s.commonDir;
  const worktreeId = s.worktreeId ?? `${String(s.pid).padStart(16, "0")}`;
  return {
    row: rowOf({ pid: s.pid, ppid: 1049, comm: "MainThread", ageS: s.ageS ?? 600 }),
    script,
    root: s.root,
    awaitLock: s.awaitLock ?? false,
    version: cache?.[2] ?? null,
    harness: cache?.[1] ?? null,
    worktreeId,
    idFrom: "lock-fd",
    lockPath:
      commonDir === null ? null : join(commonDir, "squeal", "locks", `${worktreeId}.sqlite`),
    commonDir,
    storePath: commonDir === null ? null : join(commonDir, "squeal", "squeal.sqlite"),
    holdsLock: s.holdsLock === undefined ? true : s.holdsLock,
  };
}

/** A serving daemon's work: registered 5 s after its start, beating, used a minute ago. */
export function workOf(
  daemon: FoundDaemon,
  over: Partial<DaemonWork> & { readonly recordOver?: Partial<DaemonRecord> } = {},
): DaemonWork {
  const start = BOOT_MS + daemon.row.startTicks * (1000 / CLOCK_TICKS);
  const { recordOver, ...rest } = over;
  const record: DaemonRecord = {
    socketPath: `/run/user/${UID}/squeal-${daemon.worktreeId}.sock`,
    startedAt: start + 5_000,
    heartbeatAt: NOW - 1_000,
    heartbeatIntervalMs: 5_000,
    squealVersion: daemon.version ?? "0.1.235",
    token: `token-${daemon.row.pid}`,
    ...recordOver,
  };
  return {
    record,
    recordedStartedAt: record.startedAt,
    token: record.token ?? null,
    pending: 0,
    running: 0,
    tiers: [],
    checkpoints: [],
    consumers: [],
    departedAt: null,
    slowWaiting: false,
    lastUse: { usedAt: NOW - MINUTE, activeAt: NOW - MINUTE },
    settings: { idleExitMinutes: 60, unusedExitMinutes: 30, timeoutMs: 600_000 },
    ...rest,
  };
}

export function consumer(over: Partial<ConsumerState> = {}): ConsumerState {
  return {
    sessionId: "s1",
    agentId: "main",
    lastSeenAt: NOW - MINUTE,
    harness: { pid: 3212240, startTime: ticksAt(3_000), pidNamespace: "pid:[1]" },
    alive: true,
    version: "0.1.235",
    ...over,
  };
}

export interface ModelSpec {
  readonly host: ModelHost;
  /** Each daemon with its work at the first and the second reading (`second` defaults to `first`). */
  readonly daemons?: readonly {
    readonly daemon: FoundDaemon;
    readonly first?: DaemonWork | null;
    readonly second?: DaemonWork | null;
  }[];
  /** Processes besides the daemons, in both readings unless `gone` names them in the second. */
  readonly processes?: readonly ProcessSpec[];
  readonly goneBySecond?: readonly number[];
  readonly sockets?: readonly SocketFile[];
  readonly attribution?: Attribution;
  readonly secondAttribution?: Attribution;
  readonly pool?: Partial<PoolReading>;
  /** `null`: a platform without locks (D10). */
  readonly locks?: readonly LockEntry[] | null;
  /** The window's `/proc/locks` readings that were read: `none` with `locks: null`, else `both`. */
  readonly locksRead?: LocksRead;
  readonly readsMarks?: boolean;
  /** `null`: a platform that cannot read working directories. */
  readonly cwds?: boolean;
  readonly bootTime?: number | null;
  readonly windowMs?: number;
}

const NONE: Attribution = { processes: [], unowned: [] };

export function modelOf(spec: ModelSpec): PsModel {
  const daemons = spec.daemons ?? [];
  const processes = spec.processes ?? [];
  const firstTable: ProcessTable = new Map([
    ...daemons.map((d) => [d.daemon.row.pid, d.daemon.row] as const),
    ...processes.map((p) => [p.pid, rowOf(p)] as const),
  ]);
  const gone = new Set(spec.goneBySecond ?? []);
  const secondTable: ProcessTable = new Map([...firstTable].filter(([pid]) => !gone.has(pid)));
  const work = (which: "first" | "second") =>
    new Map(
      daemons.flatMap(({ daemon, first, second }) => {
        const w = which === "first" ? first : second === undefined ? first : second;
        return w === undefined || w === null ? [] : [[daemon.row.pid, w] as const];
      }),
    );
  const source = sourceOf(spec, processes, secondTable);
  const attribution = spec.attribution ?? NONE;
  const locksRead = spec.locksRead ?? (spec.locks === null ? "none" : "both");
  return {
    now: NOW,
    places: spec.host.places,
    source,
    locksRead,
    discovery: { daemons: daemons.map((d) => d.daemon), sockets: spec.sockets ?? [], unknown: [] },
    first: {
      sample: { atMs: 0, table: firstTable, cpuTime: null },
      work: work("first"),
      attribution,
    },
    second: {
      sample: { atMs: spec.windowMs ?? 2_000, table: secondTable, cpuTime: null },
      work: work("second"),
      attribution: spec.secondAttribution ?? attribution,
    },
    pool: {
      pool: { slots: 12, held: locksRead === "both" ? 0 : null },
      permits: new Map(),
      foreign: [],
      ...spec.pool,
    },
  };
}

function sourceOf(
  spec: ModelSpec,
  processes: readonly ProcessSpec[],
  table: ProcessTable,
): PsSource {
  const byPid = new Map(processes.map((p) => [p.pid, p]));
  const readsMarks = spec.readsMarks ?? true;
  const locks = spec.locks === undefined ? [] : spec.locks;
  return {
    platform: readsMarks ? "linux" : "darwin",
    memoryKind: readsMarks ? "private" : "rss",
    readsMarks,
    clockTicks: () => CLOCK_TICKS,
    bootTime: () => (spec.bootTime === undefined ? BOOT_MS : spec.bootTime),
    processTable: () => table,
    cmdline: (pid) => byPid.get(pid)?.cmdline ?? null,
    markOf: (pid) => (readsMarks ? (byPid.get(pid)?.mark ?? null) : null),
    memory: () => null,
    fds: () => null,
    cwds: (pids) => {
      if (spec.cwds === false) return null;
      const cwds = new Map<number, string>();
      for (const pid of pids) {
        const cwd = byPid.get(pid)?.cwd;
        if (cwd !== undefined) cwds.set(pid, cwd);
      }
      return cwds;
    },
    locks: () => locks,
    fileKey: () => null,
    unixListeners: () => null,
    unixSockets: () => [],
    pidNamespace: () => "pid:[1]",
    host: () => {
      throw new Error("the flags read no host totals");
    },
  };
}
