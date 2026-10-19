import { describe, expect, it } from "vitest";
import { publishSlowActivity } from "../../src/core/slow/state.js";
import { clockText, readHeader } from "../../src/core/state/index.js";
import type { FileHash, Store } from "../../src/core/types/index.js";
import {
  FAST,
  inTurn,
  keys,
  NOW,
  type Seeded,
  SLOW_A,
  SLOW_B,
  SLOW_POLICY,
  seed,
  slowLine,
  status,
} from "./slow-tier-seed.js";

/*
 * Spec 004 D8, task 004-48: the slow-tier line after the session ends, after
 * a daemon restart and after a revert (lessons, "Re-dogfood at 0.1.68",
 * defects 11, 12 and 15), and task 004-55: which changed paths are sources
 * (lessons, "Confirmation at 0.1.85", defect 18).
 */

const RUN_SLOW = "Squeal runs them after the fast tests; `squeal run --slow --wait 60000` waits for their results.";

/** Appends one revision changing `path` from `from` to `to` (`null`: absent). */
function _change(s: Seeded, path: string, from: FileHash | null, to: FileHash | null): void {
  s.store.revisions.append({
    worktreeId: s.repo.mainId,
    createdAt: 9,
    head: null,
    dirty: true,
    trigger: "watch",
    changes: [{ path, oldHash: from, newHash: to }],
  });
}

/** The stored closure of `testFile` names `paths`, as its last keying found it. */
function _closes(store: Store, testFile: string, paths: string[]): void {
  const ref = { project: "", path: testFile };
  const closure = {
    testFile: ref,
    paths,
    complete: false,
    method: "static imports plus declared inputs",
  } as const;
  store.testFiles.put({ testFile: ref, closure, updatedAt: 1, updatedBy: "test" });
}

describe("the slow-tier line after the session ends (lessons defect 11)", () => {
  it("says the slow files wait for fast test files, not the agent, when no consumer is registered", () => {
    const s = seed();
    keys(s.store, s.repo, { [SLOW_A]: "queued", [SLOW_B]: "queued", [FAST]: "queued" });
    publishSlowActivity(s.store, s.repo.mainId, { kind: "waiting", for: "idle" });
    expect(readHeader(s.store, s.repo.mainId).slowTier?.activity).toEqual({
      kind: "waiting",
      for: "fast",
    });
    expect(slowLine(status(s))).toBe(
      `Slow tier: 2 test files; 2 pending, waiting for fast test files. ${RUN_SLOW}`,
    );
  });

  it("names no wait when the registered consumers are idle and nothing fast is pending", () => {
    const s = seed();
    const consumer = inTurn(s);
    s.store.transaction(() => s.store.consumers.unregister(consumer));
    s.store.transaction(() => s.store.consumers.register({ ...consumer, sessionId: "s2" }, NOW));
    keys(s.store, s.repo, { [SLOW_A]: "queued", [SLOW_B]: "queued" });
    publishSlowActivity(s.store, s.repo.mainId, { kind: "waiting", for: "idle" });
    expect(readHeader(s.store, s.repo.mainId).slowTier?.activity).toBeNull();
    expect(slowLine(status(s))).toBe(`Slow tier: 2 test files; 2 pending. ${RUN_SLOW}`);
  });

  it("still says the agent while one consumer is in a turn", () => {
    const s = seed();
    inTurn(s);
    keys(s.store, s.repo, { [SLOW_A]: "queued", [SLOW_B]: "queued", [FAST]: "queued" });
    publishSlowActivity(s.store, s.repo.mainId, { kind: "waiting", for: "idle" });
    expect(slowLine(status(s))).toBe(
      `Slow tier: 2 test files; 2 pending, waiting for the agent to pause. ${RUN_SLOW}`,
    );
  });
});

describe("the slow-tier line after a daemon restart (lessons defect 12)", () => {
  // `seed`'s live daemon started at NOW - 60 s.
  const before = NOW - 120_000;

  it("never shows a run that started before the live daemon as running", () => {
    const s = seed();
    keys(s.store, s.repo, { [SLOW_A]: "running", [SLOW_B]: "queued" });
    publishSlowActivity(s.store, s.repo.mainId, {
      kind: "running",
      path: SLOW_A,
      since: before,
      lastDurationMs: null,
    });
    expect(readHeader(s.store, s.repo.mainId).slowTier?.activity).toBeNull();
    expect(slowLine(status(s))).toBe(`Slow tier: 2 test files; 2 pending. ${RUN_SLOW}`);
  });

  it("keeps a dead daemon's run as last reported while no daemon has started since", () => {
    const s = seed(SLOW_POLICY, { alive: false });
    keys(s.store, s.repo, { [SLOW_A]: "running", [SLOW_B]: "queued" });
    publishSlowActivity(s.store, s.repo.mainId, {
      kind: "running",
      path: SLOW_A,
      since: before,
      lastDurationMs: null,
    });
    expect(slowLine(status(s))).toContain(
      `; 2 pending, last reported running ${SLOW_A} since ${clockText(before)} (no earlier run).`,
    );
  });
});
