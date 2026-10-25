import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import type { FullCheck, FullCheckOutcome } from "../../src/core/daemon/full-check.js";
import { storePaths } from "../../src/core/store/index.js";
import type { EpochMs, Store } from "../../src/core/types/index.js";

/**
 * A full check that ends when the test says so; its stop ends it as a
 * stopped process does, with no answer.
 */
export function heldCheck(): FullCheck & {
  end: (outcome: FullCheckOutcome) => void;
  stopped: boolean;
} {
  let end!: (outcome: FullCheckOutcome) => void;
  const done = new Promise<FullCheckOutcome>((resolve) => {
    end = resolve;
  });
  const check = {
    pid: undefined,
    done,
    end: (outcome: FullCheckOutcome) => end(outcome),
    stopped: false,
    stop: () => {
      check.stopped = true;
      end({ unrun: "the check's process ended with SIGTERM" });
    },
  };
  return check;
}

/** A `startFullCheck` context that hands out `checks` in order, with what it noted and logged. */
export function checkContext(
  store: Store,
  commonDir: string,
  checks: readonly FullCheck[],
  now: () => EpochMs,
) {
  const notes: string[] = [];
  const logs: string[] = [];
  let runs = 0;
  return {
    notes,
    logs,
    runs: () => runs,
    context: {
      store,
      commonDir,
      now,
      note: (text: string) => void notes.push(text),
      log: (line: string) => void logs.push(line),
      run: () => {
        const check = checks[runs++];
        if (check === undefined) throw new Error("no full check left to run");
        return check;
      },
    },
  };
}

/** Another connection's write lock on the store, as a tier's write transaction holds it. */
export function holdWriter(commonDir: string): { release(): void } {
  const db = new DatabaseSync(storePaths(commonDir).database);
  db.exec("BEGIN IMMEDIATE");
  return {
    release: () => {
      db.exec("ROLLBACK");
      db.close();
    },
  };
}

/** Resolves once `fn` holds, polled every 10 ms; rejects after `timeoutMs`. */
export async function until(fn: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!fn()) {
    if (performance.now() > deadline) throw new Error(`not met in ${timeoutMs} ms`);
    await sleep(10);
  }
}
