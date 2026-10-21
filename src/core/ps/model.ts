import type {
  AbsolutePath,
  DaemonRecord,
  EpochMs,
  HarnessProcess,
  WorktreeId,
} from "../types/index.js";
import type {
  DaemonPhase,
  PsCheckpoint,
  PsFileFlag,
  PsFlag,
  PsHost,
  PsOrphan,
  PsPool,
  PsSnapshot,
  PsTier,
  PsUnknown,
} from "./shape.js";
import type { CpuTimes, HostReading, ProcessRow, ProcessTable, PsSource } from "./source.js";

/*
 * Spec 014 D11: the model the `squeal ps` stages pass, and each stage's
 * signature, so that the rows of waves 1 and 2 build on disjoint files.
 * It builds on the D8 shape (`shape.ts`), which never imports from here.
 */

/** Where `ps` looks. The command fills it from its environment; tests point it at temp directories. */
export interface PsPlaces {
  readonly uid: number;
  /** The plugin caches and `installed_plugins.json` lie under it (D2, D7). */
  readonly home: AbsolutePath;
  /** `$XDG_RUNTIME_DIR`; `null` when unset. Sockets and the pool lie in it. */
  readonly runtimeDir: AbsolutePath | null;
  /** `/tmp`: `squeal-<uid>` (sockets, pool, temp keys) and other `squeal-*` directories lie in it (D7). */
  readonly tempDir: AbsolutePath;
  /** The current repository's common dir; `null` outside one (D1). */
  readonly commonDir: AbsolutePath | null;
}

/** D2: one daemon process, found by its command line. */
export interface FoundDaemon {
  /** Its row at the first sample: the pid and start ticks are its identity. */
  readonly row: ProcessRow;
  /** The Squeal script in its arguments, inside the bundle `install-gone` checks. */
  readonly script: AbsolutePath;
  /** The root its arguments name; `null` when relative, since it moved its working directory. */
  readonly root: AbsolutePath | null;
  /** `--await-lock` in its arguments: `no-lock` waits 130 s, not 40 s (D7). */
  readonly awaitLock: boolean;
  /** From the script path; `null` for a checkout's `dist`, where the store row's stands in. */
  readonly version: string | null;
  readonly harness: string | null;
  readonly worktreeId: WorktreeId | null;
  /** The lock file it holds open, or else the hash of its root (`worktreeIdFor`). */
  readonly idFrom: "lock-fd" | "root-hash" | null;
  /** `<common-dir>/squeal/locks/<id>.sqlite`. */
  readonly lockPath: AbsolutePath | null;
  readonly commonDir: AbsolutePath | null;
  readonly storePath: AbsolutePath | null;
  /** Whether `/proc/locks` shows it holding its lock; `null` without locks (D10). */
  readonly holdsLock: boolean | null;
}

/** D2 step 4: a `squeal-<id>.sock` file. */
export interface SocketFile {
  readonly path: AbsolutePath;
  readonly worktreeId: WorktreeId;
  readonly mtimeMs: EpochMs;
  /** The live daemon of its id that holds its lock; `null` when none does. */
  readonly daemonPid: number | null;
  /** Whether `ss -xle` shows a listener at it; `null` without `ss`. */
  readonly listening: boolean | null;
}

export interface Discovery {
  readonly daemons: readonly FoundDaemon[];
  readonly sockets: readonly SocketFile[];
  readonly unknown: readonly PsUnknown[];
}

/** D3: what a daemon's store says of it, read once through a read-only connection. */
export interface DaemonWork {
  /** Its row's daemon record; `null` when the row names none (`stopping` with the lock held, D2). */
  readonly record: DaemonRecord | null;
  /** Its `daemonToken` meta row (`WORKTREE_META_ROWS`): what its test processes' marks start with (D5). */
  readonly token: string | null;
  readonly pending: number | null;
  readonly running: number | null;
  readonly tiers: readonly PsTier[];
  readonly checkpoints: readonly PsCheckpoint[];
  readonly consumers: readonly ConsumerState[];
  readonly departedAt: EpochMs | null;
  /** Its `slowTier` meta row: slow work waits; `null` when it cannot be read. */
  readonly slowWaiting: boolean | null;
  /** D9; `null` for a release that does not record it. */
  readonly lastUse: { readonly usedAt: EpochMs; readonly activeAt: EpochMs } | null;
  /** From its own `squeal.config.json`, through the loader that never throws (011 C10). */
  readonly settings: DaemonSettings;
}

export interface DaemonSettings {
  readonly idleExitMinutes: number;
  readonly unusedExitMinutes: number;
  readonly timeoutMs: number;
}

export interface ConsumerState {
  readonly sessionId: string;
  readonly agentId: string;
  readonly lastSeenAt: EpochMs;
  /** Its `harnessProcess` meta row; `null` when none was recorded. */
  readonly harness: HarnessProcess | null;
  /** By the process table and the PID namespace; `null` when unknown. */
  readonly alive: boolean | null;
  /** Its `consumerVersion` meta row. */
  readonly version: string | null;
}

/** D4: one read of the window's two. */
export interface Sample {
  /** A monotonic clock's ms (`performance.now()`): the window is the difference. */
  readonly atMs: number;
  readonly table: ProcessTable;
  readonly cpuTime: CpuTimes | null;
}

export interface ProcessCost {
  /** Over the window; `null` when the process was in one sample only. */
  readonly cpuPct: number | null;
  /** Cumulative, at its last sample. */
  readonly cpuMs: number;
  readonly privateBytes: number | null;
  readonly swapBytes: number | null;
}

/** D5: what ties processes to a daemon. */
export interface ProcessOwner {
  readonly pid: number;
  /** `null` when unread: then only ancestry ties a process to it. */
  readonly token: string | null;
  readonly tiers: readonly PsTier[];
}

export interface TestProcessModel {
  readonly pid: number;
  readonly daemonPid: number;
  readonly escaped: boolean;
  readonly lane: string | null;
  readonly runId: string | null;
  readonly runner: string | null;
  readonly files: readonly string[] | null;
  /** Its descendants without a mark (D5). */
  readonly descendants: readonly number[];
}

export interface Attribution {
  readonly processes: readonly TestProcessModel[];
  /** Processes with a mark no live daemon's token owns: `orphan-test-process` on two samples (D7). */
  readonly unowned: readonly { readonly pid: number; readonly mark: string }[];
}

/** D6: the pool's permits by holder. */
export interface PoolReading {
  readonly pool: PsPool;
  /** Permits by daemon pid. */
  readonly permits: ReadonlyMap<number, number>;
  /** Holders that are no daemon (`foreign-permit`), with the permit file. */
  readonly foreign: readonly { readonly pid: number; readonly path: AbsolutePath }[];
}

/** What one end of the window read; D7 confirms `hung` and `orphan-test-process` on both. */
export interface PsReading {
  readonly sample: Sample;
  readonly work: ReadonlyMap<number, DaemonWork>;
  readonly attribution: Attribution;
}

export interface PsModel {
  readonly now: EpochMs;
  readonly places: PsPlaces;
  readonly source: PsSource;
  readonly discovery: Discovery;
  readonly first: PsReading;
  readonly second: PsReading;
  readonly pool: PoolReading;
}

/** D7: the flags and information states, by what they are on. */
export interface FlagFindings {
  readonly daemons: ReadonlyMap<number, readonly PsFlag[]>;
  /** An information state that replaces a daemon's phase as its state word. */
  readonly states: ReadonlyMap<number, string>;
  readonly processes: ReadonlyMap<number, readonly PsFlag[]>;
  readonly orphans: readonly PsOrphan[];
  readonly files: readonly PsFileFlag[];
  /** Every leftover path, for `--leftovers`. */
  readonly leftovers: readonly AbsolutePath[];
  readonly unknown: readonly PsUnknown[];
}

// The stages (D11). Each module exports one function of its type.

/** `discover.ts` (014-06). */
export type Discover = (source: PsSource, table: ProcessTable, places: PsPlaces) => Discovery;
/** `work.ts` (014-06): one read-only `node:sqlite` connection per store, never `openStore`. */
export type ReadWork = (
  source: PsSource,
  table: ProcessTable,
  daemons: readonly FoundDaemon[],
) => { readonly work: ReadonlyMap<number, DaemonWork>; readonly unknown: readonly PsUnknown[] };
/** D2's phase table (014-06). */
export type PhaseOf = (daemon: FoundDaemon, work: DaemonWork | null) => DaemonPhase;
/** `measure.ts` (014-07). */
export type TakeSample = (source: PsSource, pids?: readonly number[]) => Sample;
export type Measure = (
  source: PsSource,
  first: Sample,
  second: Sample,
  pids: readonly number[],
) => ReadonlyMap<number, ProcessCost>;
/** `processes.ts` (014-07). */
export type Attribute = (
  source: PsSource,
  table: ProcessTable,
  owners: readonly ProcessOwner[],
) => Attribution;
/** `host.ts` (014-07). */
export type HostTotals = (first: HostReading, second: HostReading) => PsHost;
export type ReadPool = (
  source: PsSource,
  places: PsPlaces,
  daemons: ReadonlySet<number>,
) => PoolReading;
/** `flags.ts` (014-10). */
export type Flag = (model: PsModel) => FlagFindings;
/** `render.ts` (014-11): the D8 text from the shape alone. */
export type Render = (snapshot: PsSnapshot, options: { readonly full: boolean }) => string;
