import type { FileState } from "./files.js";

/**
 * Row 018-12 (spec 018 wave 3.6, the human 2026-11-09): the test files that
 * explicit requests asked for (`run --all`, `run --fast`, `run <group>`, a
 * narrow run, a claimed `squeal retry`) and that have not ended, and how
 * many ends of them there were. Each end is activity for the idle exit
 * (`startTimers`), so a daemon with no consumer serves a request that keeps
 * making progress. Only ends count: a file that never ends keeps no daemon.
 * The scheduler's own work (a baseline, catch-up, an edit's run, a re-run)
 * asks nothing.
 *
 * Review wave 3.6, B2: an end is the ledger's event (`Ledger.ends`), heard
 * where the file got a result or was marked `unknown`, never read later
 * from its phase. Review wave 3.6-r2, B2-R1: the ledger tells only an end
 * the requests' records accepted (`Checkpoints.done`, a retry's
 * `endRetry`), so this judges nothing. A file that leaves the queue otherwise (unkeyed,
 * withdrawn, gone) leaves its ask at the next commit with no end, so a
 * later run of it, the scheduler's own, cannot stand for the request.
 */
export class RequestProgress {
  /** By `FileState.id`: the asked files still queued or running. */
  readonly #open = new Map<string, FileState>();
  #ended = 0;

  /** How many ends of asked files there were, a running count. */
  get count(): number {
    return this.#ended;
  }

  /** A request asked for `files`: those queued or running are asked until they end. */
  ask(files: Iterable<FileState>): void {
    for (const file of files) if (file.phase !== null) this.#open.set(file.id, file);
  }

  /**
   * `file` got a result, from a run or a lookup, or was marked `unknown`,
   * and the requests' own records accepted it (`FileEnds.ended`; spec 001
   * D7: a result at any key, a forced request's only from its own run): an
   * asked file ends, once. What queues it again after is not the request's.
   */
  ended(file: FileState): void {
    if (this.#open.get(file.id) !== file) return;
    this.#open.delete(file.id);
    this.#ended += 1;
  }

  /**
   * A commit closed a round of the ledger's work: an asked file neither
   * queued nor running, or gone from `files`, left with no end. Within the
   * round a run's end may put its file back in the queue (a discard, a
   * split), which is the request's work still.
   */
  committed(files: ReadonlyMap<string, FileState>): void {
    for (const [id, file] of this.#open) {
      if (files.get(id) !== file || file.phase === null) this.#open.delete(id);
    }
  }
}
