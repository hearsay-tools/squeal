import { describe, expect, it } from "vitest";
import { createDelivery } from "../../../src/core/delivery/delivery.js";
import { lintIdleIn, lintPauseIn } from "../../../src/core/lint/pass/idle.js";
import { SLOW_RECHECK_MS } from "../../../src/core/scheduler/slow-tier.js";
import type { EpochMs } from "../../../src/core/types/common.js";
import type { Consumer } from "../../../src/core/types/delivery.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";
import type { Store } from "../../../src/core/types/store.js";
import { fixedStatus } from "../../delivery/fakes.js";
import { virtualClock } from "../../helpers/virtual-clock.js";
import { freshStore, WT } from "../../state/helpers.js";

/* Spec 017 D5: stale whole-program files lint when 004's slow trigger holds (approved 2026-10-26). */

/** A store with one revision at `createdAt` and no consumer. */
function storeAt(createdAt: number | null): Store {
  return {
    revisions: { latest: () => (createdAt === null ? null : { number: 1, createdAt }) },
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
    clock: virtualClock(now as EpochMs),
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

describe("the continuous quiet across a calendar step (011-382)", () => {
  /** An idle wait over a virtual clock whose latest revision is `revision()`; quiet 3 s. */
  function steppedIdle(revision: () => { number: number; createdAt: EpochMs }) {
    const clock = virtualClock(1_000_000 as EpochMs);
    const store = {
      revisions: { latest: revision },
      consumers: { list: () => [] },
    } as unknown as Store;
    const idle = lintIdleIn({
      store,
      worktreeId: "w1",
      policy: () => ({ slow: { ...DEFAULT_POLICY.slow, quietMs: 3_000 } }),
      clock,
      inUse: () => false,
    });
    return { clock, idle };
  }

  for (const [name, shift] of [
    ["set back", -3_600_000],
    ["set forward", 3_600_000],
  ] as const) {
    it(`a calendar ${name} 1 h after an edit: the quiet ends after its elapsed time, not 1 ms sooner`, () => {
      let createdAt = 0 as EpochMs;
      const { clock, idle } = steppedIdle(() => ({ number: 1, createdAt }));
      createdAt = clock.now();
      expect(idle(), "at the edit").toBe(3_000);
      clock.advance(1_000);
      clock.shiftCalendar(shift);
      expect(idle(), "after the step").toBe(2_000);
      clock.advance(1_999);
      expect(idle(), "1 ms before").toBe(1);
      clock.advance(1);
      expect(idle(), "at its end").toBe(0);
    });
  }

  it("an edit after the step counts from its own stored time", () => {
    let latest = { number: 1, createdAt: 0 as EpochMs };
    const { clock, idle } = steppedIdle(() => latest);
    latest = { number: 1, createdAt: clock.now() };
    expect(idle()).toBe(3_000);
    clock.shiftCalendar(-3_600_000);
    clock.advance(500);
    latest = { number: 2, createdAt: clock.now() };
    expect(idle()).toBe(3_000);
  });
});

describe("when a lint group at pause or stop may lint (019-45)", () => {
  it("once no consumer is in a turn, whatever slow.trigger says", async () => {
    const store = freshStore();
    const delivery = createDelivery(store, { status: fixedStatus() });
    const me: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
    const pauseIn = lintPauseIn({ store, worktreeId: WT, now: () => Date.now() });
    expect(pauseIn(), "no consumer").toBe(0);
    await delivery.register(me, { inTurn: true });
    expect(pauseIn(), "in a turn").toBe(SLOW_RECHECK_MS);
    await delivery.endTurn(me);
    expect(pauseIn(), "paused").toBe(0);
  });
});
