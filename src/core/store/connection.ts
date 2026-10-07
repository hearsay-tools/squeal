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
    return Number(this.#statement(sql).run(...params).changes);
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
    this.db.exec(savepoint === null ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
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

  /** Idempotent. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#statements.clear();
    this.db.close();
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

/**
 * Rolls back the open transaction, if any. SQLite rolls back by itself after
 * some errors (busy, full, I/O), and `isTransaction` needs Node 22.16, so a
 * "no transaction is active" error here is expected and dropped; the caller
 * rethrows the error that caused the rollback.
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
