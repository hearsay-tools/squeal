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
   * Each lane under `policy`, in the policy's order, the default `slow`
   * group's last. A lane that waits for the load returns at once and holds
   * back none after it (D3: "a long group never holds back another group's
   * results"; review 0.1.396 B1). A group `policy` no longer has is retired.
   */
  lanes(policy: Policy): readonly SlowTier[] {
    if (this.#policy !== policy) this.#sync(policy);
    return groupView(policy).groups.flatMap((group) => this.get(group.name) ?? []);
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

  /** The runner lanes whose files wait for a load guard now (`SlowTier.deferring`). */
  deferring(): string[] {
    return this.#all().flatMap((lane) => lane.deferring ?? []);
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
