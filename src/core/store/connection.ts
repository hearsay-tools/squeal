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
   * busy timeout instead of failing to upgrade a read snapshot. Spec 021
   * D3: the thread's write observer (`observeWrites`), when set, is told once
   * the lock is held and again at the end.
   */
  transaction<T>(fn: () => T): T {
    const savepoint = this.#depth > 0 ? `squeal_${this.#depth}` : null;
    let ended: WriteEnd | null = null;
    if (savepoint === null) {
      this.#withinSlice(() => this.db.exec("BEGIN IMMEDIATE"));
      ended = observer?.(this.db) ?? null;
    } else this.db.exec(`SAVEPOINT ${savepoint}`);
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
      ended?.();
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

/** What a write observer is told when a transaction ends, committed or rolled back. */
export type WriteEnd = () => void;

/**
 * Spec 021 D3: told once an outermost write transaction holds the lock,
 * with the connection's database; what it returns is told at the end.
 */
export type WriteObserver = (db: DatabaseSync) => WriteEnd | null;

/** Per thread, since each worker thread loads its own copy of this module. */
let observer: WriteObserver | null = null;

/**
 * Sets this thread's write observer, `null` to unset it. Only the daemon's
 * long-write log sets one (`logLongWrites`); without it, a transaction
 * calls nothing.
 */
export function observeWrites(next: WriteObserver | null): void {
  observer = next;
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
 * some errors (busy, full, I/O), so no transaction may be open here; the
 * caller rethrows the error that caused the rollback. Node 22.16 added
 * `isTransaction`, so the 22.19 floor has it (rows 011-102, 011-105).
 */
export function rollback(db: DatabaseSync): void {
  if (db.isTransaction) db.exec("ROLLBACK");
}

/** SQLITE_BUSY (5) and SQLITE_LOCKED (6), including extended codes. */
export function isBusy(error: unknown): boolean {
  const code = (error as { errcode?: unknown } | null)?.errcode;
  return typeof code === "number" && [5, 6].includes(code & 0xff);
}
