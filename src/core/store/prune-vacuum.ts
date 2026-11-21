import type { Connection } from "./connection.js";
import { VACUUM_PAGES, VACUUM_SLICE_MS } from "./prune-rules.js";

/** One write transaction of a prune; the same shape as `PruneSlice` in `prune.ts`. */
type Slice = () => void;

/** Milliseconds from a fixed start; tests replace it to stop a slice where they choose. */
export type VacuumClock = () => number;

/**
 * Row 022-08: frees the pages deletes left, in both stores' prunes. Each
 * slice is one write transaction that runs `incremental_vacuum(VACUUM_PAGES)`
 * again until `VACUUM_SLICE_MS` passed, no page is free, or a step freed
 * nothing; so a slice holds the lock about the budget, whatever a page costs
 * on this store. The next slice continues where it stopped. The prune stops
 * when a slice freed nothing, as on a store created without `auto_vacuum`.
 */
export function* vacuum(
  conn: Connection,
  clock: VacuumClock = () => performance.now(),
): Generator<Slice, void, undefined> {
  let free = freePages(conn);
  while (free > 0) {
    yield () => conn.transaction(() => vacuumFor(conn, clock));
    const left = freePages(conn);
    if (left >= free) return;
    free = left;
  }
}

/** One slice's steps, inside its transaction. */
function vacuumFor(conn: Connection, clock: VacuumClock): void {
  const start = clock();
  let free = freePages(conn);
  while (free > 0) {
    conn.db.exec(`PRAGMA incremental_vacuum(${VACUUM_PAGES})`);
    const left = freePages(conn);
    if (left >= free) return;
    free = left;
    if (clock() - start >= VACUUM_SLICE_MS) return;
  }
}

function freePages(conn: Connection): number {
  return Number(conn.get("PRAGMA freelist_count")?.freelist_count ?? 0);
}
