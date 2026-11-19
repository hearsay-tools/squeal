import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { Statement } from "../daemon/write-batch.js";
import { rollback } from "../store/connection.js";
import type { WorktreeId } from "../types/common.js";

/*
 * Spec 021 D22.4 (row 021-36): a batch is written once. Each daemon numbers
 * its batches (`batchSeq`, rising), and whoever writes one, the store
 * process or the daemon itself when none serves, writes it in one
 * `BEGIN IMMEDIATE` transaction that first reads the worktree's mark in
 * `meta` and sets it with the batch's last statement. A batch whose number
 * is not above the mark was written already, or a later one of its worktree
 * was: it is skipped. The test and the write sit under SQLite's write lock,
 * so a batch the store process still holds when its client wrote it is
 * never written again, and never after a later batch of its worktree.
 */

/** The `meta` key of a worktree's mark: its last batch written. */
export function markKey(worktreeId: WorktreeId): string {
  return `store-process:${worktreeId}`;
}

const WIDTH = 11;

/**
 * A batch's number, `<start>-<counter>`, both base 36 and zero-padded, so
 * text order is number order: `start` is the client's start time in ms,
 * which rises from one daemon of a worktree to its next.
 */
export function batchSeq(start: number, counter: number): string {
  const part = (n: number) => Math.max(0, Math.floor(n)).toString(36).padStart(WIDTH, "0");
  return `${part(start)}-${part(counter)}`;
}

/** One write statement, as a batch holds it. */
export type GuardedStatement = Statement;

/** How a guarded write went: whole, skipped by the mark, or up to `next` in a slice. */
export type GuardedEnd =
  | { readonly end: "written" }
  | { readonly end: "superseded" }
  | { readonly end: "partial"; readonly next: number };

export interface GuardedSlice {
  /** The first statement to write; default 0. */
  readonly from?: number;
  /** A splittable batch commits once a slice has run this long, and goes on later from `next`. */
  readonly sliceMs?: number;
  /** Default `performance.now`. */
  readonly now?: () => number;
}

const MARK_READ = "SELECT value FROM meta WHERE key = ?";
const MARK_WRITE =
  "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value";

/**
 * Writes batches under the mark on one connection, with its statements
 * cached. The connection must allow writes (no `query_only`).
 */
export class GuardedWriter {
  readonly #db: DatabaseSync;
  readonly #statements = new Map<string, StatementSync>();

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  /** The worktree's mark; `null` with none. */
  mark(worktreeId: WorktreeId): string | null {
    const row = this.#statement(MARK_READ).get(markKey(worktreeId)) as
      | { value?: unknown }
      | undefined;
    return typeof row?.value === "string" ? row.value : null;
  }

  /**
   * Writes `statements` from `slice.from` in one transaction, unless the
   * worktree's mark is at `seq` or past it. With `slice.sliceMs`, commits
   * once that long has run and answers `partial`; the mark is set only with
   * the last statement, so a batch cut short is written again whole by
   * whoever writes it next: a splittable batch must be one whose statements
   * may run twice.
   */
  write(
    worktreeId: WorktreeId,
    seq: string,
    statements: readonly GuardedStatement[],
    slice: GuardedSlice = {},
  ): GuardedEnd {
    const now = slice.now ?? (() => performance.now());
    const started = now();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const mark = this.mark(worktreeId);
      if (mark !== null && mark >= seq) {
        this.#db.exec("COMMIT");
        return { end: "superseded" };
      }
      let at = slice.from ?? 0;
      for (; at < statements.length; at++) {
        const { sql, params } = statements[at] as GuardedStatement;
        this.#statement(sql).run(...params);
        const cut = slice.sliceMs !== undefined && now() - started >= slice.sliceMs;
        if (cut && at + 1 < statements.length) {
          this.#db.exec("COMMIT");
          return { end: "partial", next: at + 1 };
        }
      }
      this.#statement(MARK_WRITE).run(markKey(worktreeId), seq);
      this.#db.exec("COMMIT");
      return { end: "written" };
    } catch (error) {
      rollback(this.#db);
      throw error;
    }
  }

  #statement(sql: string): StatementSync {
    let statement = this.#statements.get(sql);
    if (statement === undefined) {
      statement = this.#db.prepare(sql);
      this.#statements.set(sql, statement);
    }
    return statement;
  }
}
