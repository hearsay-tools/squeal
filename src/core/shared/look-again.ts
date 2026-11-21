import { setTimeout as sleep } from "node:timers/promises";
import { isRefined } from "../scheduler/refined.js";
import type { RevisionNumber, WorktreeId } from "../types/common.js";
import type { Policy } from "../types/policy.js";
import type { Store } from "../types/store.js";

/*
 * Row 018-70 (gh-261, `research/issue-261-ci-import.md` Q2, Q5 options 1
 * and 2): the two waits of the shared results reader.
 *
 * Option 1: CI publishes the export of a main commit about 1 to 2 min after
 * main moves, and a fast follower moves its start point before that. While
 * the start point's own export is not listed, the reader lists again every
 * `shared.lookAgain.everySeconds`, for up to `forSeconds` after its first
 * look, and stops when the start point moves or the reader closes.
 *
 * Option 2: an import re-keys a file only when the closure list stored for
 * it holds every exported path (`transfer-rekey.ts`). A revision stores its
 * closure lists when its runner part is applied, seconds after the batch
 * that nudged the reader; an import before that keeps CI's keys for every
 * file whose closure gained a path. The import still lands at once, so the
 * refinement adopts every other file before a tier starts; once that
 * revision is refined (`scheduler/refined.ts`), the same export is imported
 * again and re-keys those files over the new lists (the coordinator,
 * 2026-11-21: an import that waited let the first catch-up tier start
 * first).
 */

/** Starts `fire` after `ms`; the function it returns cancels it. */
export type Timer = (ms: number, fire: () => void) => () => void;

/** A timer that keeps no process alive. */
export const unrefTimer: Timer = (ms, fire) => {
  const timer = setTimeout(fire, ms);
  timer.unref();
  return () => clearTimeout(timer);
};

/**
 * Review 0.1.588 B1: how late a look may start and still count as within
 * its window. A timer never fires early, so the last look, due at the
 * window's end, starts a little after it; a look later than this lists
 * nothing.
 */
export const LATE_LOOK_MS = 1_000;

/** What a missing export of the start point leads to. */
export type Missed = "once" | "again" | "gave up";

/** The looks again at one start point, by its key (`shared.ref` and the start point). */
export class LookAgain {
  #key: string | null = null;
  #until = 0;
  #due = false;
  #cancel: (() => void) | null = null;

  constructor(
    private readonly timer: Timer,
    private readonly fire: () => void,
  ) {}

  /** Whether the timer fired for `key`; a pass for another key ends that wait. */
  takeDue(key: string): boolean {
    const due = this.#due && this.#key === key;
    this.#due = false;
    return due;
  }

  /**
   * Review 0.1.588 B1: whether `key`'s window ended before `now`, a look's
   * lateness (`LATE_LOOK_MS`) allowed. The reader asks before any listing of
   * a look again: when the timer fired late, and again after its local git
   * steps. An ended window stops here, and the caller gives its one note.
   */
  expired(key: string, now: number): boolean {
    if (this.#key !== key || now <= this.#until + LATE_LOOK_MS) return false;
    this.stop();
    return true;
  }

  /**
   * `key`'s own export was not listed at `now`: the first look (`first`)
   * opens the window, a later one keeps it. Schedules the next look while
   * the window lasts; the last one is at its end.
   */
  missed(key: string, now: number, first: boolean, policy: Policy["shared"]["lookAgain"]): Missed {
    if (first) {
      this.stop();
      if (policy.forSeconds === 0) return "once";
      this.#key = key;
      this.#until = now + policy.forSeconds * 1_000;
    } else if (this.#key !== key) return "once";
    const left = this.#until - now;
    if (left <= 0) {
      this.stop();
      return "gave up";
    }
    this.#cancel = this.timer(Math.min(policy.everySeconds * 1_000, left), () => {
      this.#cancel = null;
      this.#due = true;
      this.fire();
    });
    return "again";
  }

  /** No look again is due: the start point moved, its export came, or the reader closed. */
  stop(): void {
    this.#cancel?.();
    this.#cancel = null;
    this.#key = null;
    this.#due = false;
  }
}

/** The status note when the window ends with no export of the start point. */
export function gaveUpNote(ref: string, remote: string, forSeconds: number): string {
  const window = forSeconds % 60 === 0 ? `${forSeconds / 60} min` : `${forSeconds} s`;
  return `CI results: ${remote} had no ${ref} after ${window}; tests run here as before`;
}

/** How often the import looks whether the revision's closure lists are stored. */
export const REFINED_POLL_MS = 250;

/**
 * Resolves once `revision` of the worktree is refined (its closure lists
 * stored), or once `signal` aborts.
 */
export async function closuresStored(
  store: Pick<Store, "meta">,
  worktreeId: WorktreeId,
  revision: RevisionNumber,
  options: { readonly pollMs: number; readonly signal: AbortSignal },
): Promise<void> {
  while (!options.signal.aborted && !isRefined(store, worktreeId, revision)) {
    await sleep(options.pollMs, undefined, { signal: options.signal }).catch(() => {});
  }
}
