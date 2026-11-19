import type { WriteKind } from "./queue.js";

/*
 * Spec 021 D22.6 (row 021-36): what the store process did, for the week's
 * measurement, read from its log. Per kind of batch: how many it wrote and
 * how many failed, how long they waited in the queue (p50 and max), and
 * how long its writer was busy with them.
 */

interface KindStats {
  written: number;
  failed: number;
  waits: number[];
  busyMs: number;
}

const KINDS: readonly WriteKind[] = ["edit", "record", "prune"];

export class WriteStats {
  #byKind = new Map<WriteKind, KindStats>();

  /** One batch ended: written (or found written by its mark) or failed. */
  record(kind: WriteKind, written: boolean, waitedMs: number, busyMs: number): void {
    let stats = this.#byKind.get(kind);
    if (stats === undefined) {
      stats = { written: 0, failed: 0, waits: [], busyMs: 0 };
      this.#byKind.set(kind, stats);
    }
    if (written) stats.written++;
    else stats.failed++;
    stats.waits.push(Math.max(0, waitedMs));
    stats.busyMs += Math.max(0, busyMs);
  }

  /**
   * The line of what ended since the last one, and starts counting again;
   * `null` when nothing ended: `edit: 12 written, 0 failed, queue wait p50
   * 3 ms max 40 ms, busy 120 ms; record: ...`.
   */
  take(): string | null {
    const parts: string[] = [];
    for (const kind of KINDS) {
      const stats = this.#byKind.get(kind);
      if (stats === undefined) continue;
      const waits = [...stats.waits].sort((a, b) => a - b);
      const p50 = waits[Math.floor((waits.length - 1) / 2)] ?? 0;
      const max = waits.at(-1) ?? 0;
      parts.push(
        `${kind}: ${stats.written} written, ${stats.failed} failed, ` +
          `queue wait p50 ${Math.round(p50)} ms max ${Math.round(max)} ms, ` +
          `busy ${Math.round(stats.busyMs)} ms`,
      );
    }
    this.#byKind = new Map();
    return parts.length === 0 ? null : parts.join("; ");
  }
}
