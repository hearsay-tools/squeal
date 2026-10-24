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
    /**
     * Spec 004 D7: a main agent's Stop blocks, as `requireFullSuite` does,
     * while a slow file is not current at this revision. Default `false`.
     */
    readonly requireSlowSuite: boolean;
    /**
     * Spec 004 D9 as amended 2026-10-12: with `requireSlowSuite` on, how long
     * a main agent's Stop waits for its slow files to become current before
     * it blocks naming the files still running. Default `120000`.
     */
    readonly slowWaitMs: number;
  };
  readonly testCommand: {
    /**
     * Spec 005 D8: an agent's first test command whose every test file has a
     * current result is denied once, its reason the results. Default `false`.
     */
    readonly denyWhenCurrent: boolean;
  };
  readonly baseline: {
    /**
     * Spec 001 D5: "the baseline is a lookup [...] followed by a run of the
     * misses, or lookup only, per policy." Default `"lookup-only"` (001 D11
     * as amended 2026-10-23, row 011-159): a held inherited fail still runs
     * once (011 C4 step 3).
     */
    readonly onStart: "lookup-then-run-missing" | "lookup-only";
  };
  /**
   * Spec 001 D11: "extra closure globs for fixtures read at runtime, either a
   * list applied to every test file or a map from test-file glob to input
   * globs so one runtime read does not re-key the whole suite." Default `[]`.
   */
  readonly inputs: PolicyInputs;
  readonly observe: {
    /**
     * Spec 001 D11 as amended (task 001-132): the runner records the project
     * paths each test file reads, spawns or loads at run time, and they join
     * its closure (D3, D4). `false` keys by static imports and declared
     * `inputs` alone, as before. Default `true`.
     */
    readonly runtimeInputs: boolean;
  };
  readonly env: {
    /** Spec 001 D11: "environment variables included in the environment hash." Default `[]`. */
    readonly allowlist: readonly string[];
  };
  readonly runner: {
    /** Test files per tier (D5). Default `4`. */
    readonly tierSize: number;
    /**
     * Test files per tier while the queue holds backlog work only (D5 step 5
     * as amended, task 001-124): every queued backlog file up to this many,
     * and up to `BACKLOG_TIER_BUDGET_MS` of estimated wall time (task
     * 001-366). Default `200`.
     */
    readonly backlogTierSize: number;
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
  /**
   * Spec 007 D1: pytest projects, validated beside the Vitest and node:test
   * projects of the repository. A bad entry is a problem with that project
   * skipped (001 D11). Default `[]`.
   */
  readonly pytest: readonly PytestProject[];
  readonly vitest: {
    /**
     * Spec 001 D11 (task 001-349): Vitest project names Squeal never runs,
     * so a project added later runs by default. An excluded project is never
     * created, keyed or counted; a name no project has is a problem, and the
     * rest apply. Default `[]`.
     */
    readonly excludeProjects: readonly string[];
    /**
     * Spec 004 D7 as amended 2026-10-18 (task 004-81): Vitest test-file
     * globs, relative to the worktree root, that Squeal never lists, runs,
     * keys or counts, as `nodeTest[].exclude` and `pytest[].exclude` do for
     * their projects: a suite of a build output Squeal does not produce
     * belongs to CI or the agent. Default `[]`.
     */
    readonly exclude: readonly string[];
  };
  /** Spec 004 D1, D7: the slow suites and how the slow tier runs them. */
  readonly slow: SlowPolicy;
  readonly delivery: {
    /**
     * Spec 001 D9, D11 as amended (task 001-292): after an edit, the delivery
     * names the changed code files no test Squeal runs reads, once per file
     * per consumer. Default `true`.
     */
    readonly uncoveredEdits: boolean;
  };
  readonly daemon: {
    /** Spec 001 D10: idle exit "with no registered consumers (default 60 minutes)". */
    readonly idleExitMinutes: number;
    /**
     * Spec 001 D10 as amended (task 001-415): a daemon with a consumer
     * registered and no edit, tier, wait or request for this long stops; the
     * next hook starts it again. Default `30`.
     */
    readonly unusedExitMinutes: number;
  };
  readonly store: {
    /** Spec 001 D8: "drop other keys after 7 days". Default `7`. */
    readonly retentionDays: number;
    /** LRU backstop (D8). D11 gives no default; `null` means no cap. */
    readonly maxSizeMb: number | null;
  };
  /** Spec 015 D1: complexity per function. With `enabled` false Squeal counts nothing and keeps no code store. */
  readonly complexity: {
    /** Default `false`. */
    readonly enabled: boolean;
    /** A function fails when its CC is above this. Default `20`, ESLint's default `max`. */
    readonly threshold: number;
    /** Worktree-relative globs of the files counted. Default every extension the counter reads. */
    readonly include: readonly string[];
    /** Globs removed from `include`; a project's list replaces the default. */
    readonly exclude: readonly string[];
    /** A larger file is not counted (D6). Default `524288`, 512 KiB. */
    readonly maxFileBytes: number;
    /** D7: Stop also counts each function that went over since registration. Default `false`. */
    readonly blocking: boolean;
  };
  /** Spec 015 D8 (wave 2): coverage from Squeal's own Vitest runs. Needs `complexity.enabled`. */
  readonly coverage: { readonly enabled: boolean };
  /** Spec 015 D9 (wave 2): a function fails when its CRAP is above `threshold`. Default `30`. */
  readonly crap: { readonly threshold: number };
}

/**
 * Policy `inputs`: input globs for every test file, or test-file glob to the
 * input globs of the test files it matches (spec 001 D3, D11). Globs are
 * worktree-relative, compiled by `globToRegExp` in src/core/keys.
 */
export type PolicyInputs = readonly string[] | Readonly<Record<string, readonly string[]>>;

/**
 * Spec 004 D7, one object as the 2026-10-08 amendment decides: which test
 * files are slow and how hard the slow tier may load the host.
 */
export interface SlowPolicy {
  /**
   * Spec 004 D1: worktree-relative test-file globs, matched against every
   * runner's test files; a match is a slow file. Default `[]`.
   */
  readonly include: readonly string[];
  /** Workers of one slow run (D2). Default `2`. */
  readonly maxWorkers: number;
  /** The load guard's threshold, one-minute load average per CPU (D3). Default `1.0`. */
  readonly maxLoadPerCpu: number;
  /** How long the load guard defers a slow file before it runs anyway (D3). Default `600000`. */
  readonly maxDeferMs: number;
  /**
   * The most slow files one slow tier runs at once when the machine is idle,
   * and the slot's permits per user (D2 as amended 2026-10-09). Default `4`.
   */
  readonly maxParallel: number;
  /**
   * D2 as amended 2026-10-18 (task 004-82): `"tokens"` orders slow files of
   * one class by evidence, tokens from the revision's changed files matched
   * against each slow file and its helpers, then by duration; `"duration"`
   * by duration alone. Default `"tokens"`.
   */
  readonly rank: "tokens" | "duration";
  // Spec 004 D2, D7 as amended 2026-10-18 (004-79, row 004-80): when the slow tier starts.
  /**
   * `"continuous"`: once the current revision's fast work is done and the
   * revision is `quietMs` old, mid-turn or not. `"idle"`: once every consumer
   * pauses or none is registered. Default `"continuous"`.
   */
  readonly trigger: SlowTrigger;
  /**
   * How long the latest revision must be quiet before a continuous slow tier
   * starts. Default `3000`: past it a longer window barely lowers how often
   * the next edit discards the slow run, and delays every slow result
   * (`docs/specifications/004-slow-suites/tasks/004-80/notes.md`).
   */
  readonly quietMs: number;
}

/** Spec 004 D2 trigger (a): `slow.trigger`. */
export type SlowTrigger = "continuous" | "idle";

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
  /** Spec 004 D1: every file `include` lists is a slow file. Absent means `false`. */
  readonly slow?: boolean;
}

/**
 * One pytest project (spec 007 D1). Its identity is `(runner "pytest", name)`.
 */
export interface PytestProject {
  /** Unique among `pytest` entries. */
  readonly name: string;
  /** Relative to the worktree root; absent means the root. pytest runs from here. */
  readonly cwd?: string;
  /**
   * An environment directory or interpreter path relative to `cwd`, inside
   * the worktree; absolute only for a declared out-of-tree environment.
   * Absent means D2's discovery (`.venv`, then `.pdm-python`).
   */
  readonly python?: string;
  /** Arguments the project's own command passes that change semantics, such as `--ds=settings`. Default `[]`. */
  readonly args: readonly string[];
  /** Merged over the run environment, never replacing it. Default `{}`. */
  readonly env: Readonly<Record<string, string>>;
  /** Test-file globs relative to `cwd`. At least one. */
  readonly include: readonly string[];
  /** Globs relative to `cwd` removed from `include`. */
  readonly exclude?: readonly string[];
  /** Spec 004 D1: every file `include` lists is a slow file. Absent means `false`. */
  readonly slow?: boolean;
  /** Spec 007 D6: test files per pytest process. Absent means 5. */
  readonly batchSize?: number;
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

/** Spec 001 D11 defaults, with spec 004 D7's `slow` and `stop.requireSlowSuite`. */
export const DEFAULT_POLICY: Policy = {
  interrupt: { onRegression: true },
  stop: {
    blockOnKnownFailures: false,
    requireFullSuite: false,
    waitMs: 0,
    requireSlowSuite: false,
    slowWaitMs: 120_000,
  },
  testCommand: { denyWhenCurrent: false },
  baseline: { onStart: "lookup-only" },
  inputs: [],
  observe: { runtimeInputs: true },
  env: { allowlist: [] },
  runner: { tierSize: 4, backlogTierSize: 200, timeoutMs: 600_000 },
  nodeTest: [],
  pytest: [],
  vitest: { excludeProjects: [], exclude: [] },
  slow: {
    include: [],
    maxWorkers: 2,
    maxLoadPerCpu: 1,
    maxDeferMs: 600_000,
    maxParallel: 4,
    rank: "tokens",
    trigger: "continuous",
    quietMs: 3_000,
  },
  delivery: { uncoveredEdits: true },
  daemon: { idleExitMinutes: 60, unusedExitMinutes: 30 },
  store: { retentionDays: 7, maxSizeMb: null },
  complexity: {
    enabled: false,
    threshold: 20,
    include: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,py}"],
    exclude: ["**/dist/**", "**/build/**", "**/vendor/**", "**/*.min.js"],
    maxFileBytes: 524_288,
    blocking: false,
  },
  coverage: { enabled: false },
  crap: { threshold: 30 },
};

/**
 * What the one policy loader returns (spec 001 D11, review S3): the policy
 * with the defaults applied for every missing or bad key, and one line per
 * unknown key or value of the wrong type. A missing file has no problems.
 */
export interface LoadedPolicy {
  readonly policy: Policy;
  readonly problems: readonly string[];
  /**
   * The file exists and cannot be read, is not JSON or is not an object, so
   * `policy` is the defaults: a reload keeps the `nodeTest` and `pytest`
   * projects it had (011 C10, *Projects at a reload*, row 011-78).
   */
  readonly unparsed?: true;
}
