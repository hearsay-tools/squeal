import { Connection, rollback } from "../store/connection.js";

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

  /** Whether a held transaction is open. */
  get held(): boolean {
    return this.#held;
  }

  override transaction<T>(fn: () => T): T {
    if (!this.#held) return this.#plain(() => super.transaction(fn));
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
    this.db.exec("BEGIN IMMEDIATE");
    this.#held = true;
    let open = true;
    const end = () => {
      open = false;
      this.#held = false;
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

  #plain<T>(fn: () => T): T {
    this.#inside++;
    try {
      return fn();
    } finally {
      this.#inside--;
    }
  }
}
