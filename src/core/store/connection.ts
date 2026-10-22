import { AsyncLocalStorage } from "node:async_hooks";
import type { DatabaseSync, SQLInputValue, StatementSync } from "node:sqlite";

export type Row = Record<string, unknown>;
export type Params = readonly SQLInputValue[];

/**
 * One `node:sqlite` connection with cached statements and `BEGIN IMMEDIATE`
 * write transactions. Nested transactions become savepoints, so a repository
 * method that writes several rows is atomic on its own and inside a caller's
 * transaction.
 */
export class Connection {
  readonly #statements = new Map<string, StatementSync>();
  #depth = 0;
  #closed = false;
  readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  /** Runs a statement; returns the number of rows it changed. */
  run(sql: string, ...params: Params): number {
    const statement = this.#statement(sql);
    // Outside a transaction a write takes the lock itself: a busy slice bounds its wait.
    const changes = () => statement.run(...params).changes;
    return Number(this.#depth > 0 ? changes() : this.#withinSlice(changes));
  }

  get(sql: string, ...params: Params): Row | null {
    return (this.#statement(sql).get(...params) as Row | undefined) ?? null;
  }

  all(sql: string, ...params: Params): Row[] {
    return this.#statement(sql).all(...params) as Row[];
  }

  /**
   * Runs `fn` in a `BEGIN IMMEDIATE` transaction, or in a savepoint when one
   * is already open. Spec 001 D8: "short `BEGIN IMMEDIATE` write
   * transactions": the write lock is taken up front, so a writer waits on the
   * busy timeout instead of failing to upgrade a read snapshot.
   */
  transaction<T>(fn: () => T): T {
    const savepoint = this.#depth > 0 ? `squeal_${this.#depth}` : null;
    if (savepoint === null) this.#withinSlice(() => this.db.exec("BEGIN IMMEDIATE"));
    else this.db.exec(`SAVEPOINT ${savepoint}`);
    this.#depth++;
    try {
      const result = fn();
      this.db.exec(savepoint === null ? "COMMIT" : `RELEASE ${savepoint}`);
      return result;
    } catch (error) {
      if (savepoint === null) rollback(this.db);
      else this.db.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
      throw error;
    } finally {
      this.#depth--;
    }
  }

  /**
   * Runs `fn`, which only reads, in a deferred `BEGIN` transaction, so every
   * statement in it sees one committed state of the store. In WAL a reader
   * never blocks the writer and the writer never blocks it (spec 001 D8).
   * Inside an open transaction it just runs `fn`: that is one state already.
   */
  read<T>(fn: () => T): T {
    if (this.#depth > 0) return fn();
    this.db.exec("BEGIN");
    this.#depth++;
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      rollback(this.db);
      throw error;
    } finally {
      this.#depth--;
    }
  }

  /** Idempotent. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#statements.clear();
    this.db.close();
  }

  /**
   * Runs `fn`, one statement that takes the write lock, with the busy slice
   * of the caller's async context as its busy timeout when that is shorter,
   * and restores the connection's own before returning (task 001-422). One
   * synchronous call: no other statement runs while the slice is set.
   */
  #withinSlice<T>(fn: () => T): T {
    const slice = slices.getStore();
    if (slice === undefined || !slice.live) return fn();
    const own = Number(Object.values(this.#statement("PRAGMA busy_timeout").get() ?? {})[0]);
    if (!(slice.ms < own)) return fn();
    this.db.exec(`PRAGMA busy_timeout = ${slice.ms}`);
    try {
      return fn();
    } finally {
      this.db.exec(`PRAGMA busy_timeout = ${own}`);
    }
  }

  #statement(sql: string): StatementSync {
    let statement = this.#statements.get(sql);
    if (statement === undefined) {
      statement = this.db.prepare(sql);
      this.#statements.set(sql, statement);
    }
    return statement;
  }
}

/** A busy slice of one async context; `live` until the work it was given settles. */
interface Slice {
  readonly ms: number;
  live: boolean;
}

const slices = new AsyncLocalStorage<Slice>();

/**
 * Runs `fn` with every write that takes the store's lock in it, its awaited
 * continuations included, waiting at most `ms` for a busy lock instead of
 * the connection's busy timeout (task 001-422: a pass on a busy store gives
 * up in a slice and is retried, so the event loop is never held for long).
 * Work `fn` starts and leaves running is past the slice once `fn` settles.
 */
export async function withBusySlice<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  const slice: Slice = { ms, live: true };
  try {
    return await slices.run(slice, fn);
  } finally {
    slice.live = false;
  }
}

/** `withBusySlice` for synchronous work: the slice ends when `fn` returns. */
export function withBusySliceSync<T>(ms: number, fn: () => T): T {
  const slice: Slice = { ms, live: true };
  try {
    return slices.run(slice, fn);
  } finally {
    slice.live = false;
  }
}

/**
 * Rolls back the open transaction, if any. SQLite rolls back by itself after
 * some errors (busy, full, I/O), so a "no transaction is active" error here
 * is expected and dropped; the caller rethrows the error that caused the
 * rollback. Node 22.19 has `isTransaction`, but this function is on the key
 * format's path, so reading it instead waits for the next key-format raise
 * (row 011-102; 011-64 design 4).
 */
export function rollback(db: DatabaseSync): void {
  try {
    db.exec("ROLLBACK");
  } catch (error) {
    if (!/no transaction is active/.test(String(error))) throw error;
  }
}

/** SQLITE_BUSY (5) and SQLITE_LOCKED (6), including extended codes. */
export function isBusy(error: unknown): boolean {
  const code = (error as { errcode?: unknown } | null)?.errcode;
  return typeof code === "number" && [5, 6].includes(code & 0xff);
}
