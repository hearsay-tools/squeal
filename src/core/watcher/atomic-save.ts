import type { CandidatePath, RelativePath } from "../types/index.js";

/**
 * Claude Code's atomic save writes `<file>.tmp.<pid>.<random>`, then renames
 * it over `<file>` (row 001-216: `src/money.ts.tmp.126736.8a6039186c60`).
 */
const TEMP_SHAPE = /\.tmp\.\d+\.[0-9a-z]+$/i;

/**
 * How long a new temp file is held out of batches. The create and the rename
 * fell ~550 ms apart at load ~35 (row 001-216); a temp file still there after
 * the hold is a file like any other.
 */
export const ATOMIC_SAVE_HOLD_MS = 5_000;

export function isAtomicSaveTemp(path: RelativePath): boolean {
  return TEMP_SHAPE.test(path);
}

/**
 * Keeps an atomic save's temp file out of revisions when its create and its
 * rename land in different batches (row 001-216).
 *
 * Spec 001 D2: "a path that appeared and went within the batch (an atomic
 * save's temp file) was never known". A batch can close between the create and
 * the rename, so a temp-shaped path that exists and is not tracked yet is held
 * out of every batch for `holdMs` from its first sighting, then released for
 * one recheck (`onRelease` re-hints it): gone by then, it was never known;
 * still there, it is reported like any new file. Every other path passes
 * untouched, so no real add waits on the hold.
 */
export class TempHold {
  private readonly held = new Map<RelativePath, NodeJS.Timeout>();
  private readonly released = new Set<RelativePath>();

  constructor(
    private readonly holdMs: number,
    private readonly onRelease: (path: RelativePath) => void,
  ) {}

  /** The candidates without the temp files under hold. */
  filter(paths: CandidatePath[], trackedPaths: () => Iterable<RelativePath>): CandidatePath[] {
    let tracked: Set<RelativePath> | null = null;
    return paths.filter(({ path, stat }) => {
      if (!isAtomicSaveTemp(path)) return true;
      if (stat === null) {
        this.forget(path);
        return true;
      }
      if (this.released.delete(path)) return true;
      if (this.held.has(path)) return false;
      tracked ??= new Set(trackedPaths());
      if (tracked.has(path)) return true;
      this.hold(path);
      return false;
    });
  }

  close(): void {
    for (const timer of this.held.values()) clearTimeout(timer);
    this.held.clear();
    this.released.clear();
  }

  private hold(path: RelativePath): void {
    const timer = setTimeout(() => {
      this.held.delete(path);
      this.released.add(path);
      this.onRelease(path);
    }, this.holdMs);
    timer.unref();
    this.held.set(path, timer);
  }

  private forget(path: RelativePath): void {
    const timer = this.held.get(path);
    if (timer) clearTimeout(timer);
    this.held.delete(path);
    this.released.delete(path);
  }
}
