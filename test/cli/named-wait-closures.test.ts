import { describe, expect, it, vi } from "vitest";
import { selectNamedFiles } from "../../src/cli/named-selection.js";
import { waitForNamed } from "../../src/cli/status-wait-paths.js";
import { CLOSURE_METHOD } from "../../src/core/keys/closure.js";
import { markClosureWrite } from "../../src/core/store/closure-writes.js";
import type { openStore as OpenStore } from "../../src/core/store/open.js";
import type { Store } from "../../src/core/types/store.js";
import { check, state } from "../status/helpers.js";
import { claimAll, recordClosures } from "./closure-trust.js";
import {
  ALL,
  answeringReaders,
  RUNTIME_READERS,
  SPAWNED,
  START,
  TYPES,
} from "./source-path-fixture.js";
import { finish, key, NOW, ref, repoWith } from "./status-wait-fixture.js";

/*
 * Row 011-44 (from 011-42): a named wait on a source path the daemon does not
 * answer reads every stored closure at its first poll, then again only on
 * the poll after a closure was recorded; its selection is a full read's.
 */

/** Each store the wait opened, one a poll, with its calls of `testFiles.list`; `opened` runs at each. */
const { polls, hooks } = vi.hoisted(() => ({
  polls: [] as { lists: number }[],
  hooks: { opened: (_n: number) => {} },
}));

vi.mock("../../src/core/store/open.js", async (importOriginal) => {
  const original = await importOriginal<{ openStore: typeof OpenStore }>();
  const openStore: typeof OpenStore = (commonDir, options) => {
    const opened = original.openStore(commonDir, options);
    if (!("testFiles" in opened)) return opened;
    const poll = { lists: 0 };
    polls.push(poll);
    hooks.opened(polls.length);
    const store = opened as { -readonly [K in keyof Store]: Store[K] };
    const { testFiles } = store;
    store.testFiles = {
      ...testFiles,
      list: () => {
        poll.lists++;
        return testFiles.list();
      },
    };
    return store;
  };
  return { ...original, openStore };
});

/** The reader whose run the wait holds for; the one whose closure a write changes. */
const HELD = RUNTIME_READERS[0] ?? "";
const CHANGED = RUNTIME_READERS[1] ?? "";

/** W with every closure stored but `SPAWNED`'s, and `HELD` queued, which ends the wait once it ran. */
function waiting() {
  const { repo, store } = repoWith([], ALL);
  const w = repo.mainId;
  recordClosures(
    store,
    ALL.filter((p) => p !== SPAWNED),
    w,
  );
  key(store, w, HELD, "queued");
  // W's daemon is of this release: it claimed its states marker, so the closure marker is trusted.
  claimAll(store);
  store.knownStates.upsertMany([
    state(w, check(HELD, "holds"), { validity: "pending", pendingPhase: "queued" }),
  ]);
  return { repo, store, w };
}

/** `CHANGED`'s closure recorded without `START`. */
function dropStart(store: Store, w: string) {
  store.testFiles.put({
    testFile: ref(CHANGED),
    closure: {
      testFile: ref(CHANGED),
      paths: [CHANGED, TYPES] as never,
      complete: false,
      method: CLOSURE_METHOD,
    },
    updatedAt: NOW,
    updatedBy: w,
  });
  markClosureWrite(store);
}

const CASES = [
  { name: "adds the path", write: (s: Store, w: string) => recordClosures(s, [SPAWNED], w), n: 13 },
  { name: "drops the path", write: dropStart, n: 11 },
];

describe("a named wait on a source path keeps its closures across polls (row 011-44)", () => {
  it.each(CASES)("reads them again on the poll after a closure that $name", async (c) => {
    const { repo, store, w } = waiting();
    polls.length = 0;
    // After the third poll's read the closure is recorded; after the sixth, `HELD` ran.
    hooks.opened = (n) => {
      if (n === 3) setTimeout(() => c.write(store, w), 0);
      if (n === 6) setTimeout(() => finish(store, w, HELD), 0);
    };
    const options = { timeoutMs: 5_000, pollMs: 20, settleMs: 100, now: () => NOW };
    const wait = await waitForNamed(repo.main, [START], {
      ...options,
      sync: answeringReaders(false).sync,
    });
    if (wait.outcome === "unavailable") throw new Error("unavailable");
    const lists = polls.map((p) => p.lists);
    // One list at the first poll, one at the poll after the write, none at the others.
    expect(lists.length).toBeGreaterThanOrEqual(7);
    expect(lists.slice(0, 7)).toEqual([1, 0, 0, 1, 0, 0, 0]);
    expect(lists.slice(7).every((n) => n === 0)).toBe(true);
    expect([wait.outcome, wait.selection.files.length]).toEqual(["settled", c.n]);
    expect(wait.selection).toEqual(selectNamedFiles(store, w, repo.main, repo.main, [START]));
  });
});
