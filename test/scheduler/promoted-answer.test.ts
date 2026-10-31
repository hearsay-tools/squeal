import { afterEach, describe, expect, it } from "vitest";
import { StatCache } from "../../src/core/hash/index.js";
import { writeRetries } from "../../src/core/retry/records.js";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import { Ledger } from "../../src/core/scheduler/ledger.js";
import { answeredOf } from "../../src/core/scheduler/promoted-tier.js";
import {
  type CheckKey,
  DEFAULT_POLICY,
  type Store,
  type WorktreeId,
} from "../../src/core/types/index.js";
import { liveDaemon } from "../delivery/fakes.js";
import { freshStore } from "../state/helpers.js";

/*
 * Row 011-283, review `reviews/0.1.384.md` B1: what the scheduler tells
 * `Promotions` of a selected file the wait has not seen queued. A result
 * at its key is its answer, unless a `squeal retry` is pending there, as
 * one the load gate holds (gh-127): that wait stays open for the run.
 */

const WT = "wt-011-283-answer" as WorktreeId;
const KEY = "a".repeat(64) as CheckKey;
const stores: Store[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function setup() {
  const store = freshStore();
  stores.push(store);
  liveDaemon(store, WT);
  const context = {
    root: "/repo/wt-011-283",
    store,
    worktreeId: WT,
    policy: DEFAULT_POLICY,
    now: () => 1_000_000,
    note: () => {},
    keys: { cache: new StatCache(), index: { key: () => null, keysReadAsOne: () => null } },
  } as unknown as SchedulerContext;
  const ledger = new Ledger(context);
  const ref = { project: "", path: "test/f.test.ts" };
  const file = ledger.addFile(ref);
  return { context, ledger, ref, file, store };
}

describe("answeredOf (review 0.1.384 B1)", () => {
  it("a result at its key is its answer; another key's, none, or no key is not", () => {
    const { context, ledger, ref, file } = setup();
    const facts = answeredOf(context, ledger);
    expect(facts(ref)).toEqual({ key: null, answered: false });
    file.key = KEY;
    expect(facts(ref)).toEqual({ key: KEY, answered: false });
    file.resultKey = "b".repeat(64) as CheckKey;
    expect(facts(ref)).toEqual({ key: KEY, answered: false });
    file.resultKey = KEY;
    expect(facts(ref)).toEqual({ key: KEY, answered: true });
    expect(facts({ project: "", path: "test/unlisted.test.ts" })).toEqual({
      key: null,
      answered: false,
    });
  });

  it("a retry pending at its key, as the load gate holds it, is no answer", () => {
    const { context, ledger, ref, file, store } = setup();
    file.key = KEY;
    file.resultKey = KEY;
    file.failing = true;
    writeRetries(store, [
      {
        id: "r1",
        testFile: ref,
        key: KEY,
        session: "s1",
        reason: "load",
        askedAt: 1_000_000,
        askedIn: WT,
        claim: null,
        end: null,
      },
    ]);
    expect(answeredOf(context, ledger)(ref)).toEqual({ key: KEY, answered: false });
  });
});
