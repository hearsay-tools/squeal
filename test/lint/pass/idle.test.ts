import { describe, expect, it } from "vitest";
import { lintIdleIn } from "../../../src/core/lint/pass/index.js";
import { SLOW_RECHECK_MS } from "../../../src/core/scheduler/slow-tier.js";
import { DEFAULT_POLICY, type Store } from "../../../src/core/types/index.js";

/* Spec 017 D5: stale whole-program files lint when 004's slow trigger holds (approved 2026-10-26). */

/** A store with one revision at `createdAt` and no consumer. */
function storeAt(createdAt: number | null): Store {
  return {
    revisions: { latest: () => (createdAt === null ? null : { createdAt }) },
    consumers: { list: () => [] },
  } as unknown as Store;
}

function idleIn(
  createdAt: number | null,
  now: number,
  inUse: boolean,
  slow: Partial<typeof DEFAULT_POLICY.slow> = {},
) {
  return lintIdleIn({
    store: storeAt(createdAt),
    worktreeId: "w1",
    policy: () => ({ slow: { ...DEFAULT_POLICY.slow, ...slow } }),
    now: () => now,
    inUse: () => inUse,
  })();
}

describe("when stale files may lint (004's slow trigger)", () => {
  it("continuous: once the latest revision is slow.quietMs old and the scheduler has no work in use", () => {
    expect(idleIn(10_000, 11_000, false)).toBe(2_000);
    expect(idleIn(10_000, 13_000, false)).toBe(0);
    expect(idleIn(10_000, 13_000, true)).toBe(SLOW_RECHECK_MS);
    expect(idleIn(null, 0, false)).toBe(0);
    expect(idleIn(10_000, 10_500, false, { quietMs: 500 })).toBe(0);
  });

  it("idle: once no consumer is in a turn, whatever the revision's age", () => {
    expect(idleIn(10_000, 10_001, true, { trigger: "idle" })).toBe(0);
  });
});
