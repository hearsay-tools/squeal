import type {
  CheckpointRecord,
  DaemonPhase,
  EpochMs,
  RevisionNumber,
  SyncAnswer,
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
}

/** Main thread to front desk. */
export type ToDesk =
  | { readonly type: "bind"; readonly identity: DeskIdentity }
  | { readonly type: "phase"; readonly phase: DaemonPhase }
  | {
      readonly type: "run-all-result";
      readonly id: string;
      readonly checkpoint: CheckpointRecord | null;
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
  | { readonly type: "close" };

/** Front desk to main thread. */
export type FromDesk =
  | { readonly type: "listening" }
  | { readonly type: "failed"; readonly error: string }
  | { readonly type: "activity" }
  | { readonly type: "run-all"; readonly id: string; readonly force: boolean }
  | { readonly type: "run-slow"; readonly id: string }
  | {
      readonly type: "sync";
      readonly id: string;
      readonly after: RevisionNumber | null;
      readonly resolvedSince: EpochMs | null;
    }
  /** The socket dropped sync `id`; its answer is never read (task 001-226). */
  | { readonly type: "sync-forget"; readonly id: string }
  | { readonly type: "stop" }
  | { readonly type: "step-down"; readonly version: string }
  | { readonly type: "closed" };
