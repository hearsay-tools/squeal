/**
 * Project policy from `squeal.config.json` at the repository root.
 *
 * Spec 001 D11: "`squeal.config.json` at the repository root, committed, all
 * keys optional". `Policy` is the resolved shape with every default applied;
 * `PolicyFile` is what the file may contain.
 */
export interface Policy {
  readonly interrupt: {
    /** Spec 001 D9: PreToolUse denies once on an undelivered regression. Default `true`. */
    readonly onRegression: boolean;
  };
  readonly stop: {
    /** Default `false`. */
    readonly blockOnKnownFailures: boolean;
    /** Default `false`. */
    readonly requireFullSuite: boolean;
    /** Spec 001 D9: Stop waits "up to `stop.waitMs` for pending checks of the current revision". Default `0`. */
    readonly waitMs: number;
  };
  readonly baseline: {
    /** Spec 001 D5: "the baseline is a lookup [...] followed by a run of the misses, or lookup only, per policy." */
    readonly onStart: "lookup-then-run-missing" | "lookup-only";
  };
  /** Spec 001 D11: "extra closure globs, for fixtures read at runtime." Default `[]`. */
  readonly inputs: readonly string[];
  readonly env: {
    /** Spec 001 D11: "environment variables included in the environment hash." Default `[]`. */
    readonly allowlist: readonly string[];
  };
  readonly runner: {
    /** Test files per tier (D5). Default `4`. */
    readonly tierSize: number;
    /**
     * Per run. Spec 001 D11: "`runner.timeoutMs` per run (`600000`, because a
     * synchronous loop in a test worker cannot be stopped by the runner's own
     * test timeout)". `null` means no limit.
     */
    readonly timeoutMs: number | null;
    /** Default `1` in v1. */
    readonly maxConcurrentRuns: number;
  };
  readonly daemon: {
    /** Spec 001 D10: idle exit "with no registered consumers (default 60 minutes)". */
    readonly idleExitMinutes: number;
  };
  readonly store: {
    /** Spec 001 D8: "drop other keys after 7 days". Default `7`. */
    readonly retentionDays: number;
    /** LRU backstop (D8). D11 gives no default; `null` means no cap. */
    readonly maxSizeMb: number | null;
  };
}

type DeepPartial<T> = {
  readonly [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

/** Contents of `squeal.config.json`. Spec 001 D11: "all keys optional". */
export type PolicyFile = DeepPartial<Policy>;

/** Spec 001 D11 defaults. */
export const DEFAULT_POLICY: Policy = {
  interrupt: { onRegression: true },
  stop: { blockOnKnownFailures: false, requireFullSuite: false, waitMs: 0 },
  baseline: { onStart: "lookup-then-run-missing" },
  inputs: [],
  env: { allowlist: [] },
  runner: { tierSize: 4, timeoutMs: 600_000, maxConcurrentRuns: 1 },
  daemon: { idleExitMinutes: 60 },
  store: { retentionDays: 7, maxSizeMb: null },
};
