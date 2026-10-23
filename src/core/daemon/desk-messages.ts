import type {
  DaemonPhase,
  EpochMs,
  FullSuiteCheckpoint,
  FullSuiteRequest,
  SyncAnswer,
  TestFileRef,
  WorktreeId,
} from "../types/index.js";
import type { SlowSuiteRequested } from "./run-slow.js";

/** What the front desk worker needs to answer on its own. */
export interface DeskIdentity {
  readonly socketPath: string;
  readonly worktreeId: WorktreeId;
  readonly root: string;
  readonly squealVersion: string;
  readonly startedAt: EpochMs;
  /** `DaemonRecord.token` (task 001-270). */
  readonly token: string;
}

/** Main thread to front desk. */
export type ToDesk =
  | { readonly type: "bind"; readonly identity: DeskIdentity }
  | { readonly type: "phase"; readonly phase: DaemonPhase }
  | {
      readonly type: "run-all-result";
      readonly id: string;
      readonly checkpoint: FullSuiteCheckpoint | null;
      readonly error: string | null;
    }
  | {
      readonly type: "run-slow-result";
      readonly id: string;
      readonly requested: SlowSuiteRequested | null;
      readonly error: string | null;
    }
  | {
      readonly type: "sync-result";
      readonly id: string;
      readonly answer: SyncAnswer | null;
      readonly error: string | null;
    }
  | {
      readonly type: "hold-result";
      readonly id: string;
      readonly holding: boolean | null;
      readonly error: string | null;
    }
  | { readonly type: "close" };

/** Front desk to main thread. */
export type FromDesk =
  | { readonly type: "listening" }
  | { readonly type: "failed"; readonly error: string }
  | { readonly type: "activity" }
  | { readonly type: "nudge" }
  | { readonly type: "retry" }
  | { readonly type: "run-all"; readonly id: string; readonly request: FullSuiteRequest }
  | { readonly type: "run-slow"; readonly id: string }
  | { readonly type: "sync"; readonly id: string }
  | { readonly type: "hold"; readonly id: string }
  | { readonly type: "resume" }
  | {
      readonly type: "promote";
      readonly testFiles: readonly TestFileRef[];
      readonly withinMs: number;
    }
  | {
      readonly type: "focus";
      readonly testFiles: readonly TestFileRef[];
      readonly texts: readonly string[];
      readonly withinMs: number;
    }
  | { readonly type: "stop" }
  | { readonly type: "step-down"; readonly version: string }
  | { readonly type: "closed" };
