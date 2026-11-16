import { describe, expect, it } from "vitest";
import { GroupTiers } from "../../src/core/scheduler/group-tiers.js";
import { type LaneLoop, SlowTier } from "../../src/core/scheduler/slow-tier.js";
import { type WakeSlot, Wakes } from "../../src/core/scheduler/wakes.js";
import type { CheckGroup } from "../../src/core/types/check-groups.js";
import { DEFAULT_POLICY, type Policy } from "../../src/core/types/policy.js";
import { virtualClock } from "../helpers/virtual-clock.js";

/*
 * Review 0.1.513 B3 (row 011-352): slow lanes due at one time wake in the
 * configured order, the default `slow` last, after a policy reload reorders
 * the groups or inserts one ahead; each lane keeps its state and its wake.
 */

const group = (name: string): CheckGroup => ({
  name,
  runner: "vitest",
  tests: [`test/${name}/**`],
  at: "edit",
});

const policyOf = (...names: string[]): Policy => ({
  ...DEFAULT_POLICY,
  checks: names.map(group),
});

/** Real lanes on one loop; each lane's wake records its group, each slot as it was made. */
function lanes() {
  const clock = virtualClock(0);
  const wakes = new Wakes(clock);
  const slots = new Map<string, WakeSlot>();
  let making = "";
  const slot = wakes.slot.bind(wakes);
  wakes.slot = (...args) => {
    const made = slot(...args);
    slots.set(making, made);
    return made;
  };
  const fired: string[] = [];
  const groups = new GroupTiers((name) => {
    making = name;
    const host = {
      closed: () => false,
      ready: () => false,
      pump: () => fired.push(name),
      now: () => clock.now(),
      wakes,
    } as unknown as LaneLoop;
    return new SlowTier(host, {}, name);
  });
  /** Every lane's wake at `at` (row 011-369: the delay to it), then time moves there. */
  const wakeAll = (at: number) => {
    for (const s of slots.values()) s.after(at - clock.now());
  };
  return { clock, groups, slots, fired, wakeAll };
}

describe("slow lanes' wake order follows the policy (review 0.1.513 B3)", () => {
  it("in the configured order, the default slow last", () => {
    const { clock, groups, fired, wakeAll } = lanes();
    const names = groups.lanes(policyOf("alpha", "beta")).map((lane) => lane.group);
    wakeAll(100);
    clock.advance(100);
    expect(fired).toEqual(names);
    expect(fired.at(-1)).toBe("slow");
  });

  it("a reload that reorders the groups reorders their wakes; a wake stated before it stays", () => {
    const { clock, groups, fired, wakeAll, slots } = lanes();
    const first = groups.lanes(policyOf("alpha", "beta"));
    wakeAll(100);
    const names = groups.lanes(policyOf("beta", "alpha")).map((lane) => lane.group);
    expect(names).toEqual(["beta", "alpha", "slow"]);
    // The same lanes, their wakes kept.
    expect(groups.get("alpha")).toBe(first.find((lane) => lane.group === "alpha"));
    expect([...slots.values()].map((s) => s.due)).toEqual([100, 100, 100]);
    clock.advance(100);
    expect(fired).toEqual(names);
  });

  it("a group inserted ahead on reload wakes first", () => {
    const { clock, groups, fired, wakeAll } = lanes();
    groups.lanes(policyOf("alpha", "beta"));
    const names = groups.lanes(policyOf("gamma", "alpha", "beta")).map((lane) => lane.group);
    expect(names).toEqual(["gamma", "alpha", "beta", "slow"]);
    wakeAll(100);
    clock.advance(100);
    expect(fired).toEqual(names);
  });
});
