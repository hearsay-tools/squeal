import type { EpochMs } from "../types/common.js";
import type { WakeSlot, Wakes } from "./wakes.js";

/**
 * Row 011-211: how long a slow lane's runner instance stays open while its
 * slow files wait and none starts. It copies 011-163's drain bound and is
 * not measured.
 */
export const SLOW_RELEASE_MS = 60_000;

/** What `SlowRelease` needs from its scheduler. */
export interface SlowReleaseHost {
  /** The runner's `releaseLane` of `lane`, its error noted; nothing once the scheduler closed. */
  release(lane: string): Promise<void>;
  /** The lanes whose instance stays: each tier's in flight, and each whose files wait for a load guard. */
  lanes(): readonly string[];
  now(): EpochMs;
  closed(): boolean;
  /** The scheduler's wake loop (row 011-352). */
  readonly wakes: Wakes;
}

/** One open slow lane as `decideRelease` reads it. */
export interface ReleaseLane {
  readonly lane: string;
  /** A tier of it is in flight, or its files wait for the load guard: its instance stays. */
  readonly busy: boolean;
  /** When its last slow run ended; `null` counts from the reading. */
  readonly endedAt: EpochMs | null;
}

/** What `decideRelease` decides at one reading (row 011-355). */
export interface ReleaseDecision {
  /** The open lanes no tier keeps: a hold closes them all at once. */
  readonly idle: readonly string[];
  /** The idle lanes past their bound: they close now. */
  readonly close: readonly string[];
  /**
   * The earliest bound of an idle lane, a passed one too (a wake at a past
   * time fires next); `null` without an idle lane.
   */
  readonly wakeAt: EpochMs | null;
}

/**
 * Row 011-355: which open lanes are idle, which close at `at` (`afterMs`
 * after their last slow run ended), and when the next one is due. Pure.
 */
export function decideRelease(
  lanes: readonly ReleaseLane[],
  at: EpochMs,
  afterMs: number = SLOW_RELEASE_MS,
): ReleaseDecision {
  const idle = lanes.filter((lane) => !lane.busy);
  const dueAt = (lane: ReleaseLane) => (lane.endedAt ?? at) + afterMs;
  return {
    idle: idle.map((lane) => lane.lane),
    close: idle.filter((lane) => dueAt(lane) <= at).map((lane) => lane.lane),
    wakeAt: idle.length === 0 ? null : (Math.min(...idle.map(dueAt)) as EpochMs),
  };
}

/**
 * Row 011-211 (004 D2, 013 V1; gh-78): a slow lane's runner instance closes
 * when its pass drains (`release`), and also while its slow files are still
 * queued: at once when a hold begins (the step's `close-lanes`, over
 * `idleLanes`), and once `afterMs` passed
 * since that lane's last slow run ended with no tier of it started since.
 * Each lane counts from its own end (spec 019 D3, review 0.1.396 S4): a
 * lane that ends tiers keeps no other lane's instance. Closing it runs each
 * project's `globalSetup` teardown, so what the setup holds (a test
 * environment, a lease, a port) is free while no slow file runs. A slow
 * selection is one synchronous piece of the step's lock turn (row 011-357),
 * so no close lands inside it; a lane whose files wait for the load guard
 * (004 D3) keeps its own (`SlowReleaseHost.lanes`). The next slow tier
 * makes a new instance, as the first of a pass does, and runs the setup
 * again.
 */
export class SlowRelease {
  /** The slow lanes whose instance a slow tier opened and no release closed since. */
  readonly #open = new Set<string>();
  /** When each lane's last slow run ended (`ended`). */
  readonly #endedAt = new Map<string, EpochMs>();
  readonly #wakes: Wakes;
  /** The close's wake (row 011-352): an earlier bound replaces a later one. */
  readonly #wake: WakeSlot;

  constructor(
    private readonly host: SlowReleaseHost,
    private readonly afterMs: number = SLOW_RELEASE_MS,
  ) {
    this.#wakes = host.wakes;
    this.#wake = this.#wakes.slot("slow-release", () => void this.#wakes.track(() => this.#due()));
  }

  /** A slow tier starts in `lane`: its instance is open, or opens. */
  opened(lane: string): void {
    this.#open.add(lane);
  }

  /** A slow tier of `lane` ended now: the lane counts from it. */
  ended(lane: string): void {
    this.#endedAt.set(lane, this.host.now());
    this.arm();
  }

  /**
   * Row 011-377: the calendar stepped `ms` (`CalendarSteps`): each lane's
   * end moves with it, so its bound keeps its elapsed time left.
   */
  shift(ms: number): void {
    for (const [lane, at] of this.#endedAt) this.#endedAt.set(lane, (at + ms) as EpochMs);
  }

  /** Closes `lane`'s instance now; a tier of it may still be in flight, ending. */
  async release(lane: string): Promise<void> {
    this.#open.delete(lane);
    await this.host.release(lane);
  }

  /**
   * The open lanes no tier runs in at `at`, the step's reading (row
   * 011-372), else now (`decideRelease`'s `idle`): a step's decision (row 011-356).
   */
  idleLanes(at?: EpochMs): readonly string[] {
    return this.#decide(at).idle;
  }

  /** Closes `lanes`, a step decided idle on a hold. */
  async closeIdle(lanes: readonly string[]): Promise<void> {
    await Promise.all(lanes.map((lane) => this.release(lane)));
  }

  /** Arms the close at the earliest bound of an open lane no tier runs in; an earlier one replaces it. */
  arm(): void {
    if (this.host.closed()) return;
    const { wakeAt } = this.#decide();
    // Row 011-369: the bound is a calendar time (a lane's stamped end): the wake is the delay to it.
    if (wakeAt !== null) this.#wake.within(wakeAt - this.host.now());
  }

  close(): void {
    this.#wake.clear();
  }

  /** `decideRelease` over the open lanes at `at`, each counting from its own end, else from `at`. */
  #decide(at: EpochMs = this.host.now()): ReleaseDecision {
    const busy = new Set(this.host.lanes());
    const lanes = [...this.#open].map((lane) => ({
      lane,
      busy: busy.has(lane),
      endedAt: this.#endedAt.get(lane) ?? null,
    }));
    return decideRelease(lanes, at, this.afterMs);
  }

  /**
   * Closes each idle lane past its own bound and arms the next. A lane
   * whose tier is in flight re-arms at its end.
   */
  async #due(): Promise<void> {
    if (this.host.closed()) return;
    await Promise.all(this.#decide().close.map((lane) => this.release(lane)));
    this.arm();
  }
}
