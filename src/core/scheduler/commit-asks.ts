import type { CheckKey, TestFileRef } from "../types/keys.js";
import type { FileState } from "./files.js";
import type { Ledger } from "./ledger.js";

/*
 * Spec 019 D5 step 1 (row 019-22): the files a commit asked one `commit`
 * group's lane to run, each at the key the commit gave it. A `commit`
 * group's moment never holds by itself (`momentHolds`), so these are the
 * only files of the group that run without a request.
 */

/** One file a commit asks to run, at its key then. */
export interface CommitAsk {
  readonly ref: TestFileRef;
  readonly key: CheckKey;
}

/**
 * The asks of one lane. A file runs while its key is still the asked key:
 * an edit that re-keys it before it runs leaves it to the next commit. An
 * ask leaves once its file is no longer pending, or once neither its key
 * nor its run in flight is the asked key.
 */
export class CommitAsks {
  readonly #keys = new Map<string, CheckKey>();

  /** `changed`: told after an ask came or left (review 0.1.610 B1: a lane's narrow asks are published). */
  constructor(private readonly changed?: () => void) {}

  add(asks: readonly CommitAsk[], ledger: Ledger): void {
    let changed = false;
    for (const { ref, key } of asks) {
      const file = ledger.file(ref);
      if (file === undefined || this.#keys.get(file.id) === key) continue;
      this.#keys.set(file.id, key);
      changed = true;
    }
    if (changed) this.changed?.();
  }

  /** Whether a commit asked for `ref` at its key now. */
  has(ledger: Ledger, ref: TestFileRef): boolean {
    if (this.#keys.size === 0) return false;
    const file = ledger.file(ref);
    return file !== undefined && file.key !== null && this.#keys.get(file.id) === file.key;
  }

  /** Drops the asks that can no longer run (above). */
  prune(ledger: Ledger): void {
    let changed = false;
    for (const [id, key] of this.#keys) {
      const file = ledger.files.get(id);
      if (file !== undefined && mayRunAt(file, key)) continue;
      this.#keys.delete(id);
      changed = true;
    }
    if (changed) this.changed?.();
  }

  /** Drops every ask (a retired lane's). */
  clear(): void {
    if (this.#keys.size === 0) return;
    this.#keys.clear();
    this.changed?.();
  }

  /** Each ask: its file's `testFileId` and the key it was asked at. */
  entries(): IterableIterator<[string, CheckKey]> {
    return this.#keys.entries();
  }

  get size(): number {
    return this.#keys.size;
  }
}

/** `file` is pending, and its key or the key of its run in flight is `key`. */
function mayRunAt(file: FileState, key: CheckKey): boolean {
  return file.phase !== null && (file.key === key || file.runningKey === key);
}
