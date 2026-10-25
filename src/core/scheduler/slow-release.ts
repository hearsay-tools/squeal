import type { EpochMs } from "../types/index.js";

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
  /** The lane of each tier in flight. */
  lanes(): readonly string[];
  /** When a slow run last ended (`SlowTier.endedAt`); `null` before the first. */
  endedAt(): EpochMs | null;
  now(): EpochMs;
  closed(): boolean;
}

/**
 * Row 011-211 (004 D2, 013 V1; gh-78): a slow lane's runner instance closes
 * when its pass drains (`release`), and also while its slow files are still
 * queued: at once when a hold begins (`idle`), and once `afterMs` passed
 * since the last slow run ended with no slow tier started since. Closing it
 * runs each project's `globalSetup` teardown, so what the setup holds (a
 * test environment, a lease, a port) is free while no slow file runs. A
 * slow selection in progress, the load guard's wait included (004 D3),
 * keeps it. The next slow tier makes a new instance, as the first of a pass
 * does, and runs the setup again.
 */
export class SlowRelease {
  /** The slow lanes whose instance a slow tier opened and no release closed since. */
  readonly #open = new Set<string>();
  #selecting = false;
  #timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly host: SlowReleaseHost,
    private readonly afterMs: number = SLOW_RELEASE_MS,
  ) {}

  /** A slow tier starts in `lane`: its instance is open, or opens. */
  opened(lane: string): void {
    this.#open.add(lane);
  }

  /** Closes `lane`'s instance now; a tier of it may still be in flight, ending. */
  async release(lane: string): Promise<void> {
    this.#open.delete(lane);
    await this.host.release(lane);
  }

  /** Closes the instance of each open lane no tier runs in, unless a slow selection is in progress. */
  async idle(): Promise<void> {
    if (this.#selecting) return;
    const busy = new Set(this.host.lanes());
    const idle = [...this.#open].filter((lane) => !busy.has(lane));
    await Promise.all(idle.map((lane) => this.release(lane)));
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

  /** Arms the close for `afterMs` after the last slow run's end, while an open lane has no tier in flight. */
  arm(): void {
    if (this.#timer !== null || this.host.closed()) return;
    const busy = new Set(this.host.lanes());
    if (![...this.#open].some((lane) => !busy.has(lane))) return;
    const now = this.host.now();
    const due = (this.host.endedAt() ?? now) + this.afterMs;
    this.#timer = setTimeout(
      () => {
        this.#timer = null;
        void this.#due();
      },
      Math.max(0, due - now),
    );
    this.#timer.unref();
  }

  close(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }

  /** A slow run that ended since the timer was armed moves the bound; a tier in flight re-arms at its end. */
  async #due(): Promise<void> {
    if (this.host.closed()) return;
    const ended = this.host.endedAt();
    if (ended !== null && this.host.now() - ended < this.afterMs) {
      this.arm();
      return;
    }
    await this.idle();
  }
}
