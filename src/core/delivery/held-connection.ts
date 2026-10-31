import type { DatabaseSync } from "node:sqlite";
import { Connection, type Params, rollback } from "../store/connection.js";

/** A write transaction left open by `HoldingConnection.hold`; the first of its two calls ends it. */
export interface HeldTransaction {
  /** `COMMIT`; on a failure it rolls back and rethrows. */
  commit(): void;
  /** `ROLLBACK`. */
  rollback(): void;
}

/**
 * Row 011-288: a connection that can leave one `BEGIN IMMEDIATE`
 * transaction open past the call that wrote it, so a delivery's report
 * commits only once its hook handed the text to the host. While it is held,
 * every `transaction` is a savepoint in it and every `read` runs inside it;
 * a process or worker that dies with it open leaves nothing written, since
 * SQLite rolls an unfinished transaction back. Outside a hold it is the
 * plain `Connection` (whose code is on the key format's path and so stays
 * as it is, rows 011-102 and 011-288).
 */
export class HoldingConnection extends Connection {
  #held = false;
  #savepoints = 0;
  /** Calls of the plain `transaction` or `read` in progress: no hold starts inside one. */
  #inside = 0;
  /** The database file, which this thread's holds are kept by. */
  readonly #file: string;

  constructor(db: DatabaseSync) {
    super(db);
    this.#file = fileOf(db);
  }

  /** Whether a held transaction is open. */
  get held(): boolean {
    return this.#held;
  }

  override run(sql: string, ...params: Params): number {
    this.#notBlocked();
    return super.run(sql, ...params);
  }

  override transaction<T>(fn: () => T): T {
    if (!this.#held) {
      this.#notBlocked();
      return this.#plain(() => super.transaction(fn));
    }
    const name = `squeal_held_${++this.#savepoints}`;
    this.db.exec(`SAVEPOINT ${name}`);
    try {
      const result = fn();
      this.db.exec(`RELEASE ${name}`);
      return result;
    } catch (error) {
      this.db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
      throw error;
    } finally {
      this.#savepoints--;
    }
  }

  override read<T>(fn: () => T): T {
    return this.#held ? fn() : this.#plain(() => super.read(fn));
  }

  /**
   * Opens a `BEGIN IMMEDIATE` transaction and leaves it open; `null` when one
   * is already open, held or not, so the caller writes in that one instead.
   */
  hold(): HeldTransaction | null {
    if (this.#held || this.#inside > 0) return null;
    this.#notBlocked();
    this.db.exec("BEGIN IMMEDIATE");
    this.#held = true;
    holders.set(this.#file, this);
    let open = true;
    const end = () => {
      open = false;
      this.#held = false;
      release(this.#file, this);
    };
    return {
      commit: () => {
        if (!open) return;
        try {
          this.db.exec("COMMIT");
        } catch (error) {
          rollback(this.db);
          throw error;
        } finally {
          end();
        }
      },
      rollback: () => {
        if (!open) return;
        end();
        rollback(this.db);
      },
    };
  }

  /** Closing rolls an open hold back (SQLite does), and it no longer holds the database for this thread. */
  override close(): void {
    if (this.#held) {
      this.#held = false;
      release(this.#file, this);
    }
    super.close();
  }

  /** The wait for this database's hold by another connection of this thread; `null` when none holds it. */
  heldElsewhere(): Promise<void> | null {
    const other = holders.get(this.#file);
    if (other === undefined || other === this) return null;
    return new Promise((resolve) => waiters.push({ file: this.#file, resolve }));
  }

  /**
   * A write here while another connection of this thread holds the database
   * would wait on that hold with the thread blocked, so the hold could never
   * end: it fails at once as busy instead, and the hook goes silent.
   */
  #notBlocked(): void {
    const other = holders.get(this.#file);
    if (other !== undefined && other !== this) throw threadBusy();
  }

  #plain<T>(fn: () => T): T {
    this.#inside++;
    try {
      return fn();
    } finally {
      this.#inside--;
    }
  }
}

/*
 * Per thread, since each worker thread loads its own copy of this module: the
 * connection that holds each database, and the deliveries waiting for it to
 * end. In-process callers that overlap (the Pi worker's requests, tests that
 * run hooks in parallel) take turns instead of blocking each other.
 */
const holders = new Map<string, HoldingConnection>();
let waiters: { readonly file: string; readonly resolve: () => void }[] = [];

function release(file: string, holder: HoldingConnection): void {
  if (holders.get(file) !== holder) return;
  holders.delete(file);
  const ready = waiters.filter((w) => w.file === file);
  waiters = waiters.filter((w) => w.file !== file);
  for (const waiter of ready) waiter.resolve();
}

/** The main database's file, `""` for one in memory. */
function fileOf(db: DatabaseSync): string {
  const rows = db.prepare("PRAGMA database_list").all() as { name?: unknown; file?: unknown }[];
  const file = rows.find((row) => row.name === "main")?.file;
  return typeof file === "string" ? file : "";
}

/** SQLITE_BUSY, as `isBusy` reads it. */
function threadBusy(): Error {
  return Object.assign(new Error("database is locked: a delivery of this thread holds it"), {
    code: "ERR_SQLITE_ERROR",
    errcode: 5,
  });
}

/**
 * Row 011-288: the wait, at most `boundMs`, while another connection of
 * this thread holds `connection`'s database; `null`, so the caller need not
 * await, when none does or without `connection`.
 */
export function holdFree(
  connection: HoldingConnection | undefined,
  boundMs: number,
): Promise<void> | null {
  const wait = connection?.heldElsewhere() ?? null;
  if (wait === null) return null;
  let timer: NodeJS.Timeout | undefined;
  const bound = new Promise<void>((done) => {
    timer = setTimeout(done, boundMs);
  });
  return Promise.race([wait, bound]).finally(() => clearTimeout(timer));
}
