import type { EpochMs } from "../types/common.js";
import type { CheckKey } from "../types/keys.js";
import type { Policy } from "../types/policy.js";
import { SLOW_GROUP, TESTS_GROUP } from "../types/scheduler.js";
import type { Ledger } from "./ledger.js";
import { groupView } from "./slow.js";
import type { LaneEnd, SlowTier } from "./slow-tier.js";

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
   * group's last: admission's `lanes`, whose `ask` is the order the step
   * asks them in (row 011-357). A group `policy` no longer has is retired.
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
    // Review 0.1.513 B3: lanes due at one time wake in this policy's order, kept and new alike.
    [...names].forEach((name, index) => {
      this.#configured.get(name)?.ranked(index);
    });
  }

  /** Review 0.1.610 B1: every lane's narrow asks, each file's `testFileId` and asked key. */
  narrowAsks(): [string, CheckKey][] {
    return this.#all().flatMap((lane) => [...lane.narrow.entries()]);
  }

  /** Drops each lane's narrow asks that can no longer run (`CommitAsks.prune`). */
  pruneNarrow(ledger: Ledger): void {
    for (const lane of this.#all()) lane.narrow.prune(ledger);
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

  /** Row 011-377: the calendar stepped `ms`: each lane's last end moves with it. */
  shift(ms: number): void {
    for (const lane of this.#all()) lane.shift(ms);
  }

  set draining(on: boolean) {
    for (const lane of this.#all()) lane.draining = on;
  }

  preempt(): void {
    for (const lane of this.#all()) lane.preempt();
  }

  nudge(ledger: Ledger): void {
    for (const lane of this.#all()) lane.nudge(ledger);
  }

  /** A lane's tier was recorded or put back: that lane publishes what its files wait for. */
  endedOnce(end: LaneEnd): void {
    for (const lane of this.#all()) lane.endedOnce(end);
  }

  close(): void {
    for (const lane of this.#all()) lane.close();
  }

  retire(): void {
    for (const lane of this.#all()) lane.retire();
  }
}
