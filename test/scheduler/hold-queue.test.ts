import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import { Ledger } from "../../src/core/scheduler/ledger.js";
import { Priority } from "../../src/core/scheduler/queue.js";
import { createStateSink } from "../../src/core/state/index.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/index.js";
import {
  type CheckKey,
  DEFAULT_POLICY,
  type TestFileRef,
  type WorktreeId,
} from "../../src/core/types/index.js";

/*
 * Task 004-70 (review wave-8.1, "Restore edge cases", queue fidelity): a
 * rolled-back skip transaction puts its files' queue entries back with the
 * priority and place they had, and the promotions that held them, rather
 * than re-add them at no change's priority, where the first re-add settled
 * a promotion while its files were still out.
 */

const WORKTREE = "wt-004-70" as WorktreeId;
const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function ledger(): Ledger {
  const dir = mkdtempSync(join(tmpdir(), "sq-004-70-"));
  const store = openStore(dir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(store)) throw new Error(`store: ${JSON.stringify(store)}`);
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  cleanups.push(() => store.close());
  const context = {
    store,
    sink: createStateSink(store),
    worktreeId: WORKTREE,
    policy: DEFAULT_POLICY,
    now: Date.now,
    keys: { runnerOf: () => undefined },
  } as unknown as SchedulerContext;
  return new Ledger(context);
}

const UPPER: TestFileRef = { project: "", path: "test/upper.test.ts" };
const STRINGS: TestFileRef = { project: "", path: "test/strings.test.ts" };
const paths = (refs: readonly TestFileRef[]) => refs.map((ref) => ref.path);
const fileOf = (l: Ledger, ref: TestFileRef) => {
  const file = l.file(ref);
  if (file === undefined) throw new Error(`no file ${ref.path}`);
  return file;
};

/** The review's probe: a direct upper at 1000 ms ahead of a transitive strings at 1 ms, both forced, recent and promoted. */
function probe(): Ledger {
  const l = ledger();
  const upper = l.addFile(UPPER);
  const strings = l.addFile(STRINGS);
  upper.durationMs = 1000;
  strings.durationMs = 1;
  upper.resultKey = "u".repeat(64) as CheckKey;
  strings.resultKey = "s".repeat(64) as CheckKey;
  l.enqueue(upper, Priority.direct, true, true);
  l.enqueue(strings, Priority.transitive, true, true);
  l.queue.promote([UPPER, STRINGS], Date.now() + 60_000);
  expect(paths(l.ordered())).toEqual([UPPER.path, STRINGS.path]);
  return l;
}

describe("Ledger.hold's queue (task 004-70)", () => {
  it("keeps [upper, strings] and both promotions after a rollback", () => {
    const l = probe();
    const restore = l.hold([UPPER, STRINGS]);
    // What the transaction did before it rolled back: both out, a re-add that settles promotions.
    for (const ref of [UPPER, STRINGS]) l.dequeue(fileOf(l, ref));
    l.enqueue(fileOf(l, STRINGS), Priority.neverRun);
    restore();
    expect(paths(l.ordered())).toEqual([UPPER.path, STRINGS.path]);
    expect(l.queue.isPromoted(UPPER)).toBe(true);
    expect(l.queue.isPromoted(STRINGS)).toBe(true);
    expect(l.queue.isForced(UPPER) && l.queue.isRecent(STRINGS)).toBe(true);
    expect(l.file(UPPER)?.phase).toBe("queued");
  });

  it("restores the place among ties a re-add would lose, and leaves no entry the snapshot had not", () => {
    const l = ledger();
    const [a, b, c] = ["a", "b", "c"].map((name) =>
      l.addFile({ project: "", path: `test/${name}.test.ts` }),
    );
    if (a === undefined || b === undefined || c === undefined) throw new Error("no files");
    for (const file of [a, b, c]) l.enqueue(file, Priority.neverRun);
    const extra = l.addFile({ project: "", path: "test/d.test.ts" });
    const restore = l.hold([a.ref, b.ref, c.ref, extra.ref]);
    l.dequeue(a);
    l.enqueue(extra, Priority.failing);
    restore();
    expect(paths(l.ordered())).toEqual(["test/a.test.ts", "test/b.test.ts", "test/c.test.ts"]);
    expect(l.file(extra.ref)?.phase).toBeNull();
  });
});
