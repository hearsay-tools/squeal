import { PAYLOAD_SCHEMA_VERSION, type WorktreeId } from "../types/common.js";
import type { WriteCancelRequest, WriteCancelResponse } from "../types/daemon-writes.js";
import type { Queued, WriteQueue } from "./queue.js";

/*
 * Spec 021 D22.4 (row 021-36, review of 0.1.571): a client that gave up
 * waiting for a batch settles it before it writes anything itself or tells
 * its caller. A batch the writer has not begun is withdrawn here and never
 * written; one it began is answered `writing` until it ends, then with how
 * it ended. So a batch its client reported failed is never written later,
 * and a later batch of its worktree never passes it.
 */

/** Ended batches remembered for a late cancel. */
const REMEMBERED = 256;

/** What the queue's items must say of themselves: begun by the writer, and how to refuse one. */
interface Item {
  readonly startedAt: number | null;
  reject(error: Error): void;
}

export class Batches<T extends Item> {
  readonly #queue: WriteQueue<T>;
  readonly #waiting = new Map<string, Queued<T>>();
  readonly #ended = new Map<string, boolean>();

  constructor(queue: WriteQueue<T>) {
    this.#queue = queue;
  }

  queued(worktreeId: WorktreeId, seq: string, queued: Queued<T>): void {
    this.#waiting.set(keyOf(worktreeId, seq), queued);
  }

  ended(worktreeId: WorktreeId, seq: string, written: boolean): void {
    const key = keyOf(worktreeId, seq);
    this.#waiting.delete(key);
    this.#ended.set(key, written);
    for (const old of this.#ended.keys()) {
      if (this.#ended.size <= REMEMBERED) break;
      this.#ended.delete(old);
    }
  }

  /** Withdraws the batch when the writer has not begun it; else says where it stands. */
  cancel(request: WriteCancelRequest): WriteCancelResponse {
    const key = keyOf(request.worktreeId, request.seq);
    const answer = (state: WriteCancelResponse["state"]): WriteCancelResponse => ({
      schemaVersion: PAYLOAD_SCHEMA_VERSION,
      ok: true,
      type: "write-cancel",
      state,
    });
    const queued = this.#waiting.get(key);
    if (queued !== undefined) {
      if (queued.item.startedAt !== null || !this.#queue.withdraw(queued)) return answer("writing");
      this.ended(request.worktreeId, request.seq, false);
      queued.item.reject(new Error("the client withdrew the batch"));
      return answer("cancelled");
    }
    const written = this.#ended.get(key);
    return answer(written === undefined ? "unknown" : written ? "written" : "failed");
  }
}

function keyOf(worktreeId: WorktreeId, seq: string): string {
  return `${worktreeId} ${seq}`;
}
