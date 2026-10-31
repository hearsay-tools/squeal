import { afterEach, describe, expect, it } from "vitest";
import { StatCache } from "../../src/core/hash/index.js";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import { Ledger } from "../../src/core/scheduler/ledger.js";
import { Priority } from "../../src/core/scheduler/queue.js";
import { NONE_CUT } from "../../src/core/scheduler/sharing.js";
import { selectTier } from "../../src/core/scheduler/tiers.js";
import { createStateSink } from "../../src/core/state/index.js";
import {
  type CheckKey,
  DEFAULT_POLICY,
  type Store,
  type TestFileRef,
  type WorktreeId,
} from "../../src/core/types/index.js";
import { liveDaemon } from "../delivery/fakes.js";
import { freshStore } from "../state/helpers.js";

/*
 * Row 011-283 (011-273 option B, rule 2; review `reviews/0.1.378-r2.md`
 * N1): a focused tier of a named wait's group is that group's tier. It
 * does not go before a due post-batch turn, it does not count toward the
 * four first-group tiers, and the backlog's turn follows it. A focused
 * entry of no wait's group stays a first-group tier (row 011-145).
 * `selectTier` on a `Ledger`, one lane, no pool, a runner that focuses.
 */

const WT = "wt-011-283" as WorktreeId;
const stores: Store[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function setup() {
  const store = freshStore();
  stores.push(store);
  liveDaemon(store, WT);
  const at = { now: 1_000_000 };
  const context = {
    root: "/repo/wt-011-283",
    store,
    sink: createStateSink(store),
    worktreeId: WT,
    policy: DEFAULT_POLICY,
    now: () => at.now,
    note: () => {},
    runsDir: "/repo/.git/squeal/runs",
    hostLoad: () => ({ oneMinute: null, cpus: 1 }),
    runner: { focuses: true },
    keys: {
      runnerOf: () => undefined,
      runtimeIdentity: () => "",
      writeRuntimeApplications: () => {},
      index: { key: () => null, keysReadAsOne: () => null },
      cache: new StatCache(),
      stabilityPaths: () => [],
      beginRun: () => 1,
      endRun: () => {},
    },
  } as unknown as SchedulerContext;
  return { ledger: new Ledger(context), context, at };
}

/** A listed file of `path` at a key of its own, queued as an edit's work, the backlog, or not at all. */
function file(ledger: Ledger, path: string, queued: "edit" | "backlog" | null): TestFileRef {
  const ref = { project: "", path };
  const state = ledger.addFile(ref);
  state.key = Buffer.from(path).toString("hex").padEnd(64, "0") as CheckKey;
  if (queued !== null) {
    const edit = queued === "edit";
    ledger.enqueue(state, edit ? Priority.edited : Priority.transitive, false, edit);
  }
  return ref;
}

/** A named `--check` wait on `refs`: its promotion and its focused entries, as the CLI sends them. */
function focusedWait(ledger: Ledger, at: { now: number }, refs: readonly TestFileRef[]): void {
  ledger.queue.promote(refs, at.now + 60_000);
  for (const ref of refs) ledger.queue.focused.add(ref, ["runs"], at.now + 60_000);
}

function next(context: SchedulerContext, ledger: Ledger): string {
  const tier = selectTier(context, ledger, new Set(), NONE_CUT);
  if (tier === null) return "none";
  return `${tier.kind} ${tier.files.map((f) => f.file.ref.path.slice(5, -8)).join(",")}`;
}

describe("a focused tier of a group and the backlog's turn (row 011-283, test 6)", () => {
  it("a focused tier of a batch while the post-batch turn is due: the turn first, then the focused tier, then the turn again", () => {
    const { ledger, context, at } = setup();
    for (const name of ["b1", "b2", "b3", "b4", "b5"])
      file(ledger, `test/${name}.test.ts`, "backlog");
    const p = file(ledger, "test/p.test.ts", "backlog");
    ledger.queue.promote([p], at.now + 60_000);
    file(ledger, "test/e.test.ts", "edit");
    expect(next(context, ledger)).toBe("backlog p");
    // A `--check` wait on F, which nothing queues, comes while the post-batch turn is due.
    focusedWait(ledger, at, [file(ledger, "test/f.test.ts", null)]);
    expect(next(context, ledger)).toBe("turn b1,b2,b3,b4");
    expect(next(context, ledger)).toBe("focused f");
    expect(next(context, ledger)).toBe("turn b5");
    expect(next(context, ledger)).toBe("edit e");
  });

  it("a focused tier of a group makes the backlog's turn due and counts not toward the four", () => {
    const { ledger, context, at } = setup();
    file(ledger, "test/b.test.ts", "backlog");
    for (const name of ["e1", "e2", "e3", "e4", "e5"]) file(ledger, `test/${name}.test.ts`, "edit");
    focusedWait(ledger, at, [file(ledger, "test/f.test.ts", null)]);
    expect(next(context, ledger)).toBe("focused f");
    expect(next(context, ledger)).toBe("turn b");
    expect(ledger.queue.backlogTurn()).toBe(false);
  });

  it("a focused entry of no wait's group still counts as a first-group tier (row 011-145)", () => {
    const { ledger, context, at } = setup();
    file(ledger, "test/b.test.ts", "backlog");
    file(ledger, "test/e.test.ts", "edit");
    const f = file(ledger, "test/f.test.ts", null);
    ledger.queue.focused.add(f, ["runs"], at.now + 60_000);
    expect(next(context, ledger)).toBe("focused f");
    expect(ledger.queue.batchTurn()).toBe(false);
    expect(next(context, ledger)).toMatch(/^edit e/);
  });
});
