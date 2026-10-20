import type { EpochMs } from "./common.js";
import type { TestFileRef } from "./keys.js";

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
 * Where a test file without a verdict stands, one state a file (the order
 * rule: another worktree's claim is tested before stale and unknown). The
 * pending kinds are `PendingReason`'s, each count of files additive.
 */
export type Standing =
  | { readonly kind: "no-daemon"; readonly since: EpochMs | null; readonly revision: number }
  | { readonly kind: "unlisted"; readonly revision: number; readonly callBoundMs: number }
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
    }
  | { readonly kind: "claim"; readonly worktree: string; readonly until: EpochMs | null }
  | { readonly kind: "slow"; readonly pausesOnly?: true }
  | { readonly kind: "checkpoint" };

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
