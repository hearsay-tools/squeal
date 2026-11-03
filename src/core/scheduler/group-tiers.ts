import { type EpochMs, type Policy, SLOW_GROUP, TESTS_GROUP } from "../types/index.js";
import { groupView } from "./slow.js";
import type { SlowTier } from "./slow-tier.js";

/*
 * Spec 019 D3 (row 019-10): one lane object (`SlowTier`) per group other
 * than `tests`. The default `slow` group's always exists, as the slow tier
 * did; a configured group's is made when a policy names it and retired
 * when a reload drops it. With no `checks` key there is the `slow` one only.
 */

export class GroupTiers {
  /** The default `slow` group's lane: today's slow tier. */
  readonly slow: SlowTier;
  readonly #configured = new Map<string, SlowTier>();
  /** The policy `#configured` was last synced with. */
  #policy: Policy | null = null;

  constructor(private readonly make: (group: string) => SlowTier) {
    this.slow = make(SLOW_GROUP);
  }

  /**
   * Each lane under `policy`, the ones a load guard may hold last, so a
   * lane that waits for the load never holds back one that need not (D3:
   * "a long group never holds back another group's results"); otherwise in
   * the policy's order, the default `slow` group's last. A group `policy`
   * no longer has is retired.
   */
  lanes(policy: Policy): readonly SlowTier[] {
    if (this.#policy !== policy) this.#sync(policy);
    const { groups } = groupView(policy);
    const ordered = groups.flatMap((group) => {
      const lane = this.get(group.name);
      return lane === undefined ? [] : [{ lane, guarded: group.limits.deferUnderLoad !== null }];
    });
    return [
      ...ordered.filter(({ guarded }) => !guarded).map(({ lane }) => lane),
      ...ordered.filter(({ guarded }) => guarded).map(({ lane }) => lane),
    ];
  }

  /** The lane of group `name`; none for `tests` or a group no policy synced named. */
  get(name: string): SlowTier | undefined {
    return name === SLOW_GROUP ? this.slow : this.#configured.get(name);
  }

  #all(): SlowTier[] {
    return [this.slow, ...this.#configured.values()];
  }

  #sync(policy: Policy): void {
    this.#policy = policy;
    const names = new Set(
      groupView(policy)
        .groups.map((group) => group.name)
        .filter((name) => name !== TESTS_GROUP && name !== SLOW_GROUP),
    );
    for (const [name, lane] of this.#configured) {
      if (names.has(name)) continue;
      lane.close();
      lane.retire();
      this.#configured.delete(name);
    }
    for (const name of names) {
      if (!this.#configured.has(name)) this.#configured.set(name, this.make(name));
    }
  }

  /** Some lane has an open request. */
  get requested(): boolean {
    return this.#all().some((lane) => lane.requested);
  }

  /** When the last run of any lane ended; `null` before the first. */
  get endedAt(): EpochMs | null {
    const ends = this.#all()
      .map((lane) => lane.endedAt)
      .filter((at): at is EpochMs => at !== null);
    return ends.length === 0 ? null : (Math.max(...ends) as EpochMs);
  }

  set draining(on: boolean) {
    for (const lane of this.#all()) lane.draining = on;
  }

  preempt(): void {
    for (const lane of this.#all()) lane.preempt();
  }

  nudge(): void {
    for (const lane of this.#all()) lane.nudge();
  }

  /** A lane's tier was recorded or put back: that lane publishes what its files wait for. */
  endedOnce(): void {
    for (const lane of this.#all()) lane.endedOnce();
  }

  close(): void {
    for (const lane of this.#all()) lane.close();
  }

  retire(): void {
    for (const lane of this.#all()) lane.retire();
  }
}
