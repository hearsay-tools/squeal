import type { PreparedReports } from "../../core/delivery/prepared.js";
import { HOOK_TIMEOUT_MS } from "../../core/types/index.js";

/**
 * Row 011-288 (011 C8 as amended 2026-10-31): a report is told only once
 * its hook handed the whole text to the host. `withContext` gives this the
 * reports its deliveries prepared, with the store they hold open; the
 * process wrapper that writes the hook's output, or answers its host,
 * commits them after that step, the last one Squeal controls, and abandons
 * them when it fails. A report abandoned, or left open by a process that
 * dies, stays owed: the next eligible boundary tells it.
 */
export class HandOff {
  #taken: { readonly reports: PreparedReports; readonly close: () => void }[] = [];

  /** Takes `reports`, which wait for the verdict, and the `close` of the store they hold open. */
  take(reports: PreparedReports, close: () => void): void {
    this.#taken.push({ reports, close });
  }

  /** Whether a report waits for the verdict. */
  get pending(): boolean {
    return this.#taken.some((t) => t.reports.pending);
  }

  /** Commits every report taken, in order, and closes their stores; a failed commit abandons the rest. */
  commit(): void {
    this.#end((reports) => reports.commit());
  }

  /** Abandons every report taken and closes their stores. Never throws. */
  abandon(): void {
    this.#end((reports) => reports.abandon());
  }

  #end(verdict: (reports: PreparedReports) => void): void {
    const taken = this.#taken;
    this.#taken = [];
    let failure: { readonly error: unknown } | null = null;
    for (const { reports, close } of taken) {
      try {
        if (failure === null) verdict(reports);
        else reports.abandon();
      } catch (error) {
        failure = { error };
      } finally {
        close();
      }
    }
    if (failure !== null) throw failure.error;
  }
}

/**
 * How long a hand-off waits for its write or its verdict before it abandons
 * its reports: a hook's own budget, so the store's write lock is never held
 * waiting for a kill.
 */
export const HAND_OFF_BOUND_MS = HOOK_TIMEOUT_MS;

/** The writable side of a process stream, as `written` needs it. */
export interface OutputStream {
  write(text: string, callback: (error?: Error | null) => void): boolean;
}

/** Resolves once `text` is written to `stream`; rejects when the write fails or `boundMs` passes. */
export function written(stream: OutputStream, text: string, boundMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("output not written in time")), boundMs);
    try {
      stream.write(text, (error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      });
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}

/**
 * The Claude Code and Codex process wrappers' hand-off (row 011-288): writes
 * each non-empty text to its stream, then commits `handOff`'s reports once
 * every write is reported done, within `boundMs`. A failed or late write
 * abandons them. Without a report waiting, the texts are written as before,
 * with no wait.
 */
export async function writeThenCommit(
  handOff: HandOff,
  outputs: readonly (readonly [OutputStream, string])[],
  boundMs: number = HAND_OFF_BOUND_MS,
): Promise<void> {
  const texts = outputs.filter(([, text]) => text !== "");
  if (!handOff.pending) {
    for (const [stream, text] of texts) stream.write(text, () => {});
    handOff.commit();
    return;
  }
  try {
    await Promise.all(texts.map(([stream, text]) => written(stream, text, boundMs)));
  } catch {
    handOff.abandon();
    return;
  }
  try {
    handOff.commit();
  } catch {
    // The commit failed and rolled back: the report stays owed.
  }
}
