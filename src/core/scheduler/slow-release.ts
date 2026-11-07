import type { EpochMs } from "../types/common.js";

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
  /**
   * When a slow run last ended, for a lane whose end `ended` did not
   * record; absent, such a lane counts from now.
   */
  endedAt?(): EpochMs | null;
  now(): EpochMs;
  closed(): boolean;
}

/**
 * Row 011-211 (004 D2, 013 V1; gh-78): a slow lane's runner instance closes
 * when its pass drains (`release`), and also while its slow files are still
 * queued: at once when a hold begins (`idle`), and once `afterMs` passed
 * since that lane's last slow run ended with no tier of it started since.
 * Each lane counts from its own end (spec 019 D3, review 0.1.396 S4): a
 * lane that ends tiers keeps no other lane's instance. Closing it runs each
 * project's `globalSetup` teardown, so what the setup holds (a test
 * environment, a lease, a port) is free while no slow file runs. A slow
 * selection in progress keeps every instance, and a lane whose files wait
 * for the load guard (004 D3) keeps its own (`SlowReleaseHost.lanes`). The
 * next slow tier makes a new instance, as the first of a pass does, and
 * runs the setup again.
 */
export class SlowRelease {
  /** The slow lanes whose instance a slow tier opened and no release closed since. */
  readonly #open = new Set<string>();
  /** When each lane's last slow run ended (`ended`). */
  readonly #endedAt = new Map<string, EpochMs>();
  #selecting = false;
  #timer: NodeJS.Timeout | null = null;
  /** When `#timer` fires, so an earlier bound replaces it. */
  #timerAt = 0;

  constructor(
    private readonly host: SlowReleaseHost,
    private readonly afterMs: number = SLOW_RELEASE_MS,
  ) {}

  /** A slow tier starts in `lane`: its instance is open, or opens. */
  opened(lane: string): void {
    this.#open.add(lane);
  }

  /** A slow tier of `lane` ended now: the lane counts from it. */
  ended(lane: string): void {
    this.#endedAt.set(lane, this.host.now());
    this.arm();
  }

  /** Closes `lane`'s instance now; a tier of it may still be in flight, ending. */
  async release(lane: string): Promise<void> {
    this.#open.delete(lane);
    await this.host.release(lane);
  }

  /** Closes the instance of each open lane no tier runs in, unless a slow selection is in progress. */
  async idle(): Promise<void> {
    if (this.#selecting) return;
    await Promise.all(this.#idleLanes().map((lane) => this.release(lane)));
  }

  /** `select`, a slow selection: no instance closes during it; the count goes on after it. */
  async selecting<T>(select: () => Promise<T>): Promise<T> {
    this.#selecting = true;
    try {
      return await select();
    } finally {
      this.#selecting = false;
      this.arm();
    }
  }

  /** Arms the close at the earliest bound of an open lane no tier runs in; an earlier one replaces it. */
  arm(): void {
    if (this.host.closed()) return;
    const dues = this.#idleLanes().map((lane) => this.#dueAt(lane));
    if (dues.length === 0) return;
    const due = Math.min(...dues);
    if (this.#timer !== null) {
      if (this.#timerAt <= due) return;
      clearTimeout(this.#timer);
    }
    this.#timerAt = due;
    this.#timer = setTimeout(
      () => {
        this.#timer = null;
        void this.#due();
      },
      Math.max(0, due - this.host.now()),
    );
    this.#timer.unref();
  }

  close(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }

  /** The open lanes the host keeps no instance for (`SlowReleaseHost.lanes`). */
  #idleLanes(): string[] {
    const busy = new Set(this.host.lanes());
    return [...this.#open].filter((lane) => !busy.has(lane));
  }

  /** When `lane`'s instance closes: `afterMs` after its last slow run ended. */
  #dueAt(lane: string): number {
    const ended = this.#endedAt.get(lane) ?? this.host.endedAt?.() ?? this.host.now();
    return ended + this.afterMs;
  }

  /**
   * Closes each idle lane past its own bound and arms the next. During a
   * selection nothing closes: its end arms again. A lane whose tier is in
   * flight re-arms at its end.
   */
  async #due(): Promise<void> {
    if (this.host.closed() || this.#selecting) return;
    const now = this.host.now();
    const due = this.#idleLanes().filter((lane) => this.#dueAt(lane) <= now);
    await Promise.all(due.map((lane) => this.release(lane)));
    this.arm();
  }
}
