import type { DatabaseSync } from "node:sqlite";
import type { Statement } from "../daemon/write-batch.js";
import { type Params, type Row, rollback } from "../store/connection.js";
import { type HeldTransaction, HoldingConnection } from "./held-connection.js";
import { overlaidMeta } from "./sent-meta.js";

/**
 * Where a `SendingConnection` sends its writes (`DaemonWriter`): the lease
 * the writes are decided under, and the daemon that writes them.
 */
export interface WriteSender {
  /** Whether this client holds the worktree's write lease. */
  readonly leased: boolean;
  /** Writes `batch` through the daemon; `release` ends the lease once it is written. */
  send(batch: readonly Statement[], release: boolean): Promise<SendOutcome>;
  /** Ends the lease, if held. */
  release(): Promise<void>;
}

/** How a sent batch went: written by the daemon, or not taken by any daemon (written here instead). */
export type SendOutcome = "written" | "not-taken";

/**
 * Thrown by a write that comes before the worktree's write lease is held:
 * nothing is kept yet. `SendingConnection.unit` takes the lease and runs
 * the work again.
 */
export class NeedsLease extends Error {
  constructor() {
    super("squeal: a store write needs the worktree's write lease first");
  }
}

/**
 * Spec 021 D15 (row 021-16): a hook's store connection while a daemon
 * serves its worktree. It reads as `Connection` does and never writes: each
 * outermost transaction's statements go, once it ends, to the daemon as one
 * batch (`WriteSender`), which writes them in its retried path, and
 * `query_only` refuses any write that would pass by `run`. A hold (row
 * 011-288) keeps its batch, and every batch after it, until its commit,
 * which is after the host has the report; its rollback drops them, so the
 * report stays owed. The worktree's write lease stands in for SQLite's
 * write lock: no two clients decide on the same rows at once.
 *
 * Its reads see the store as committed, so a read waits for the batches
 * before it to be written (`unit`, `sent`) and fails when they are not; a
 * hold's own writes in `meta`, where each consumer's told state lives
 * (`slots.ts`), are read back from the hold (`overlaidMeta`).
 *
 * When no daemon takes the writes, it becomes the `HoldingConnection` it
 * extends, before its first write, and writes the store itself.
 */
export class SendingConnection extends HoldingConnection {
  #direct = false;
  #depth = 0;
  #batch: Statement[] = [];
  #held: Statement[] | null = null;
  /** Batches sent outside a hold and not yet written. */
  #unsent = 0;
  readonly #sending = new Set<Promise<unknown>>();
  #failure: unknown = null;
  #closing = false;
  readonly #sender: WriteSender;

  constructor(db: DatabaseSync, sender: WriteSender) {
    super(db);
    this.#sender = sender;
    db.exec("PRAGMA query_only = 1");
  }

  /** Whether the store is written here: no daemon took the writes. */
  get direct(): boolean {
    return this.#direct;
  }

  override get held(): boolean {
    return this.#direct ? super.held : this.#held !== null;
  }

  /**
   * Runs `work`, then waits until its batches are written and ends the lease
   * unless a hold keeps it. A write before the lease (`NeedsLease`) takes
   * it, through `acquire`, and runs `work` again: nothing was kept by then.
   * `acquire` says whether a daemon took the lease; when none does, this
   * connection writes the store itself from then on.
   */
  async unit<T>(work: () => T | Promise<T>, acquire: () => Promise<boolean>): Promise<T> {
    for (let tries = 0; ; tries++) {
      try {
        const result = await work();
        await this.settle();
        return result;
      } catch (error) {
        if (!(error instanceof NeedsLease) || tries > 0) {
          await this.settle().catch(() => {});
          throw error;
        }
        if (!(await acquire())) this.#becomeDirect();
      }
    }
  }

  /** Writes the store here from now on: no daemon serves. Before any write. */
  writeDirectly(): void {
    this.#becomeDirect();
  }

  /** Waits until every batch sent so far is written, then ends the lease unless a hold keeps it. */
  async settle(): Promise<void> {
    await this.sent();
    if (!this.#direct && this.#held === null && this.#sender.leased) await this.#sender.release();
  }

  /** Waits until every batch sent so far is written; rethrows the first that failed. */
  async sent(): Promise<void> {
    while (this.#sending.size > 0) await Promise.allSettled([...this.#sending]);
    const failure = this.#failure;
    this.#failure = null;
    if (failure !== null) throw failure;
  }

  override run(sql: string, ...params: Params): number {
    if (this.#direct) return super.run(sql, ...params);
    if (this.#depth > 0) {
      this.#batch.push({ sql, params });
      return 0;
    }
    return this.transaction(() => this.run(sql, ...params));
  }

  override get(sql: string, ...params: Params): Row | null {
    if (this.#direct) return super.get(sql, ...params);
    this.#readable();
    const overlaid = overlaidMeta(sql, params, this.#pending());
    return overlaid === undefined ? super.get(sql, ...params) : overlaid;
  }

  override all(sql: string, ...params: Params): Row[] {
    if (this.#direct) return super.all(sql, ...params);
    this.#readable();
    return super.all(sql, ...params);
  }

  override transaction<T>(fn: () => T): T {
    if (this.#direct) return super.transaction(fn);
    const outer = this.#depth === 0;
    if (outer) {
      if (this.#held === null && !this.#sender.leased) throw new NeedsLease();
      this.#readable();
      this.db.exec("BEGIN");
    }
    const mark = this.#batch.length;
    this.#depth++;
    try {
      const result = fn();
      if (outer) {
        this.db.exec("COMMIT");
        this.#end(this.#batch);
      }
      return result;
    } catch (error) {
      this.#batch.length = mark;
      if (outer) {
        this.#batch = [];
        rollback(this.db);
      }
      throw error;
    } finally {
      this.#depth--;
    }
  }

  override read<T>(fn: () => T): T {
    if (this.#direct) return super.read(fn);
    if (this.#depth > 0) return fn();
    this.#readable();
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

  /**
   * Keeps every batch from now until the hold's commit, which sends them as
   * one and ends the lease once they are written; its rollback drops them
   * and ends the lease. `null` inside a transaction or a hold, as
   * `HoldingConnection.hold` is. Needs the lease (`NeedsLease`).
   */
  override hold(): HeldTransaction | null {
    if (this.#direct) return super.hold();
    if (this.#held !== null || this.#depth > 0) return null;
    if (!this.#sender.leased) throw new NeedsLease();
    this.#readable();
    const held: Statement[] = [];
    this.#held = held;
    let open = true;
    return {
      commit: () => {
        if (!open) return;
        open = false;
        this.#held = null;
        this.#track(this.#send(held, true), false);
      },
      rollback: () => {
        if (!open) return;
        open = false;
        this.#held = null;
        this.#track(this.#sender.release(), false);
      },
    };
  }

  override heldElsewhere(): Promise<void> | null {
    return this.#direct ? super.heldElsewhere() : null;
  }

  /** Closes once every batch sent is written, since one the daemon does not take is written here. */
  override close(): void {
    this.#held = null;
    if (this.#sending.size === 0) {
      super.close();
      return;
    }
    if (this.#closing) return;
    this.#closing = true;
    void Promise.allSettled([...this.#sending]).then(() => super.close());
  }

  /** A read now would miss writes not yet written: it must wait for them (`sent`). */
  #readable(): void {
    if (this.#unsent > 0) {
      throw new Error("squeal: a store read before this hook's writes were written (await sent())");
    }
  }

  /** What a read here must see before the store has it: the hold's batch, then the open one. */
  #pending(): readonly Statement[] {
    if (this.#held === null) return this.#depth > 0 ? this.#batch : [];
    return this.#depth > 0 ? [...this.#held, ...this.#batch] : this.#held;
  }

  #end(batch: Statement[]): void {
    this.#batch = [];
    if (batch.length === 0) return;
    if (this.#held !== null) this.#held.push(...batch);
    else this.#track(this.#send(batch, false), true);
  }

  /** Sends `batch`; when no daemon takes it, writes it here and stays direct. */
  async #send(batch: readonly Statement[], release: boolean): Promise<void> {
    if (batch.length === 0) {
      if (release) await this.#sender.release();
      return;
    }
    if ((await this.#sender.send(batch, release)) === "written") return;
    this.#becomeDirect();
    super.transaction(() => {
      for (const { sql, params } of batch) super.run(sql, ...params);
    });
  }

  #track(sending: Promise<unknown>, unsent: boolean): void {
    if (unsent) this.#unsent++;
    const tracked = sending.then(
      () => {},
      (error: unknown) => {
        this.#failure ??= error;
      },
    );
    const done = tracked.finally(() => {
      if (unsent) this.#unsent--;
      this.#sending.delete(done);
    });
    this.#sending.add(done);
  }

  /** From now on the store is written here, as `HoldingConnection` writes it. */
  #becomeDirect(): void {
    if (this.#direct) return;
    this.#direct = true;
    this.db.exec("PRAGMA query_only = 0");
  }
}
