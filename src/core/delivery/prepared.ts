import type { HeldTransaction, HoldingConnection } from "./held-connection.js";

/**
 * Row 011-288: a report a delivery prepared. Its writes, and with them every
 * "told" record, are in a transaction still open: `commit` once the hook
 * handed the text to the host, `abandon` when it cannot, so the report stays
 * owed and the next eligible boundary delivers it.
 */
export interface PreparedReport {
  commit(): void;
  abandon(): void;
  /** Whether it still waits for its verdict. */
  readonly open: boolean;
}

/**
 * The reports one hook context prepared, in order (`DeliveryOptions.prepare`).
 * Each is ended once: a later `commit` or `abandon` does nothing to it.
 */
export class PreparedReports {
  #reports: PreparedReport[] = [];

  add(report: PreparedReport): void {
    this.#reports.push(report);
  }

  /** Whether a report waits for its verdict. */
  get pending(): boolean {
    return this.#reports.some((report) => report.open);
  }

  /** Commits each in order; when one throws, abandons the rest and rethrows. */
  commit(): void {
    const reports = this.#take();
    for (const [i, report] of reports.entries()) {
      try {
        report.commit();
      } catch (error) {
        abandonAll(reports.slice(i + 1));
        throw error;
      }
    }
  }

  /** Abandons each, the last first. Never throws: an abandon that fails leaves its rollback to SQLite. */
  abandon(): void {
    abandonAll(this.#take());
  }

  #take(): PreparedReport[] {
    const reports = this.#reports;
    this.#reports = [];
    return reports;
  }
}

function abandonAll(reports: readonly PreparedReport[]): void {
  for (const report of [...reports].reverse()) {
    try {
      report.abandon();
    } catch {
      // The connection's close, or the process's end, rolls it back.
    }
  }
}

/** Where a delivery holds its transaction and leaves the report it prepared. */
export interface Prepare {
  /** The store's connection, made by `openStore`'s `connection` option. */
  readonly connection: HoldingConnection;
  readonly reports: PreparedReports;
}

/** A code-store write a delivery holds beside its own (`TellCodeOptions.holds`). */
export type CodeHolds = HeldTransaction[];

/** Commits each code-store hold in order; the first that throws stops the rest, which roll back. */
export function commitHolds(holds: CodeHolds): void {
  for (const [i, held] of holds.entries()) {
    try {
      held.commit();
    } catch (error) {
      rollbackHolds(holds.slice(i + 1));
      throw error;
    }
  }
}

export function rollbackHolds(holds: CodeHolds): void {
  for (const held of [...holds].reverse()) {
    try {
      held.rollback();
    } catch {
      // Closed with it.
    }
  }
}

/** A delivery's hold, opened before its transaction (`startHold`). */
export interface ReportHold {
  /** Where its code-store writes are held; `undefined` when nothing is held. */
  readonly code: CodeHolds | undefined;
  /** Takes the delivery's result once its transaction returned, and returns it. */
  settle<T>(report: T | null, acknowledge: () => void): T | null;
}

const NO_HOLD: ReportHold = {
  code: undefined,
  settle(report, acknowledge) {
    acknowledge();
    return report;
  },
};

/**
 * Row 011-288: opens a delivery's hold on `prepare`'s connection, before the
 * delivery's own `transaction`, which then runs as a savepoint in it. The
 * report is in `prepare.reports` from the start, so a delivery that throws
 * is abandoned with the hook's other reports; one that never settled is
 * abandoned at its commit too. A delivery that tells nothing commits at its
 * `settle`, so the writes of a silent boundary (seen, turn state) are never
 * held. Inside a hold already open, only the code-store writes and the lint
 * acknowledgement wait, for that hold's verdict. Without `prepare`,
 * nothing is held and `settle` acknowledges at once.
 */
export function startHold(prepare: Prepare | undefined): ReportHold {
  if (prepare === undefined) return NO_HOLD;
  const held = prepare.connection.hold();
  if (held === null && !prepare.connection.held) return NO_HOLD;
  const code: CodeHolds = [];
  let acknowledge: (() => void) | null = null;
  let ended = false;
  const abandon = () => {
    if (ended) return;
    ended = true;
    held?.rollback();
    rollbackHolds(code);
  };
  const commit = () => {
    if (ended) return;
    if (acknowledge === null) return abandon();
    ended = true;
    try {
      held?.commit();
    } catch (error) {
      rollbackHolds(code);
      throw error;
    }
    commitHolds(code);
    acknowledge();
  };
  prepare.reports.add({
    commit,
    abandon,
    get open() {
      return !ended;
    },
  });
  return {
    code,
    settle(report, then) {
      acknowledge = then;
      if (held !== null && report === null) commit();
      return report;
    },
  };
}
