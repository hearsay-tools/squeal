import type {
  AbsolutePath,
  DaemonRecord,
  EpochMs,
  HarnessProcess,
  WorktreeId,
} from "../types/index.js";
import type {
  CpuTimes,
  HostReading,
  MemoryKind,
  ProcessRow,
  ProcessTable,
  PsPlatform,
  PsSource,
} from "./source.js";

/*
 * Spec 014 D8: the versioned shape `squeal ps --json` prints, the model the
 * D11 stages pass to build it, and each stage's signature, so that the rows
 * of waves 1 and 2 build on disjoint files. `render.ts` is a layer on top of
 * the shape. A value `ps` could not read is `null` and `unknown` names it;
 * it never reads as zero (vision, principle 2). Sizes are bytes, CPU is in
 * percent of one CPU, shares are percents, times are epoch ms. Changes are
 * additive; a change of meaning raises `v`.
 */

export const PS_SHAPE_VERSION = 1;

// The shape (D8).

export interface PsSnapshot {
  readonly v: typeof PS_SHAPE_VERSION;
  /** When the first sample was taken. */
  readonly at: EpochMs;
  /** The CPU window, from the first sample to the second (D4). */
  readonly sampleMs: number;
  readonly platform: PsPlatform;
  /** What each `privateBytes` holds; with `rss` (macOS), sums count shared pages more than once (D10). */
  readonly memory: MemoryKind;
  readonly host: PsHost;
  readonly squeal: PsSqueal;
  /** The current repository first, the others by CPU over the sample (D1). */
  readonly repositories: readonly PsRepository[];
  /** Flagged processes no live daemon owns: `orphan-test-process`, `orphan-waiter`, `foreign-permit` (D7). */
  readonly orphans: readonly PsOrphan[];
  readonly files: readonly PsFileFlag[];
  /** Every flag of the snapshot: on daemons, processes, orphans and files. */
  readonly flags: number;
  readonly unknown: readonly PsUnknown[];
}

export interface PsHost {
  readonly load: readonly [number, number, number] | null;
  readonly cpus: number;
  readonly cpuPressure: number | null;
  readonly memoryPressure: { readonly some: number; readonly full: number } | null;
  readonly memTotal: number | null;
  readonly memAvailable: number | null;
  readonly swapTotal: number | null;
  readonly swapUsed: number | null;
  /** The host's busy CPU over the sample, in percent of all its CPUs (`/proc/stat`). */
  readonly busyCpuPct: number | null;
}

export interface PsSqueal {
  readonly daemons: number;
  readonly testProcesses: number;
  /** Every daemon and test process with its descendants, over the sample. */
  readonly cpuPct: number | null;
  /** `cpuPct` over the host's busy CPU in the same window (D6). */
  readonly cpuShare: number | null;
  readonly privateBytes: number | null;
  /** `privateBytes` over `memTotal - memAvailable` (D6). Swap is stated apart. */
  readonly memoryShare: number | null;
  readonly swapBytes: number | null;
  readonly pool: PsPool;
}

export interface PsPool {
  /** The host's slots (011 C10). */
  readonly slots: number;
  /** Permits held: the `/proc/locks` holders of `pool.<i>.lock` and `slow*.lock` (D6). */
  readonly held: number | null;
}

export interface PsRepository {
  /** The git common dir; `null` for daemons whose repository could not be read. */
  readonly commonDir: AbsolutePath | null;
  readonly current: boolean;
  readonly daemons: readonly PsDaemon[];
}

/** D2: what the held lock and the store row say; `unknown` without locks (D10). */
export type DaemonPhase = "serving" | "waiting" | "stopping" | "unknown";

export interface PsDaemon {
  readonly pid: number;
  readonly phase: DaemonPhase;
  /** The STATE column: the phase, or an information state (`draining 22m left`, `older (session <pid> holds it)`, D7). */
  readonly state: string;
  readonly worktreeId: WorktreeId | null;
  readonly root: AbsolutePath | null;
  readonly version: string | null;
  /** The harness whose install it runs from: `claude`, `codex`; `null` for a checkout's `dist`. */
  readonly harness: string | null;
  readonly startedAt: EpochMs | null;
  readonly cpuPct: number | null;
  readonly cpuMs: number | null;
  readonly privateBytes: number | null;
  readonly swapBytes: number | null;
  /** Pool permits it holds (D6). */
  readonly permits: number | null;
  readonly work: PsWork;
  readonly consumers: readonly PsConsumer[];
  readonly processes: readonly PsTestProcess[];
  readonly flags: readonly PsFlag[];
}

export interface PsWork {
  /** `test_file_keys` that are `queued` (D3). */
  readonly pending: number | null;
  /** `test_file_keys` that are `running`. */
  readonly running: number | null;
  /** Its open runs since it started (D3), oldest first; empty when none is. */
  readonly tier: readonly PsTier[];
  readonly checkpoint: PsCheckpoint | null;
  readonly departedAt: EpochMs | null;
  /** While `draining`: the time until `daemon.idleExitMinutes` after the departure. */
  readonly drainLeftMs: number | null;
  /** D9: the last use the daemon records with its heartbeat; `null` for a release that does not. */
  readonly lastUsedAt: EpochMs | null;
}

/** One open run: `runs` with `end_state IS NULL AND started_at >= daemon_started_at` (D3). */
export interface PsTier {
  readonly runId: string;
  /** `null` where the store names none (an edit's tier). */
  readonly lane: string | null;
  readonly files: number;
  readonly startedAt: EpochMs;
  readonly checkpointId: string | null;
}

/** The open checkpoint since it started (D3). */
export interface PsCheckpoint {
  readonly id: string;
  readonly startedAt: EpochMs;
  /** `fast` or `slow` for a one-lane checkpoint; `null` for both. */
  readonly lane: string | null;
  readonly files: number;
}

export interface PsConsumer {
  readonly harnessPid: number | null;
  /** By its stat and start time; `null` when none was recorded or it is in another PID namespace. */
  readonly alive: boolean | null;
  readonly version: string | null;
}

export interface PsTestProcess {
  readonly pid: number;
  readonly lane: string | null;
  /** `vitest`, `node-test`, `pytest`; `null` when its command line names none. */
  readonly runner: string | null;
  /** The open run it serves, from its mark's `#<runId>` or its lane's one open run. */
  readonly runId: string | null;
  /** The test files its command line names; `null` for a Vitest worker, whose files are its tier's (D5). */
  readonly files: readonly string[] | null;
  /** Tied to its daemon by its mark's token alone, not by ancestry (D5). */
  readonly escaped: boolean;
  readonly cpuPct: number | null;
  readonly cpuMs: number | null;
  readonly privateBytes: number | null;
  readonly swapBytes: number | null;
  readonly nice: number;
  readonly startedAt: EpochMs | null;
  readonly descendants: PsDescendants;
  readonly flags: readonly PsFlag[];
}

/** Its descendants without a mark, summed (D5). */
export interface PsDescendants {
  readonly count: number;
  readonly cpuPct: number | null;
  readonly cpuMs: number | null;
  readonly privateBytes: number | null;
  readonly swapBytes: number | null;
  /** Each one with `--full`; `null` without it. */
  readonly list: readonly PsDescendant[] | null;
}

export interface PsDescendant {
  readonly pid: number;
  readonly comm: string;
  readonly cpuPct: number | null;
  readonly cpuMs: number | null;
  readonly privateBytes: number | null;
  readonly swapBytes: number | null;
}

/** The 18 flags of D7. */
export type PsFlagName =
  | "root-gone"
  | "install-gone"
  | "older"
  | "duplicate"
  | "no-lock"
  | "hung"
  | "past-departure"
  | "past-idle"
  | "past-unused"
  | "dead-consumer"
  | "not-installed"
  | "orphan-test-process"
  | "overdue-test-process"
  | "orphan-waiter"
  | "stale-socket"
  | "stale-pool-mark"
  | "foreign-permit"
  | "leftover-temp";

export interface PsFlag {
  readonly flag: PsFlagName;
  readonly reason: string;
  /** The command that would end it, its paths quoted for the shell; `null` for `dead-consumer`. */
  readonly command: string | null;
}

export interface PsOrphan {
  readonly pid: number;
  readonly comm: string;
  readonly startedAt: EpochMs | null;
  readonly flags: readonly PsFlag[];
}

export interface PsFileFlag {
  readonly flag: "stale-socket" | "stale-pool-mark" | "leftover-temp";
  /** `null` for a group (`leftover-temp`), whose paths `--leftovers` prints. */
  readonly path: AbsolutePath | null;
  readonly count: number;
  readonly bytes: number | null;
  readonly command: string;
}

/** A value `ps` could not read, or a rule it did not evaluate, and why (D8, D9, D10). */
export interface PsUnknown {
  /** `daemon 3704612 lastUsedAt`, `flag hung`, `host cpuPressure`, ... */
  readonly what: string;
  readonly why: string;
}

// The model the stages pass (D11).

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
  readonly tier: readonly PsTier[];
  readonly checkpoint: PsCheckpoint | null;
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
  readonly tier: readonly PsTier[];
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
