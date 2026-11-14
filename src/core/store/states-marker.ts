import { isRecord } from "../fs/json.js";
import type { WorktreeId } from "../types/common.js";
import { daemonIncarnation } from "../types/daemon.js";
import { type Store, worktreeMetaKey } from "../types/store.js";
import { str } from "./codec.js";
import type { Connection } from "./connection.js";

/*
 * Row 011-45 (C6 as amended 2026-10-20, 011-42): a per-worktree marker of
 * the writes to its known states and its `test_file_keys` rows, so the
 * fallback `status --wait`, which holds for every check, reads every state
 * only when one changed. One JSON row per worktree: `seq` counts the
 * transactions that wrote either table, and `writer` names the daemon
 * incarnation (`daemonIncarnation`) that claimed the marker at its
 * registration.
 *
 * The repositories of both tables bump `seq` in the transaction that writes
 * them, so a read transaction sees the rows and the marker together. A daemon
 * of a release before this one writes rows without a bump; every daemon
 * registers before it writes a row (as the re-key moves rely on, task 001-268), and one
 * of this release claims the marker in its registration. So a reader trusts
 * the marker only while its `writer` is the worktree's registered daemon
 * (`statesMark`); otherwise, or with no marker, it reads every state as
 * before. Removing the worktree drops the row with its other `meta` rows.
 */

/** `meta` key of a worktree's states marker. */
export function statesMarkerMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("statesMarker", worktreeId);
}

interface Marker {
  readonly seq: number;
  readonly writer: string | null;
}

function parse(raw: string | null): Marker | null {
  let value: unknown = null;
  try {
    value = raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || typeof value.seq !== "number" || !Number.isInteger(value.seq)) {
    return null;
  }
  return { seq: value.seq, writer: typeof value.writer === "string" ? value.writer : null };
}

function write(conn: Connection, worktreeId: WorktreeId, marker: Marker): void {
  conn.run(
    "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
    statesMarkerMetaKey(worktreeId),
    JSON.stringify(marker),
  );
}

function readMarker(conn: Connection, worktreeId: WorktreeId): Marker | null {
  const row = conn.get("SELECT value FROM meta WHERE key = ?", statesMarkerMetaKey(worktreeId));
  return parse(row === null ? null : str(row, "value"));
}

/**
 * Counts one more write to `worktreeIds`' known states or `test_file_keys`
 * rows, keeping each marker's writer. Call it inside the transaction that
 * writes them; a worktree with no marker gets one no reader trusts.
 */
export function bumpStatesMarker(conn: Connection, worktreeIds: Iterable<WorktreeId>): void {
  for (const id of new Set(worktreeIds)) {
    const marker = readMarker(conn, id);
    write(conn, id, { seq: (marker?.seq ?? 0) + 1, writer: marker?.writer ?? null });
  }
}

/**
 * A daemon's registration claims the marker for its incarnation (`null`
 * when it has none, which no reader trusts), in the registration's
 * transaction, and counts a write: what an earlier writer left is read again.
 */
export function claimStatesMarker(store: Store, id: WorktreeId, writer: string | null): void {
  const seq = (parse(store.meta.get(statesMarkerMetaKey(id)))?.seq ?? 0) + 1;
  store.meta.set(statesMarkerMetaKey(id), JSON.stringify({ seq, writer } satisfies Marker));
}

/**
 * The marker as a reader may trust it: its `seq` and `writer`, while that
 * writer is the worktree's registered daemon; `null` when there is no marker,
 * no daemon, or another daemon registered since, which may write rows with
 * no bump. Read it in the read transaction of the rows it vouches for.
 */
export function statesMark(store: Store, worktreeId: WorktreeId): string | null {
  const marker = parse(store.meta.get(statesMarkerMetaKey(worktreeId)));
  if (marker === null || marker.writer === null) return null;
  const registered = daemonIncarnation(store.worktrees.get(worktreeId)?.daemon ?? null);
  return registered === marker.writer ? `${marker.seq}@${marker.writer}` : null;
}
