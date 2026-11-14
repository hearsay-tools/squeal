import { isRecord } from "../fs/json.js";
import type { WorktreeId } from "../types/common.js";
import { daemonIncarnation } from "../types/daemon.js";
import { type Store, worktreeMetaKey } from "../types/store.js";
import type { Connection } from "./connection.js";

/*
 * Row 011-45 (C6 as amended 2026-10-20, 011-42): a per-worktree marker of
 * the writes to its known states and its `test_file_keys` rows, so the
 * fallback `status --wait`, which holds for every check, reads every state
 * only when one changed. One JSON row per worktree: `seq` counts the
 * transactions that wrote either table, and `writer` names the daemon
 * incarnation (`daemonIncarnation`) that claimed the marker when it
 * registered.
 *
 * Each write bumps `seq` in its own transaction, so a read transaction sees
 * the rows and the marker together: the repositories' upserts
 * (`bumpStatesMarker`), and for a removal its one caller, the ledger's
 * commit (`bumpStatesMarkerOf`). A daemon's registration releases its
 * predecessor's running rows and claims the marker in one transaction.
 *
 * A daemon of a release before this one writes rows with no bump, its own
 * worktree's or, healing a shared key, another's (`storeResults`); every
 * daemon registers before it writes a row (task 001-268), and only one of
 * this release claims its worktree's marker. So a reader trusts a marker
 * only while its worktree's registered daemon claimed it and so did every
 * other registered daemon of the store (`statesMark`); otherwise, or with
 * no marker, it reads every state as before. Removing the worktree drops
 * the row with its other `meta` rows.
 */

/** `meta` key of a worktree's states marker. */
export function statesMarkerMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("statesMarker", worktreeId);
}

/*
 * One statement, so the upserts' bump reads nothing back: a row that is no
 * JSON starts again at 1 with no writer, which no reader trusts.
 */
const BUMP = `INSERT INTO meta (key, value) VALUES (?, '{"seq":1,"writer":null}')
  ON CONFLICT (key) DO UPDATE SET value = CASE WHEN json_valid(value)
    THEN json_set(value, '$.seq', coalesce(json_extract(value, '$.seq'), 0) + 1)
    ELSE excluded.value END`;

/**
 * Counts one more write to `worktreeIds`' known states or `test_file_keys`
 * rows, keeping each marker's writer. Call it inside the transaction that
 * writes them; a worktree with no marker gets one no reader trusts.
 */
export function bumpStatesMarker(conn: Connection, worktreeIds: Iterable<WorktreeId>): void {
  for (const id of new Set(worktreeIds)) conn.run(BUMP, statesMarkerMetaKey(id));
}

interface Marker {
  readonly seq: number;
  readonly writer: string | null;
}

function readMarker(store: Store, worktreeId: WorktreeId): Marker | null {
  const raw = store.meta.get(statesMarkerMetaKey(worktreeId));
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

function writeMarker(store: Store, worktreeId: WorktreeId, writer: string | null): void {
  const seq = (readMarker(store, worktreeId)?.seq ?? 0) + 1;
  store.meta.set(statesMarkerMetaKey(worktreeId), JSON.stringify({ seq, writer }));
}

/** `bumpStatesMarker` for a caller that holds the store: the ledger's removals. */
export function bumpStatesMarkerOf(store: Store, worktreeId: WorktreeId): void {
  writeMarker(store, worktreeId, readMarker(store, worktreeId)?.writer ?? null);
}

/**
 * A daemon's registration claims the marker for its incarnation (`null`
 * when it has none, which no reader trusts), in the registration's
 * transaction, and counts a write: what an earlier writer left is read again.
 */
export function claimStatesMarker(store: Store, id: WorktreeId, writer: string | null): void {
  writeMarker(store, id, writer);
}

/**
 * The marker as a reader may trust it, as `<seq>@<writer>`: while its
 * worktree's registered daemon claimed it and every other registered daemon
 * claimed its own; `null` with no marker or no daemon, or once a daemon that
 * claims none registered, since it may write rows with no bump. Read it in
 * the read transaction of the rows it vouches for.
 */
export function statesMark(store: Store, worktreeId: WorktreeId): string | null {
  const own = readMarker(store, worktreeId);
  if (own?.writer == null) return null;
  if (daemonIncarnation(store.worktrees.get(worktreeId)?.daemon ?? null) !== own.writer) {
    return null;
  }
  for (const { id, daemon } of store.worktrees.list()) {
    if (daemon === null || id === worktreeId) continue;
    const incarnation = daemonIncarnation(daemon);
    if (incarnation === null || readMarker(store, id)?.writer !== incarnation) return null;
  }
  return `${own.seq}@${own.writer}`;
}
