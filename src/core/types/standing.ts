import type { EpochMs } from "./common.js";
import type { TestFileRef } from "./keys.js";
import type { PendingPhase } from "./state.js";

/*
 * Row 011-27 (011 C15 as amended 2026-10-20): where a test file without a
 * verdict stands, the input of `nextStep` (`src/core/status/next-step.ts`).
 * Row 011-29 moved the types here, so the status payload's `outstanding`
 * groups (011 C6 as amended 2026-10-20) can carry them.
 */

/** The host's load now, as `hostLoad` reads it. */
export interface LoadNow {
  readonly oneMinute: number | null;
  readonly cpus: number;
}

/** A project's global setup the store knows of: its file, `""` when its error named none. */
export interface KnownSetup {
  readonly file: string;
}

/** A file `retry` runs once: how many of the worktree's test files are not current, what `run --all --wait` runs. */
interface Retryable {
  readonly notCurrent?: number;
}

/**
 * Whether the tier a promoted file is queued behind yields to it (spec 011
 * C4 step 5 and C15 as amended 2026-10-21, row 011-51), as its daemon last
 * found: `yields`, it cancelled the tier; else why not: `remainder`, the
 * tier's estimated remainder was `remainderMs`, 30 s or less; `overrun`, it
 * has run past its estimate by less than 30 s and yields at `yieldsAt` if
 * it still runs (row 011-107); `cut`, it holds a file a yield already cut
 * at its key; `turn`, it is the backlog's turn after four tiers of the
 * first group; `runner`, its runner runs each tier to its end (node:test,
 * pytest); `named`, it has run 30 s and runs a file that the same or an
 * earlier open wait selected (C4 step 5 as amended 2026-10-24, row 011-184).
 */
export type TierYield =
  | { readonly kind: "yields" }
  | { readonly kind: "remainder"; readonly remainderMs: number }
  | { readonly kind: "overrun"; readonly yieldsAt: EpochMs }
  | { readonly kind: "cut" | "turn" | "runner" | "named" };

/**
 * Where a test file without a verdict stands, one state a file (the order
 * rule: another worktree's claim is tested before stale and unknown). The
 * pending kinds are `PendingReason`'s, each count of files additive.
 */
export type Standing =
  | { readonly kind: "no-daemon"; readonly since: EpochMs | null; readonly revision: number }
  | {
      readonly kind: "unlisted";
      readonly revision: number;
      readonly callBoundMs: number;
      /** A selected file is promoted and the run the runner part waits for yields (row 011-51). */
      readonly yields?: TierYield;
    }
  | ({
      readonly kind: "stale";
      readonly verdict: "pass" | "fail" | "skip" | null;
      readonly lookupOnly: boolean;
    } & Retryable)
  | ({ readonly kind: "never-run"; readonly lookupOnly: boolean } & Retryable)
  /** Timed out in a tier of its own (C4); `load` while it is at or above the CPU count. */
  | ({
      readonly kind: "timed-out";
      readonly reason: string;
      readonly load: LoadNow | null;
    } & Retryable)
  /** Ran and recorded nothing, or no result for a reason kept as words only. */
  | ({ readonly kind: "no-result"; readonly reason: string } & Retryable)
  | { readonly kind: "setup-failed" }
  /** No key, or a runner call failed: the runner's message. */
  | { readonly kind: "runner"; readonly reason: string }
  | { readonly kind: "no-install"; readonly command: string | null }
  | {
      readonly kind: "running";
      readonly lane: string;
      readonly since: EpochMs | null;
      /** The test files of its open run; one, or absent, is a run of its own. */
      readonly files?: number;
      /** A slow file's project's global setup, when the store knows it has one (gh-46). */
      readonly setup?: KnownSetup;
    }
  | {
      readonly kind: "queued";
      readonly lane: string;
      readonly behind: EpochMs | null;
      /** The test files of the tier it is queued behind. */
      readonly files?: number;
      readonly promoted?: boolean;
      /** Promoted: whether that tier yields to it (row 011-51); absent from an older daemon. */
      readonly yields?: TierYield;
      /**
       * Not promoted, with no tier running in its lane: when its lane's wait
       * for quiet after a backlog tier's cancel ends (C4 step 5 as amended
       * 2026-10-21, row 011-82); absent with no wait, or from an older daemon.
       */
      readonly quietUntil?: EpochMs;
      /**
       * `quietUntil` is the end of the lane's wait for quiet before its
       * catch-up of an edit (C4 step 5 as amended 2026-10-23, row 011-153).
       */
      readonly quietCatchUp?: true;
    }
  | { readonly kind: "claim"; readonly worktree: string; readonly until: EpochMs | null }
  /** Queued while the worktree is on hold (C9, row 011-73): the first hold `holds` names. */
  | { readonly kind: "on-hold"; readonly hold: StatusHold }
  | {
      readonly kind: "slow";
      readonly pausesOnly?: true;
      /** While its daemon waits for the slow slot: who holds it (row 011-58, gh-58). */
      readonly slot?: SlowSlotHolders;
    }
  | { readonly kind: "checkpoint" };

/**
 * A hold on the worktree's validation (spec 011 C9 as amended 2026-10-21,
 * row 011-73), as status gives it in `holds` (C6): an unresolved merge, with
 * the first 50 paths git lists unmerged and how many it lists; or one
 * `squeal hold -- <command>`, with the command's pid (the wrapper's when the
 * command's is not recorded) and the latest end. `gone`: every process its
 * holder recorded is gone; `expired`: `until` passed. The daemon ends such a
 * hold at its next heartbeat.
 */
export type StatusHold =
  | {
      readonly cause: "merge";
      readonly since: EpochMs;
      readonly revision: number;
      readonly paths: readonly string[];
      readonly pathCount: number;
    }
  | {
      readonly cause: "command";
      readonly since: EpochMs;
      readonly command: string;
      readonly pid: number | null;
      readonly until: EpochMs;
      readonly gone?: true;
      readonly expired?: true;
    };

/**
 * A hold that ended, as a delivery names it (row 011-73): the merge, or one
 * command hold by its command and, when recorded, its pid (two holds may run
 * the same command).
 */
export type HoldEnded =
  | { readonly cause: "merge" }
  | { readonly cause: "command"; readonly command: string; readonly pid?: number | null };

/**
 * One change of the holds a consumer was last told (row 011-73; spec 011 C8
 * as amended 2026-10-21: told as liveness is, once per change, in one line):
 * `on-hold`, `hold` started; `ended`, a hold ended while `holds` still hold,
 * or before another ends (none); `resumed`, the last hold ended, no hold
 * holds now, and `queued` test files wait to start, `running` already run.
 */
export type HoldChange =
  | { readonly kind: "on-hold"; readonly hold: StatusHold }
  | { readonly kind: "ended"; readonly ended: HoldEnded; readonly holds: readonly StatusHold[] }
  | {
      readonly kind: "resumed";
      readonly ended: HoldEnded;
      readonly queued: number;
      readonly running: number;
    };

/**
 * What holds a group of `status`'s `Outstanding:` block (row 011-29): a
 * file's `Standing`; the daemon still listing the worktree's test files
 * (C15's discovery); or a retry asked at the file's key and not ended (C5),
 * `elsewhere` while another worktree's daemon queued its run.
 */
export type OutstandingStanding =
  | Standing
  | { readonly kind: "listing" }
  | {
      readonly kind: "retry";
      readonly reason: "load" | "environment";
      readonly noResult: boolean;
      readonly runningSince: EpochMs | null;
      readonly elsewhere: boolean;
    };

/**
 * One group of test files that are not current and read alike, with what
 * holds them (spec 011 C6 as amended 2026-10-20, row 011-29), as `status`
 * prints it under `Outstanding:`. `files` are every one of them, path order;
 * none for the worktree's own state: no daemon, the files not listed, the
 * revision's runner part, a checkpoint in progress.
 */
export interface OutstandingGroup {
  readonly standing: OutstandingStanding;
  readonly files: readonly TestFileRef[];
}

/**
 * The first test files of one phase, path order, and how many the list
 * leaves out (row 011-58, gh-61; 011 C6): `files` and `omitted` add up to
 * the phase's count in `testFilesByPhase`.
 */
export interface PhaseFiles {
  readonly files: readonly TestFileRef[];
  readonly omitted: number;
}

/** The pending test files by phase, as `testFilesByPhase` counts them (row 011-58). */
export type PendingTestFiles = Readonly<Record<PendingPhase, PhaseFiles>>;

/**
 * The holders of the slow slot's permits this worktree's daemon may take
 * (row 011-58, gh-58; 004 D2, which lets several daemons hold permits at
 * once), while its slow tier waits for them, as the permits' lock files
 * record them.
 */
export interface SlowSlotHolders {
  /** This repository's `slow.maxParallel`: the permits its daemon may take. */
  readonly permits: number;
  /** The held ones by holder, the longest held first; none when every one is free now. */
  readonly holders: readonly SlotHolder[];
}

/**
 * The permits one holder record names: `live` while its pid runs, `stale`
 * when it does not, so whatever holds the lock wrote no record; or the
 * permits that record none (`missing`) or none that reads (`unreadable`).
 */
export type SlotHolder =
  | {
      readonly kind: "live" | "stale";
      readonly permits: number;
      readonly pid: number;
      readonly worktreeId: string;
      /** Its root, when this repository's store records the worktree; `null` otherwise. */
      readonly root: string | null;
      /** The record names this worktree. */
      readonly self?: true;
      /** When it took the first of them, and how long before the read that was. */
      readonly since: EpochMs;
      readonly heldMs: number;
      /** Its slow files running, as its daemon published them; absent when the store does not say. */
      readonly running?: readonly string[];
      /** Its slow files pending, the running ones included; absent when the store does not say. */
      readonly pending?: number;
    }
  | { readonly kind: "missing" | "unreadable"; readonly permits: number };
