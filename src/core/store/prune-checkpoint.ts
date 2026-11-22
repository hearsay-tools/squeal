import type { Connection } from "./connection.js";

/** One slice of a prune; the same shape as `PruneSlice` in `prune.ts`. */
type Slice = () => void;

/**
 * Row 022-08r: the prune's slices from `slices`, each that wrote followed by
 * a slice that runs the WAL checkpoint. A write slice commits with SQLite's
 * automatic checkpoint off: otherwise its `COMMIT` copies the WAL into the
 * database file, and syncs it, before it returns. That copy runs after the
 * write lock is released, so other writers go on, but it blocks the daemon
 * for as long, and the long-write log counts it as lock time (on the bench's
 * 8.6 GB store, list deletes' `COMMIT` took up to 803 ms while the delete
 * took 4 ms; `tasks/022-08/notes.md`, "Repair 022-08r"). As its own slice,
 * the driver's pause follows it, and it takes no write lock: `PASSIVE`
 * copies what no reader still needs and never waits.
 *
 * A slice wrote when `total_changes()` or the page count moved: a delete
 * counts its rows, a vacuum step shrinks the file. A slice that wrote
 * nothing gets no checkpoint, so a store with nothing to prune costs no more.
 */
export function* checkpointAfterWrites(
  conn: Connection,
  slices: Iterable<Slice>,
): Generator<Slice, void, undefined> {
  for (const slice of slices) {
    let wrote = false;
    yield () => {
      const before = writeMark(conn);
      withoutAutoCheckpoint(conn, slice);
      wrote = writeMark(conn) !== before;
    };
    if (wrote) yield () => checkpoint(conn);
  }
}

/** Runs `fn` with this connection's automatic checkpoint off, then restores its own setting. */
function withoutAutoCheckpoint(conn: Connection, fn: Slice): void {
  const own = Number(conn.get("PRAGMA wal_autocheckpoint")?.wal_autocheckpoint);
  conn.db.exec("PRAGMA wal_autocheckpoint = 0");
  try {
    fn();
  } finally {
    conn.db.exec(`PRAGMA wal_autocheckpoint = ${own}`);
  }
}

/** The checkpoint `COMMIT` would have run: `PASSIVE`, as SQLite's automatic one. */
function checkpoint(conn: Connection): void {
  conn.get("PRAGMA wal_checkpoint(PASSIVE)");
}

function writeMark(conn: Connection): string {
  const changes = conn.get("SELECT total_changes() AS n")?.n;
  const pages = conn.get("PRAGMA page_count")?.page_count;
  return `${String(changes)}:${String(pages)}`;
}
