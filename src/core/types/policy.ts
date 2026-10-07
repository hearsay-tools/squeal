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
  /**
   * Spec 001 D11: "extra closure globs for fixtures read at runtime, either a
   * list applied to every test file or a map from test-file glob to input
   * globs so one runtime read does not re-key the whole suite." Default `[]`.
   */
  readonly inputs: PolicyInputs;
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
  };
  /**
   * Spec 003 D1: node:test projects, validated beside any Vitest project of
   * the repository (D7). A bad entry is a problem with that project skipped
   * (001 D11). Default `[]`.
   */
  readonly nodeTest: readonly NodeTestProject[];
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

/**
 * Policy `inputs`: input globs for every test file, or test-file glob to the
 * input globs of the test files it matches (spec 001 D3, D11). Globs are
 * worktree-relative, compiled by `globToRegExp` in src/core/keys.
 */
export type PolicyInputs = readonly string[] | Readonly<Record<string, readonly string[]>>;

/**
 * One node:test project (spec 003 D1). Its identity is `(runner "node-test",
 * name)`.
 */
export interface NodeTestProject {
  /** Unique among `nodeTest` entries; `squeal init` names it after the npm script. */
  readonly name: string;
  /** Relative to the worktree root; absent means the root. */
  readonly cwd?: string;
  /** An executable path or name; absent means the `node` on the daemon's PATH. */
  readonly node?: string;
  /** The flags before `--test`, in order, such as `["--import", "tsx"]`. Default `[]`. */
  readonly argv: readonly string[];
  /** Merged over the daemon's environment, never replacing it. Default `{}`. */
  readonly env: Readonly<Record<string, string>>;
  /** Test-file globs relative to `cwd`. At least one. */
  readonly include: readonly string[];
  /** Globs relative to `cwd` removed from `include`. */
  readonly exclude?: readonly string[];
}

/** True when `A` and `B` are the same type. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type DeepPartial<T> = {
  readonly [K in keyof T]?: Same<T[K], PolicyInputs> extends true
    ? T[K]
    : T[K] extends readonly unknown[]
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
  runner: { tierSize: 4, timeoutMs: 600_000 },
  nodeTest: [],
  daemon: { idleExitMinutes: 60 },
  store: { retentionDays: 7, maxSizeMb: null },
};

/**
 * What the one policy loader returns (spec 001 D11, review S3): the policy
 * with the defaults applied for every missing or bad key, and one line per
 * unknown key or value of the wrong type. A missing file has no problems.
 */
export interface LoadedPolicy {
  readonly policy: Policy;
  readonly problems: readonly string[];
}
