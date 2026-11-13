import { resolveCommonDir } from "../../core/fs/git-layout.js";
import { worktreeLiveness } from "../../core/presence/heartbeat.js";
import { STATUS_BUSY_TIMEOUT_MS, withStatusStore } from "../../core/status/open.js";
import type { AbsolutePath, EpochMs, WorktreeId } from "../../core/types/common.js";
import type { Store } from "../../core/types/store.js";
import { noDaemonText } from "../status-wait-lines.js";
import { type DaemonWatch, stoppingOf } from "../wait-liveness.js";
import type { WaitPorts } from "./socket.js";
import type { DaemonDown, DaemonReading } from "./table.js";

/*
 * Row 011-327 (`research/waits.md`, decision 4 items 1 and 2): the status
 * waits' rules a run wait's read takes, the busy timeout of a store read
 * and daemon presence's wait view in place of a ping.
 */

/**
 * Row 011-327: a read's busy timeout as the status waits bound it
 * (`waitForStatus`): what is left before `deadline`, at least 50 ms, at
 * most `STATUS_BUSY_TIMEOUT_MS`; the read at the deadline (`final`) waits
 * the full timeout.
 */
export function readBound(
  deadline: number,
  now: () => number,
): { readonly busyTimeoutMs: number; readonly final: boolean } {
  const left = deadline - now();
  const final = left <= 0;
  const busyTimeoutMs = final
    ? STATUS_BUSY_TIMEOUT_MS
    : Math.round(Math.max(50, Math.min(STATUS_BUSY_TIMEOUT_MS, left)));
  return { busyTimeoutMs, final };
}

/**
 * Row 011-327 (decision 4 item 2): the daemon of `worktreeId` as daemon
 * presence's wait view reads it in an open store, at the wait's clock, as
 * `waitForStatus` does: its record with the stopping reading of the same
 * read. One watch serves every read of the wait.
 */
export function presenceOf(
  root: AbsolutePath,
  worktreeId: WorktreeId,
  ports: WaitPorts,
): (store: Store) => DaemonReading {
  let watch: DaemonWatch | undefined;
  return (store) => {
    const commonDir = resolveCommonDir(root);
    if (commonDir === null) throw new Error(`run wait: no git common dir for ${root}`);
    watch ??= ports.watch(worktreeId, commonDir);
    const worktree = store.worktrees.get(worktreeId);
    const at = ports.now() as EpochMs;
    const stopping = stoppingOf(store, worktree, at);
    const view = watch.judge(worktree?.daemon ?? null, at, stopping);
    if (view.state !== "down") return { state: view.state };
    const heartbeat = worktreeLiveness(worktree, at);
    const liveness = stopping === undefined ? heartbeat : { ...heartbeat, stopping };
    return { state: "down", reason: view.reason, liveness };
  };
}

/**
 * The lint group's daemon check, in a read of the worktree's store of its
 * own, bounded as a run wait's read (`readBound`). A store not read proves
 * nothing: `unread`, and the wait goes on.
 */
export function presenceRead(
  ask: { readonly root: AbsolutePath; readonly deadline: number },
  presence: (store: Store) => DaemonReading,
  now: () => number,
): DaemonReading {
  const { busyTimeoutMs } = readBound(ask.deadline, now);
  const read = withStatusStore(ask.root, { busyTimeoutMs }, ({ store }) => presence(store));
  return "available" in read ? { state: "unread" } : read;
}

/**
 * Row 011-327: why the wait view found the daemon down, in the status
 * waits' words (`noDaemonText`): a cleared record, "the daemon stopped"; a
 * dead socket past the heartbeat's grace; a handoff past its bound.
 */
export function stoppedText(daemon: DaemonDown, command: string): string {
  return noDaemonText(daemon.liveness, daemon.reason, command);
}
