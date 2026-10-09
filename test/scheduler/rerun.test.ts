import { describe, expect, it } from "vitest";
import { newFileState } from "../../src/core/scheduler/files.js";
import type { Ledger } from "../../src/core/scheduler/ledger.js";
import { RunQueue } from "../../src/core/scheduler/queue.js";
import { queueRerun } from "../../src/core/scheduler/rerun.js";
import type { CheckKey } from "../../src/core/types/index.js";
import { ref } from "./helpers.js";

/** The ledger surface `queueRerun` uses: its queue and `enqueue`. */
function fakeLedger(slow: readonly string[] = []) {
  const queue = new RunQueue();
  queue.setSlow((r) => slow.includes(r.path));
  return {
    queue,
    enqueue: (file, priority, forced) => queue.add(file.ref, priority, forced),
  } as Pick<Ledger, "queue" | "enqueue"> as Ledger;
}

const K = "k1" as CheckKey;

describe("queueRerun (task 001-171)", () => {
  it("queues a forced re-run once per key, and again under a new key", () => {
    const ledger = fakeLedger();
    const file = newFileState(ref("test/a.test.ts"));
    queueRerun(ledger, file, K, false);
    expect(ledger.queue.isForced(file.ref)).toBe(true);

    ledger.queue.remove(file.ref);
    queueRerun(ledger, file, K, false);
    expect(ledger.queue.has(file.ref)).toBe(false);

    queueRerun(ledger, file, "k2" as CheckKey, false);
    expect(ledger.queue.isForced(file.ref)).toBe(true);
  });

  it("re-runs no forced run's failure and no slow file", () => {
    const ledger = fakeLedger(["test/slow.test.ts"]);
    const forced = newFileState(ref("test/a.test.ts"));
    queueRerun(ledger, forced, K, true);
    const slow = newFileState(ref("test/slow.test.ts"));
    queueRerun(ledger, slow, K, false);
    expect(ledger.queue.size).toBe(0);
    // Nothing was spent: an unforced failure of the same key may still be re-run.
    queueRerun(ledger, forced, K, false);
    expect(ledger.queue.has(forced.ref)).toBe(true);
  });
});
