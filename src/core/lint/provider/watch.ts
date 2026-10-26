import { statSync } from "node:fs";
import { folderEntries as entriesOf, written } from "../pass/state.js";

/*
 * Spec 017 D5 (wave 1.5): what the program walk read, by state. Moved from
 * `program.ts` in wave 1.7, which reports the states (Q3).
 */

/**
 * The state of each path a kept result read (a folder's or a file's stat),
 * and the results that read it: a path whose state changed makes them
 * stale until they are made again. A folder whose mtime moved and whose
 * entries kept their names, kinds and link targets (an editor's save by
 * rename) makes none stale: what was looked up there is as it was.
 */
export class Watch {
  private readonly states = new Map<string, string>();
  /** A folder's entries, for the folders among `states`. */
  private readonly entries = new Map<string, string>();
  private readonly readers = new Map<string, Set<string>>();
  private readonly stale = new Set<string>();

  constructor(private readonly now: () => number) {}

  /** Reads every watched path's state again; a change makes its results stale. */
  restat(): void {
    for (const [path, state] of this.states) {
      const now = stateOf(path, this.now);
      if (now === state) continue;
      this.states.set(path, now);
      const entries = entriesOf(path);
      if (entries !== null && entries === this.entries.get(path)) continue;
      this.record(path, entries);
      for (const result of this.readers.get(path) ?? []) this.stale.add(result);
    }
  }

  /** `result` was made now from `paths`, in place of one made from `before`. */
  made(result: string, paths: Iterable<string>, before: Iterable<string> = []): void {
    for (const path of before) this.readers.get(path)?.delete(result);
    this.stale.delete(result);
    for (const path of paths) {
      if (!this.states.has(path)) {
        this.states.set(path, stateOf(path, this.now));
        this.record(path, entriesOf(path));
      }
      const readers = this.readers.get(path) ?? new Set<string>();
      readers.add(result);
      this.readers.set(path, readers);
    }
  }

  private record(path: string, entries: string | null): void {
    if (entries === null) this.entries.delete(path);
    else this.entries.set(path, entries);
  }

  /** Each path a kept result read, at the state and, for a folder, the entries last seen. */
  watched(): Map<string, { readonly state: string; readonly entries: string | null }> {
    const out = new Map<string, { readonly state: string; readonly entries: string | null }>();
    for (const [path, readers] of this.readers) {
      const state = this.states.get(path);
      const entries = this.entries.get(path) ?? null;
      if (readers.size > 0 && state !== undefined) out.set(path, { state, entries });
    }
    return out;
  }

  /** Whether `result` holds: no path it read changed state since it was made. */
  holds(result: string): boolean {
    return !this.stale.has(result);
  }
}

/**
 * How recent a state is unsure: file times tick coarsely (a few ms), and a
 * change between a read and the stat after it must not pass for the read's.
 */
const RACY_MS = 1_000;
let racy = 0;

/**
 * A path's state: a file's or folder's mtime and ctime, size and inode;
 * `missing` when absent. A state younger than `RACY_MS` equals no later
 * one, so the path is read again, as git treats a racily clean file.
 */
export function stateOf(path: string, now: () => number): string {
  const stat = statSync(path, { throwIfNoEntry: false });
  if (stat === undefined) return "missing";
  if (now() - Math.max(stat.mtimeMs, stat.ctimeMs) < RACY_MS) return `racy ${++racy}`;
  return written(stat);
}
