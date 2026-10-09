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

  it("re-runs a tier's new failures up to the default cap of 8, and none of 9, with one note", () => {
    expect(RERUN_CAP).toBe(8);
    const eight = fake();
    queueReruns(
      eight.context,
      eight.ledger,
      Array.from({ length: 8 }, (_, i) => failure(`test/f${i}.test.ts`)),
    );
    expect(eight.ledger.queue.size).toBe(8);
    expect(eight.notes).toEqual([]);

    const nine = fake();
    queueReruns(
      nine.context,
      nine.ledger,
      Array.from({ length: 9 }, (_, i) => failure(`test/f${i}.test.ts`)),
    );
    expect(nine.ledger.queue.size).toBe(0);
    expect(nine.notes).toEqual([
      "9 test files failed anew in one tier, more than the 8 Squeal re-runs: a mass break is " +
        "not re-run (test/f0.test.ts, test/f1.test.ts, test/f2.test.ts, test/f3.test.ts, " +
        "test/f4.test.ts and 4 more)",
    ]);
  });

  it("counts only the failures due: forced and slow ones leave room under the cap", () => {
    const { ledger, context, notes } = fake(2, ["test/slow.test.ts"]);
    const due = ["a", "b"].map((n) => failure(`test/${n}.test.ts`));
    queueReruns(context, ledger, [
      ...due,
      failure("test/c.test.ts", K, true),
      failure("test/slow.test.ts"),
    ]);
    expect(ledger.queue.size).toBe(2);
    expect(notes).toEqual([]);
  });
});
