import { afterEach, describe, expect, it } from "vitest";
import { Keeper } from "../../../src/core/code/gate/keep.js";
import type { Pause } from "../../../src/core/code/gate/keep-queue.js";
import { testFileId } from "../../../src/core/keys/reverse-index.js";
import type { CommitSha } from "../../../src/core/types/common.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";
import {
  A,
  freeStore,
  holdStore,
  inputs,
  KEY_A,
  RECORD,
  removeStores,
  report,
  resultsAt,
} from "./keep-busy-kit.js";

/*
 * Spec 020 D17.5 as amended by rows 020-59 and 020-64: once a busy store
 * refused a file's write, its inputs are read again after every pause and
 * before each of its writes, in every later pass. Row 020-64: the order of
 * the refusal, the move and the retry is driven by the keeper's own seams
 * (the pause between early passes, the `head` read that opens a pass),
 * never by a sleep. CI 43620018937 failed the timed case this replaces: its
 * early pass reached its first write only after the move and the release,
 * so the store never refused it, and the opening check had passed.
 */

afterEach(removeStores);

/** A promise and the function that resolves it. */
function signal<T = void>() {
  let fire!: (value: T) => void;
  const fired = new Promise<T>((resolve) => {
    fire = resolve;
  });
  return { fired, fire };
}

/** A pause the case ends: `asked` resolves with its length, `end` starts the next pass. */
function heldPauses() {
  const asked = signal<number>();
  let then: (() => void) | null = null;
  const pause: Pause = (ms, next) => {
    then = next;
    asked.fire(ms);
    return () => {
      then = null;
    };
  };
  const end = () => {
    if (then === null) throw new Error("no pause under way");
    then();
  };
  return { pause, asked: asked.fired, end };
}

function keeperAt(
  at: { root: string; commonDir: string },
  notes: string[],
  seams: { pause?: Pause; head?: () => Promise<void> },
) {
  return new Keeper({
    root: at.root,
    commonDir: at.commonDir,
    policy: { ...DEFAULT_POLICY, complexity: { ...DEFAULT_POLICY.complexity, enabled: true } },
    head: async () => {
      await seams.head?.();
      return { head: "a".repeat(40) as CommitSha, dirty: false };
    },
    note: (text) => notes.push(text),
    busyBoundMs: 600,
    ...(seams.pause === undefined ? {} : { pause: seams.pause }),
  });
}

/** One run of `ref`, which completed with a record. */
const ranOf = (ref: TestFileRef) => ({
  runner: "vitest" as const,
  files: [ref],
  report: report([ref]),
  records: new Map([[testFileId(ref), { record: RECORD }]]),
});

/** Resolves once `A`'s results are in the store; a wait for a state, not a timed order. */
async function landedA(commonDir: string): Promise<void> {
  for (let i = 0; resultsAt(commonDir, KEY_A) === 0; i++) {
    if (i >= 500) throw new Error("no results at KEY_A");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("an input that moves around a busy store's refusal (row 020-64)", () => {
  it("does not keep a file whose input moved between the refusal and the retry", async () => {
    const at = freeStore();
    const notes: string[] = [];
    const moving = inputs();
    const pauses = heldPauses();
    const keep = keeperAt(at, notes, { pause: pauses.pause });
    keep.expect("vitest", moving.keys, moving.hasher, new Map([[A, KEY_A]]));
    const held = await holdStore(at.commonDir);
    try {
      await keep.ran(ranOf(A));
      // A pass asks for a pause only once a write did not land: the store refused it.
      expect(await pauses.asked).toBe(250);
      expect(resultsAt(at.commonDir, KEY_A)).toBe(0);
      moving.move(A);
    } finally {
      held.release();
    }
    // The retry finds the store free; only its input check stands between it and the write.
    pauses.end();
    await keep.flush();

    expect(resultsAt(at.commonDir, KEY_A)).toBe(0);
    // Dropped as the opening check drops a file that moved after its run: no daemon lost a try.
    // Row 020-68: only the count after the last pass.
    expect(notes).toEqual([
      "0 of 1 completed test files are kept in the stores; the next run on the same bytes runs it",
    ]);
  });

  it("keeps a file whose input moved only after the retry wrote it", async () => {
    const at = freeStore();
    const notes: string[] = [];
    const moving = inputs();
    const pauses = heldPauses();
    const keep = keeperAt(at, notes, { pause: pauses.pause });
    keep.expect("vitest", moving.keys, moving.hasher, new Map([[A, KEY_A]]));
    const held = await holdStore(at.commonDir);
    try {
      await keep.ran(ranOf(A));
      expect(await pauses.asked).toBe(250);
    } finally {
      held.release();
    }
    pauses.end();
    await landedA(at.commonDir);
    moving.move(A);
    await keep.flush();

    expect(resultsAt(at.commonDir, KEY_A)).toBe(1);
    expect(notes).toEqual([
      "the 1 completed test file is kept in the stores (1 while the runs went on); the next run on the same bytes reads it from the stores",
    ]);
  });

  it("keeps a file whose input moved after its pass's opening check, when no write was refused", async () => {
    // The order of CI 43620018937: the pass checked the inputs, the input moved and the hold
    // ended, then the pass wrote. D17.5 owes a check before each write only from the first
    // try that did not land on; until then the pass's opening check holds.
    const at = freeStore();
    const notes: string[] = [];
    const moving = inputs();
    const opened = signal();
    const writes = signal();
    const keep = keeperAt(at, notes, {
      head: async () => {
        opened.fire();
        await writes.fired;
      },
    });
    keep.expect("vitest", moving.keys, moving.hasher, new Map([[A, KEY_A]]));
    const held = await holdStore(at.commonDir);
    await keep.ran(ranOf(A));
    await opened.fired;
    moving.move(A);
    held.release();
    writes.fire();
    await keep.flush();

    expect(resultsAt(at.commonDir, KEY_A)).toBe(1);
    expect(notes).toEqual([
      "the 1 completed test file is kept in the stores (1 while the runs went on); the next run on the same bytes reads it from the stores",
    ]);
  });
});
