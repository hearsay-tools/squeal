import type { WorktreeId } from "../types/common.js";

/*
 * Spec 021 D22.3 (row 021-36): the store process's one queue. Batches of one
 * worktree keep their order, since a later one may rest on an earlier one.
 * Among the worktrees' first batches, edit-tier results go first, then
 * other records, and the prune last and only when nothing else waits; a
 * tie goes to the batch that came first. A splittable batch cut short keeps
 * its place at its worktree's head, so an edit of another worktree runs
 * between its slices.
 */

/** What a batch is, for its turn: edit-tier results, other records, or the prune. */
export type WriteKind = "edit" | "record" | "prune";

const RANK: Record<WriteKind, number> = { edit: 0, record: 1, prune: 2 };

/** One queued batch; `T` is what the writer needs of it. */
export interface Queued<T> {
  readonly worktreeId: WorktreeId;
  readonly kind: WriteKind;
  readonly item: T;
  /** Arrival order. */
  readonly arrival: number;
}

export class WriteQueue<T> {
  readonly #byWorktree = new Map<WorktreeId, Queued<T>[]>();
  #arrivals = 0;
  #size = 0;

  get size(): number {
    return this.#size;
  }

  push(worktreeId: WorktreeId, kind: WriteKind, item: T): void {
    const queued: Queued<T> = { worktreeId, kind, item, arrival: this.#arrivals++ };
    const list = this.#byWorktree.get(worktreeId);
    if (list === undefined) this.#byWorktree.set(worktreeId, [queued]);
    else list.push(queued);
    this.#size++;
  }

  /** The batch to write next, left at its worktree's head; `null` when none waits. */
  peek(): Queued<T> | null {
    let best: Queued<T> | null = null;
    let others = false;
    for (const list of this.#byWorktree.values()) {
      const head = list[0];
      if (head === undefined) continue;
      if (head.kind !== "prune" || list.length > 1) others = true;
      if (best === null || before(head, best)) best = head;
    }
    if (best?.kind === "prune" && others) {
      // A prune waits while anything else does: the first non-prune head goes.
      best = null;
      for (const list of this.#byWorktree.values()) {
        const head = list[0];
        if (head === undefined || head.kind === "prune") continue;
        if (best === null || before(head, best)) best = head;
      }
      // Only prunes lead, but one has batches behind it: its worktree's order wins.
      if (best === null) best = this.#oldestHead();
    }
    return best;
  }

  /** Removes `queued`, the head of its worktree, once written or failed. */
  remove(queued: Queued<T>): void {
    const list = this.#byWorktree.get(queued.worktreeId);
    if (list?.[0] !== queued) return;
    list.shift();
    this.#size--;
    if (list.length === 0) this.#byWorktree.delete(queued.worktreeId);
  }

  /** Every batch, in no order; the queue is left empty. */
  drain(): T[] {
    const all = [...this.#byWorktree.values()].flat().map((q) => q.item);
    this.#byWorktree.clear();
    this.#size = 0;
    return all;
  }

  #oldestHead(): Queued<T> | null {
    let oldest: Queued<T> | null = null;
    for (const list of this.#byWorktree.values()) {
      const head = list[0];
      if (head !== undefined && (oldest === null || head.arrival < oldest.arrival)) oldest = head;
    }
    return oldest;
  }
}

function before<T>(a: Queued<T>, b: Queued<T>): boolean {
  const rank = RANK[a.kind] - RANK[b.kind];
  return rank < 0 || (rank === 0 && a.arrival < b.arrival);
}
