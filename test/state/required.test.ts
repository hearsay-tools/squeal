import { describe, expect, it } from "vitest";
import { requiredNotCurrent, slowPolicyView, stopRequired } from "../../src/core/state/index.js";
import {
  type CheckGroup,
  DEFAULT_POLICY,
  type KnownState,
  type Policy,
  type TestFileKeyRecord,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { check, WT } from "./helpers.js";

/*
 * Row 019-14, spec 019 D4: the checks Stop requires are the test files of
 * every group with `stopRequires` (019-07): each group at `stop`, and the
 * default `slow` group under `stop.requireSlowSuite`, whatever its trigger.
 * Not current is pending or not run, as `slowFilesNotCurrent` said for slow
 * files (004 D7).
 */

const E2E: TestFileRef = { project: "", path: "test/e2e/a.test.ts" };
const SLOW: TestFileRef = { project: "", path: "test/slow/b.test.ts" };
const UNIT: TestFileRef = { project: "", path: "src/c.test.ts" };

function policy(over: { checks?: CheckGroup[]; requireSlowSuite?: boolean; idle?: boolean }) {
  return {
    ...DEFAULT_POLICY,
    checks: over.checks ?? [],
    slow: {
      ...DEFAULT_POLICY.slow,
      include: [SLOW.path],
      trigger: over.idle === true ? "idle" : "continuous",
    },
    stop: { ...DEFAULT_POLICY.stop, requireSlowSuite: over.requireSlowSuite ?? false, maxHolds: 2 },
  } satisfies Policy;
}

const key = (testFile: TestFileRef, pending: "queued" | null): TestFileKeyRecord => ({
  worktreeId: WT,
  testFile,
  key: `k-${testFile.path}`,
  revision: 1,
  pending,
});

const state = (testFile: TestFileRef, validity: KnownState["validity"]): KnownState =>
  ({
    worktreeId: WT,
    check: check("t", testFile),
    outcome: "pass",
    validity,
    observedAt: 1,
  }) as KnownState;

const E2E_GROUP: CheckGroup = { name: "e2e", runner: "vitest", tests: ["test/e2e/**"], at: "stop" };

describe("stopRequired (019 D4)", () => {
  it("is null with no group Stop waits for: today's policy without requireSlowSuite", () => {
    expect(stopRequired(DEFAULT_POLICY)).toBeNull();
    expect(stopRequired(policy({}))).toBeNull();
    expect(stopRequired(policy({ checks: [{ ...E2E_GROUP, at: "pause" }] }))).toBeNull();
  });

  it.each([false, true])(
    "requires the default slow group's files under requireSlowSuite, idle trigger %s",
    (idle) => {
      const required = stopRequired(policy({ requireSlowSuite: true, idle }));
      expect(required?.groupOf(SLOW)).toBe("slow");
      expect(required?.groupOf(UNIT)).toBeNull();
      expect(required?.maxHolds).toBe(2);
      expect(required?.waitMs).toBe(DEFAULT_POLICY.stop.slowWaitMs);
    },
  );

  it("requires each group at stop, and the slow group only under requireSlowSuite", () => {
    const required = stopRequired(policy({ checks: [E2E_GROUP] }));
    expect(required?.groups).toEqual(["e2e"]);
    expect(required?.groupOf(E2E)).toBe("e2e");
    expect(required?.groupOf(SLOW)).toBeNull();
    expect(required?.groupOf(UNIT)).toBeNull();
  });
});

describe("requiredNotCurrent (019 D4, 004 D7)", () => {
  const required = stopRequired(policy({ checks: [E2E_GROUP], requireSlowSuite: true }));
  if (required === null) throw new Error("nothing required");

  it("gives each required file pending or not run, with its group; never a current one", () => {
    const keys = [key(E2E, "queued"), key(SLOW, null), key(UNIT, "queued")];
    expect(requiredNotCurrent([], keys, required)).toEqual([
      { group: "e2e", ref: E2E },
      { group: "slow", ref: SLOW },
    ]);
    const states = [state(E2E, "current"), state(SLOW, "pending")];
    expect(requiredNotCurrent(states, keys, required)).toEqual([{ group: "slow", ref: SLOW }]);
  });

  it("matches what slowFilesNotCurrent gave for slow files with no checks key", () => {
    const slowOnly = stopRequired(policy({ requireSlowSuite: true }));
    if (slowOnly === null) throw new Error("nothing required");
    const keys = [key(SLOW, null), key(E2E, null), key(UNIT, "queued")];
    expect(requiredNotCurrent([state(SLOW, "stale")], keys, slowOnly)).toEqual([
      { group: "slow", ref: SLOW },
    ]);
    expect(requiredNotCurrent([state(SLOW, "current")], keys, slowOnly)).toEqual([]);
  });
});

/*
 * Row 019-23 (spec 019 D6): the `Slow tier:` line says Stop waits only when
 * Stop waits for the default `slow` group (its resolved `stopRequires`); a
 * group at `stop` gives its own line the wait. Both read one bound.
 */
describe("the Stop wait the slow-tier line reads (019-23)", () => {
  const withWait = (p: Policy, slowWaitMs: number): Policy => ({
    ...p,
    stop: { ...p.stop, slowWaitMs },
  });

  it("is null for the slow group when only a configured group is at stop", () => {
    const p = policy({ checks: [E2E_GROUP] });
    expect(slowPolicyView(p)?.stopWaitMs).toBeNull();
    expect(stopRequired(p)?.waitMs).toBe(DEFAULT_POLICY.stop.slowWaitMs);
  });

  it("is the bound Stop waits for every required group, the 59 min cap included", () => {
    for (const [given, honoured] of [
      [120_000, 120_000],
      [7_200_000, 3_540_000],
    ] as const) {
      const p = withWait(policy({ checks: [E2E_GROUP], requireSlowSuite: true }), given);
      expect(slowPolicyView(p)?.stopWaitMs).toBe(honoured);
      expect(stopRequired(p)?.waitMs).toBe(honoured);
      expect(stopRequired(p)?.groups).toEqual(["e2e", "slow"]);
    }
  });
});
