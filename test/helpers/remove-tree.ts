import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/*
 * Row 011-336 (`docs/specifications/011-core/research/enotempty-cleanup.md`
 * finding 1): `rmSync`'s `maxRetries` differs by Node version. Node 22.19
 * retries only the last `rmdir` and never removes an entry a writer added
 * after the sweep of the children, so every retry meets it (ENOTEMPTY); Node
 * 24 and 26 repeat the whole removal. `removeTree` repeats the whole removal
 * itself, so a folder goes the same way on each Node a test runs on.
 */

/** The codes Node's own `rmSync` retries on (`lib/internal/fs/rimraf.js`). */
const RETRIED = new Set(["EBUSY", "EMFILE", "ENFILE", "ENOTEMPTY", "EPERM"]);

/** The most entries a failed removal names. */
const NAMED = 20;

export interface RemoveTreeOptions {
  /** How long the removal may repeat before it fails; 10 s when not given. */
  readonly timeoutMs?: number;
  /** The pause between two attempts; 50 ms when not given. */
  readonly intervalMs?: number;
  /** One attempt, `rmSync(dir, { recursive, force })` when not given; tests inject failures. */
  readonly remove?: (dir: string) => void;
}

/**
 * Removes `dir` and everything below it, and repeats the whole removal until
 * `dir` is gone: an attempt can meet an entry a writer added during it, and a
 * writer can make `dir` again after it. Fails at once on an error Node does
 * not retry, and after `timeoutMs` with what is left. A writer that never
 * stops is the caller's to end first; this only outlasts one that stops.
 */
export function removeTree(dir: string, options: RemoveTreeOptions = {}): void {
  const { timeoutMs = 10_000, intervalMs = 50 } = options;
  const remove =
    options.remove ?? ((path: string) => rmSync(path, { recursive: true, force: true }));
  const deadline = Date.now() + timeoutMs;
  for (let attempts = 1; ; attempts++) {
    let failure: unknown = null;
    try {
      remove(dir);
    } catch (error) {
      if (!RETRIED.has((error as NodeJS.ErrnoException).code ?? "")) throw error;
      failure = error;
    }
    if (failure === null && !existsSync(dir)) return;
    if (Date.now() >= deadline) {
      const why = failure === null ? "made again after its removal" : String(failure);
      throw new Error(
        `${dir} was not removed in ${timeoutMs} ms (${attempts} attempts; last: ${why}); left: ${left(dir)}`,
        { cause: failure ?? undefined },
      );
    }
    sleep(intervalMs);
  }
}

/** Up to `NAMED` entries below `dir`, relative to it, in name order. */
function left(dir: string): string {
  const found: string[] = [];
  const walk = (path: string, prefix: string) => {
    let entries: string[];
    try {
      entries = readdirSync(path).sort();
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= NAMED) return;
      found.push(join(prefix, entry));
      walk(join(path, entry), join(prefix, entry));
    }
  };
  walk(dir, "");
  return found.length === 0 ? "(nothing)" : found.join(", ");
}

/** Blocks this thread for `ms` without using the CPU; the removal is synchronous too. */
function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
