import { describe, expect, it } from "vitest";
import { newFileState } from "../../src/core/scheduler/files.js";
import type { Ledger } from "../../src/core/scheduler/ledger.js";
import { RunQueue } from "../../src/core/scheduler/queue.js";
import { queueReruns, RERUN_CAP } from "../../src/core/scheduler/rerun.js";
import type { CheckKey } from "../../src/core/types/index.js";
import { ref } from "./helpers.js";

/** The ledger surface `queueReruns` uses, its queue and `enqueue`, and the notes it writes. */
function fake(rerunCap = RERUN_CAP, slow: readonly string[] = []) {
  const queue = new RunQueue();
  queue.setSlow((r) => slow.includes(r.path));
  const ledger = {
    queue,
    enqueue: (file, priority, forced) => queue.add(file.ref, priority, forced),
  } as Pick<Ledger, "queue" | "enqueue"> as Ledger;
  const notes: string[] = [];
  return { ledger, notes, context: { rerunCap, note: (text: string) => notes.push(text) } };
}

const K = "k1" as CheckKey;
const failure = (path: string, key = K, forced = false) => ({
  file: newFileState(ref(path)),
  key,
  forced,
});

describe("queueReruns (task 001-171)", () => {
  it("queues a forced re-run once per key, and again under a new key", () => {
    const { ledger, context } = fake();
    const a = failure("test/a.test.ts");
    queueReruns(context, ledger, [a]);
    expect(ledger.queue.isForced(a.file.ref)).toBe(true);

    ledger.queue.remove(a.file.ref);
    queueReruns(context, ledger, [a]);
    expect(ledger.queue.has(a.file.ref)).toBe(false);

    queueReruns(context, ledger, [{ ...a, key: "k2" as CheckKey }]);
    expect(ledger.queue.isForced(a.file.ref)).toBe(true);
  });

  it("re-runs no forced run's failure and no slow file", () => {
    const { ledger, context } = fake(RERUN_CAP, ["test/slow.test.ts"]);
    const forced = failure("test/a.test.ts", K, true);
    queueReruns(context, ledger, [forced, failure("test/slow.test.ts")]);
    expect(ledger.queue.size).toBe(0);
    // Nothing was spent: an unforced failure of the same key may still be re-run.
    queueReruns(context, ledger, [{ ...forced, forced: false }]);
    expect(ledger.queue.has(forced.file.ref)).toBe(true);
  });

  it("re-runs every new failure of a tier while the cap is unbounded", () => {
    const { ledger, context, notes } = fake();
    const many = Array.from({ length: 200 }, (_, i) => failure(`test/f${i}.test.ts`));
    queueReruns(context, ledger, many);
    expect(ledger.queue.size).toBe(200);
    expect(notes).toEqual([]);
  });

  it("re-runs none of a tier's new failures above the cap, with a note naming why", () => {
    const { ledger, context, notes } = fake(2);
    const three = ["a", "b", "c"].map((n) => failure(`test/${n}.test.ts`));
    queueReruns(context, ledger, three);
    expect(ledger.queue.size).toBe(0);
    expect(notes).toEqual([
      "3 test files failed anew in one tier, above the re-run cap of 2 per tier: none is " +
        "re-run, since a failure that wide is rarely caused by load " +
        "(test/a.test.ts, test/b.test.ts, test/c.test.ts)",
    ]);
    // Not spent either: at most the cap, counting only what is due, re-runs.
    queueReruns(context, ledger, [three[0] ?? expect.fail(), failure("test/d.test.ts", K, true)]);
    expect(ledger.queue.size).toBe(1);
  });
});
