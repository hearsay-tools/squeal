import type { FileState } from "./files.js";
import type { Ledger } from "./ledger.js";

/**
 * Row 018-12 (spec 018 wave 3.6, the human 2026-11-09): the test files that
 * explicit requests queued (`run --all`, `run --fast`, `run <group>`,
 * `squeal retry`) and that have not ended, and how many that were asked have
 * ended. Each end is activity for the idle exit (`startTimers`), so a daemon
 * with no consumer serves a request that keeps making progress. Only ends
 * count: a file that never ends keeps no daemon. The scheduler's own work (a
 * baseline, catch-up, a re-run) asks nothing.
 */
export class RequestProgress {
  /** By `FileState.id`: the asked files still queued or running. */
  readonly #open = new Map<string, FileState>();
  #ended = 0;

  /** A request queued: the files of `ledger` that `asked` selects and are queued or running. */
  ask(ledger: Ledger, asked: (file: FileState) => boolean): void {
    for (const file of ledger.files.values()) {
      if (file.phase !== null && asked(file)) this.#open.set(file.id, file);
    }
  }

  /**
   * Counts the asked files that ended since the last call and returns the
   * running count. A file the ledger dropped did not end; with no ledger,
   * the count as it stands.
   */
  ended(ledger: Ledger | null): number {
    if (ledger === null) return this.#ended;
    for (const [id, file] of this.#open) {
      if (ledger.files.get(id) !== file) {
        this.#open.delete(id);
      } else if (file.phase === null) {
        this.#open.delete(id);
        this.#ended += 1;
      }
    }
    return this.#ended;
  }
}
