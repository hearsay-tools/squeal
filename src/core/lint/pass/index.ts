import type { LintPassOptions } from "./types.js";

export type * from "./provider.js";
export type * from "./types.js";

/**
 * Spec 017 D7: the daemon's lint pass, beside 015's code pass. It runs in
 * the daemon process, outside the scheduler's lanes, and lints in the
 * provider's worker. Passes never overlap: a nudge during one runs one more
 * after it.
 */
export interface LintPass {
  /** A revision may be stored: run a pass soon. */
  nudge(): void;
  /** Resolves once no pass runs or is due. */
  idle(): Promise<void>;
  /** Waits for the pass in flight, then closes the provider and the lint store. */
  close(): Promise<void>;
}

export function createLintPass(_options: LintPassOptions): LintPass {
  return {
    nudge() {},
    idle: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
}
