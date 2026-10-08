import type { CheckpointRecord, DaemonPhase, EpochMs, WorktreeId } from "../types/index.js";

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
  | { readonly type: "close" };

/** Front desk to main thread. */
export type FromDesk =
  | { readonly type: "listening" }
  | { readonly type: "failed"; readonly error: string }
  | { readonly type: "activity" }
  | { readonly type: "run-all"; readonly id: string; readonly force: boolean }
  | { readonly type: "stop" }
  | { readonly type: "step-down"; readonly version: string }
  | { readonly type: "closed" };
