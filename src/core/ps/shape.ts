import type { AbsolutePath, EpochMs, WorktreeId } from "../types/index.js";
import type { MemoryKind, PsPlatform } from "./source.js";

/*
 * Spec 014 D8: the versioned shape `squeal ps --json` prints. `render.ts`
 * is a layer on top of it. A value `ps` could not read is `null` and
 * `unknown` names it; it never reads as zero (vision, principle 2). Sizes
 * are bytes, CPU is in percent of one CPU, shares are percents, times are
 * epoch ms. Changes are additive; a change of meaning raises `v`.
 */

export const PS_SHAPE_VERSION = 1;

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
  /** With `--full`: the files that never get a flag, counted by kind (D7); `null` without it. */
  readonly unflaggedFiles: readonly PsUnflaggedFiles[] | null;
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
export type DaemonPhase = "serving" | "starting" | "waiting" | "stopping" | "unknown";

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
  readonly tiers: readonly PsTier[];
  /** Its open checkpoints since it started, oldest first: a `run --all` and a `run --fast` can overlap. */
  readonly checkpoints: readonly PsCheckpoint[];
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

/** An open checkpoint: `checkpoints` with `completed_at IS NULL` since the daemon started (D3). */
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

/** Files whose lock the OS frees when the holder dies, so they never get a flag (D7). */
export type PsUnflaggedKind = "lock" | "waiter-lock" | "surplus-permit" | "session-root";

export interface PsUnflaggedFiles {
  readonly kind: PsUnflaggedKind;
  readonly count: number;
}

/** A value `ps` could not read, or a rule it did not evaluate, and why (D8, D9, D10). */
export interface PsUnknown {
  /** `daemon 3704612 lastUsedAt`, `flag hung`, `host cpuPressure`, ... */
  readonly what: string;
  readonly why: string;
}
