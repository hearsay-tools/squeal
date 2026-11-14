import type { DownReason } from "../../core/presence/wait.js";
import type { NamedFile } from "../../core/status/standing.js";
import type { AbsolutePath, EpochMs, RelativePath } from "../../core/types/common.js";
import type { TestFileRef } from "../../core/types/keys.js";
import type { StatusHold } from "../../core/types/standing.js";
import type { StatusSnapshot } from "../../core/types/status.js";
import type { NamedSelection } from "../named-selection.js";
import type { DaemonSync, SyncState } from "../status-sync.js";
import type { AskedEnd } from "../status-wait-ask.js";
import type { AskNamed } from "../status-wait-ask-store.js";
import type { NamedFocus } from "../status-wait-focus.js";
import type { LeftGroup } from "../status-wait-groups.js";
import type { FocusNamed, PromoteNamed } from "../status-wait-promote.js";
import type { FileVerdict } from "../verdict.js";
import type { HeartbeatLapse } from "../wait-liveness.js";
import type { NamedWaitOutcome } from "./status-table.js";
import type { UnavailableEnd } from "./wait.js";

/*
 * Row 011-331: what the named wait and the snapshot are asked and return,
 * moved from `status-wait-paths.ts` and `status-paths.ts` unchanged.
 */

/** The read that ended a named wait or a snapshot: everything but how long it waited. */
export interface NamedWaitEnded {
  readonly outcome: NamedWaitOutcome;
  readonly selection: NamedSelection;
  /**
   * The selected slow files that run only on a pause, which the wait
   * does not hold for (task 004-78), in `selection` order; none when absent.
   */
  readonly leftForPause?: readonly TestFileRef[];
  /** With a `checks` key, `leftForPause` by owning group (row 019-24, `leftGroupsOf`). */
  readonly leftGroups?: readonly LeftGroup[];
  /** The verdict on the selected files but `leftForPause`. */
  readonly verdict: FileVerdict;
  /** Each selected file's class, verdict and what holds it (task 011-12), in `selection` order. */
  readonly files: readonly NamedFile[];
  readonly result: StatusSnapshot;
  /** Where the daemon's pass stood at the last read: a `timeout` before it reached the store's revision says so. */
  readonly sync: SyncState;
  /** With `no-daemon`: why (task 004-66). */
  readonly down?: DownReason;
  /** A heartbeat lapse the wait went on through, the daemon alive (task 004-66). */
  readonly lapse?: HeartbeatLapse;
  /** Row 011-206: the wait's last read found the heartbeat lapsed or a handoff under way. */
  readonly lapsed?: true;
  /** Row 011-250: with `lapsed`, that read found no record while a daemon held the worktree's lock. */
  readonly locked?: true;
  /**
   * Row 011-286 (gh-130 option A): with `lapsed` and `settled`, that read found the wait's own
   * pass stored and every selected file current, so the lapse does not hold its verdict.
   */
  readonly lapseCovered?: true;
  /** With `on-hold`: the hold its verdict line names (row 011-73). */
  readonly hold?: StatusHold;
  /**
   * `status <path>...` without `--wait` (row 011-28, 005 D2 as amended
   * 2026-10-20): one read after one sync, worded as a snapshot; its
   * `timeout` is a read with no verdict.
   */
  readonly snapshot?: boolean;
  /** Row 011-146: with `--check`, the focused answers it read. */
  readonly focus?: NamedFocus;
  /**
   * Row 011-207: the runs it asked or joined and the asks a busy store
   * refused, as its last read found them, for its lines; absent with none.
   */
  readonly asked?: readonly AskedEnd[];
}

export type NamedWait =
  | (NamedWaitEnded & {
      readonly waitedMs: number;
      /** Row 011-243: the deadline the wait was given, which its next step names; not in `--json`. */
      readonly timeoutMs?: number;
    })
  | UnavailableEnd;

export interface NamedWaitOptions {
  readonly timeoutMs: number;
  readonly pollMs: number;
  readonly settleMs: number;
  readonly now: () => EpochMs;
  /** Row 011-234: `sourcePaths`, the named paths whose readers it asks the daemon for. */
  readonly sync: (root: AbsolutePath, pollMs: number, paths: readonly RelativePath[]) => DaemonSync;
  /** Default `WAIT_DOWN_MS`: how long a stale record's dead socket may stay so (task 004-66). */
  readonly downMs?: number;
  /** Default `promoteNamed`; tests replace it (spec 011 C15). */
  readonly promote?: PromoteNamed;
  /** Row 011-146: the `--check` texts; none for a named wait as before. */
  readonly checks?: readonly string[];
  /** Default `focusNamed`; tests replace it (row 011-146). */
  readonly focus?: FocusNamed;
  /** Default `askNamedRuns`; tests replace it (row 011-207). */
  readonly ask?: AskNamed;
  /** The harness session its requests name (row 011-207); `""` when none. */
  readonly asker?: string;
}

export interface NamedSnapshotOptions {
  /** Default `SETTLE_MS`: the longest the snapshot waits for the daemon's sync. */
  readonly settleMs?: number;
  /** Default `SYNC_POLL_MS`: how often it reads a sync that does not say when it answered. */
  readonly pollMs?: number;
  readonly now: () => EpochMs;
  /** Default `syncDaemon`; tests replace it. Row 011-234: `paths`, the named source paths. */
  readonly sync?: (
    root: AbsolutePath,
    pollMs: number,
    paths: readonly RelativePath[],
  ) => DaemonSync;
  /** Row 011-146: `--check` texts, whose focused answers it reads and requests nothing for (C6). */
  readonly checks?: readonly string[];
}
