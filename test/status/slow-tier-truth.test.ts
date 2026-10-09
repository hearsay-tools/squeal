import { describe, expect, it } from "vitest";
import { publishSlowActivity } from "../../src/core/slow/state.js";
import { clockText, readHeader } from "../../src/core/state/index.js";
import type { FileHash } from "../../src/core/types/index.js";
import {
  FAST,
  inTurn,
  keys,
  NOW,
  ran,
  type Seeded,
  SLOW_A,
  SLOW_B,
  SLOW_POLICY,
  seed,
  slowLine,
  states,
  status,
} from "./slow-tier-seed.js";

/*
 * Spec 004 D8, task 004-48: the slow-tier line after the session ends, after
 * a daemon restart and after a revert (lessons, "Re-dogfood at 0.1.68",
 * defects 11, 12 and 15).
 */

const RUN_SLOW = "Not covered by Stop's wait; `squeal run --slow` runs them now.";

/** Appends one revision changing `path` from `from` to `to` (`null`: absent). */
function change(s: Seeded, path: string, from: FileHash | null, to: FileHash | null): void {
  s.store.revisions.append({
    worktreeId: s.repo.mainId,
    createdAt: 9,
    head: null,
    dirty: true,
    trigger: "watch",
    changes: [{ path, oldHash: from, newHash: to }],
  });
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

describe("sources changed since, by content (lessons defect 15)", () => {
  /** Both slow files current at revision 2 against `plugins/**`. */
  function current(): Seeded {
    const s = seed(SLOW_POLICY, { revisions: 2, changes: ["plugins/a.js"] });
    states(s.store, s.repo, [{ observedAt: 2 }, { observedAt: 2 }], [SLOW_A, SLOW_B]);
    ran(s.store, s.repo, [SLOW_A, SLOW_B]);
    return s;
  }
  const clean = `Slow tier: 2 test files; 2 current against plugins/** as of revision 2. Not covered by Stop's wait.`;

  it("says no source changed after a revert to the tested bytes", () => {
    const s = current();
    change(s, "src/paths.ts", "h-tested", "h-edited");
    change(s, "src/paths.ts", "h-edited", "h-tested");
    expect(readHeader(s.store, s.repo.mainId).slowTier?.sourcesChangedSince).toBe(false);
    expect(slowLine(status(s))).toBe(clean);
  });

  it("says no source changed for a file made and removed since", () => {
    const s = current();
    change(s, "test/fixtures/node-test/.tmp/x/a.js", null, "h1");
    change(s, "test/fixtures/node-test/.tmp/x/a.js", "h1", null);
    expect(slowLine(status(s))).toBe(clean);
  });

  it("never takes squeal.config.json for a source of the artifact", () => {
    const s = current();
    change(s, "squeal.config.json", "h-config", "h-config-2");
    expect(slowLine(status(s))).toBe(clean);
  });

  it("says sources changed when an edit ends on other bytes than the tested ones", () => {
    const s = current();
    change(s, "src/paths.ts", "h-tested", "h-edited");
    change(s, "src/paths.ts", "h-edited", "h-edited-again");
    expect(slowLine(status(s))).toBe(
      `Slow tier: 2 test files; 2 current against plugins/** as of revision 2, sources changed since. Not covered by Stop's wait.`,
    );
  });
});
