import { num } from "../../store/codec.js";
import type { Connection } from "../../store/connection.js";
import type { EpochMs } from "../../types/index.js";
import { isManifest, readManifest } from "../coverage/parts.js";

/*
 * Row 015-85 (spec 015 D4): which coverage parts prune may delete.
 *
 * Invariant: for each manifest R kept and each part P it lists,
 * `P.used_at >= R.recorded_at - PART_REFRESH_MS`. `putParts` keeps it: it
 * stores a part with the record's stored time, and moves an older
 * `used_at` up in the same transaction as the manifest. A daemon that
 * predates the table writes no manifest, so it cannot break it.
 *
 * So a part used before `cutoff` is listed only by manifests stored before
 * `cutoff + PART_REFRESH_MS`: the records kept past the retention, mostly
 * at keys current in a live worktree. `markParts` reads those; `sweepParts`
 * deletes the other parts used before `cutoff`, each batch re-testing
 * `used_at` under the write lock, so a record stored between the two that
 * lists a part has moved its `used_at` past `cutoff` and keeps it. A record
 * stored after the mark has its stored time near now, far above the bound.
 *
 * Assumed, not measured: the clock does not move back by more than the
 * retention less `PART_REFRESH_MS` between a record's write and a prune.
 * A record stored at a time that far back would sort before the bound
 * after the mark was read, and its parts could go while it lists them;
 * its sources would then read unread, never as not run.
 */

/** How old a part's `used_at` may grow while a stored record lists it. */
export const PART_REFRESH_MS = 60 * 60_000;

/** Whether the file holds `coverage_parts`: a store a reader opened before any writer made it holds none. */
export function hasParts(conn: Connection): boolean {
  return (
    conn.get(
      "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
      "coverage_parts",
    ) !== null
  );
}

/** The parts every manifest stored before `bound` lists, read one record at a time. */
export function markParts(conn: Connection, bound: EpochMs): Set<number> {
  const marked = new Set<number>();
  const keys = conn.all(
    "SELECT result_key, provider_version FROM coverage WHERE recorded_at < ?",
    bound,
  );
  for (const key of keys) {
    const row = conn.get(
      "SELECT record FROM coverage WHERE result_key = ? AND provider_version = ?",
      key.result_key as string,
      key.provider_version as number,
    );
    const bytes = row?.record;
    if (!(bytes instanceof Uint8Array) || !isManifest(bytes)) continue;
    for (const part of readManifest(bytes)?.parts ?? []) marked.add(part.id);
  }
  return marked;
}

/** Deletes the parts used before `cutoff` that `marked` does not hold, `batch` per transaction. */
export function sweepParts(
  conn: Connection,
  cutoff: EpochMs,
  marked: ReadonlySet<number>,
  batch: number,
): number {
  const ids = conn
    .all("SELECT id FROM coverage_parts WHERE used_at < ?", cutoff)
    .map((row) => num(row, "id"))
    .filter((id) => !marked.has(id));
  let removed = 0;
  for (let i = 0; i < ids.length; i += batch) {
    const some = JSON.stringify(ids.slice(i, i + batch));
    removed += conn.transaction(() =>
      conn.run(
        "DELETE FROM coverage_parts WHERE id IN (SELECT value FROM json_each(?)) AND used_at < ?",
        some,
        cutoff,
      ),
    );
  }
  return removed;
}

/** `markParts`, then `sweepParts`; 0 with no `coverage_parts`. */
export function pruneParts(conn: Connection, cutoff: EpochMs, batch: number): number {
  if (!hasParts(conn)) return 0;
  return sweepParts(conn, cutoff, markParts(conn, cutoff + PART_REFRESH_MS), batch);
}
