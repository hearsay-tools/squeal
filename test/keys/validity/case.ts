import type {
  CheckId,
  CoreEnvironmentInputs,
  FocusedFile,
  RunnerEnvironment,
  RunnerPackages,
  RunReport,
  TestFileRef,
} from "../../../src/core/types/index.js";

/*
 * A corpus case (task 011-37 section 3): data the harness runs at both trees.
 * Each names in `why` the row or raise it pins. A tree ignores a field it
 * does not know, which is the question asked: what the old code does with
 * the new input.
 */

/** Keys over fixed inputs: the environment hash and a check key. */
export interface KeyInput {
  readonly core: CoreEnvironmentInputs;
  readonly runner: RunnerEnvironment;
  /** Each hashed path's file hash, `null` for an absent file. */
  readonly hashes: Readonly<Record<string, string | null>>;
  readonly testFile: TestFileRef;
  readonly closure: readonly string[];
  /** The test file's installed-dependency segment. */
  readonly dependencies?: string;
  /** An install written under the case's scratch directory, whose fingerprint replaces `core`'s (011-85). */
  readonly installed?: Readonly<Record<string, string>>;
  /**
   * The environment's and the test file's packages over `installed`, keyed
   * through `dependencyKeys`: they replace `core`'s installed dependencies
   * and `dependencies` (011-162).
   */
  readonly packages?: {
    readonly environment: RunnerPackages;
    readonly testFile?: RunnerPackages;
  };
}

/** A run's report of one test file, and the checks its previous key held. */
export interface RowsInput {
  readonly testFile: TestFileRef;
  readonly report: Partial<RunReport>;
  readonly previousChecks: readonly CheckId[];
}

/** A script run in a fixture worktree under the tree's recorder, for one test file. */
export interface ObserveInput {
  readonly files: Readonly<Record<string, string>>;
  /** The test file the script's process works for. */
  readonly testFile: string;
  /** Run as `node -e`, in the worktree. */
  readonly script: string;
}

/** Runs several worktrees stored under one key, and the worktree that looks it up. */
export interface AcceptInput {
  readonly testFile: TestFileRef;
  /** In order; each applied to its own worktree's states. */
  readonly runs: readonly {
    readonly worktree: string;
    readonly report: Partial<RunReport>;
    readonly previousChecks?: readonly CheckId[];
    readonly recordedAt: number;
  }[];
  readonly receiver: string;
  /** The runs are stored under the file's key at a format read as one, which the lookup reads (011-38). */
  readonly readAsOne?: true;
  /** The checks the receiver's current results of the file hold before the lookup (D8). */
  readonly current?: readonly CheckId[];
  /** The receiving worktree's `squeal.config.json`. */
  readonly policy?: Readonly<Record<string, unknown>>;
  /** The existing files its declared inputs select (format 12 read them, 004 D6). */
  readonly declared?: readonly string[];
  /** The reason the receiver's own timeout or crash, after it took the runs' results, makes the file unknown (011-59). */
  readonly unknown?: string;
  /**
   * The runs are stored at the key each tree computes for the file in a
   * worktree with this install, and the receiver looks up its own key there
   * with its own keys read as one (task 011-85 R4).
   */
  readonly installed?: Readonly<Record<string, string>>;
  /** With `installed`: paths with no file that the file's closure names, as a snapshot path (task 011-158). */
  readonly absent?: readonly string[];
  /** The packages the test file's closure imports over `installed`; it reaches `child_process` otherwise (011-162 R3). */
  readonly packages?: RunnerPackages;
  /**
   * The receiver is keyed at the key first, and each run is stored as its
   * scheduler stores one (`storeResults`), so a pass that replaces a fail
   * heals the receiver; its states and key row after the runs are an output
   * (review 0.1.266, B1).
   */
  readonly heal?: true;
}

/** A fixture repository keyed as a daemon keys it. */
export interface AssembleInput {
  /** Committed, `squeal.config.json` among them. */
  readonly files: Readonly<Record<string, string>>;
  /** Written after the commit: gitignored artifacts among them. */
  readonly untracked?: Readonly<Record<string, string>>;
  /** Each test file and the paths the runner reported it imports. */
  readonly closures: readonly { readonly path: string; readonly imports: readonly string[] }[];
  /** Paths among the files the stat cache holds before bootstrap, as a predecessor left them (011-36). */
  readonly cached?: readonly string[];
  /** Read from the runner (`setEnvironments`) in place of one fixed environment hash (011-36). */
  readonly environment?: RunnerEnvironment;
  /**
   * Then the runner's closures replace the first ones, the `removed` test
   * files are forgotten, and untracked paths are tracked again (011-36).
   */
  readonly after?: {
    readonly closures: readonly { readonly path: string; readonly imports: readonly string[] }[];
    readonly removed: readonly string[];
  };
}

/** One file of a finished tier, and what the ledger holds of it when the tier is recorded. */
export interface StoreFile {
  readonly path: string;
  /** The file's key now: the one it ran under (default), or one an edit moved it to. */
  readonly key?: "ran" | "moved";
  /** The tier that holds it: this one (default), another (a newer run), or none. */
  readonly running?: "ran" | "other" | null;
  /** The key of its current results: none (default), or one of the above. */
  readonly result?: "ran" | "moved" | null;
  /** The ledger still holds it as selected; default true. */
  readonly held?: boolean;
  /** What must hold still during the run. */
  readonly inputs?: readonly string[];
  readonly forced?: boolean;
  /** Paths the run read beyond its closure (`ObservedGrowth`); `firstSeen` among them. */
  readonly growth?: { readonly growth: readonly string[]; readonly firstSeen?: readonly string[] };
}

/** A finished tier recorded as the scheduler records one: each file's decision. */
export interface StoreInput {
  readonly files: readonly StoreFile[];
  readonly end?: RunReport["end"];
  /** The files the run completed, each with one passing test. */
  readonly completed: readonly string[];
  /** The runner's withholds (`RunReport.withheld`). */
  readonly withheld?: readonly string[];
  /**
   * Paths written during the run whose bytes hash as before: the completion
   * barrier withholds the files whose inputs name one (013-02).
   */
  readonly touched?: readonly string[];
  /** Files the barrier withheld once already at the key they ran under (007-30). */
  readonly touchedBefore?: readonly string[];
  /** Paths whose content changed during the run. */
  readonly changed?: readonly string[];
  /** The install moved: the whole tier is queued again (`true`), or these files. */
  readonly requeue?: true | readonly string[];
  /** A backlog tier an edit cancelled. */
  readonly cancelled?: boolean;
  /** The global setup failed before these files started. */
  readonly startup?: readonly string[];
  /** Files whose run loaded environment files their key lacked (003-43). */
  readonly environment?: readonly string[];
}

/** A fixture the Vitest adapter runs, each run held until the paths it names are heard touched. */
export interface VitestInput {
  /** The fixture's files: `$STARTED` and `$HOLD` stand for the held runs' markers, as string literals. */
  readonly files: Readonly<Record<string, string>>;
  /** Policy `vitest.exclude`: test-file globs Squeal does not list (row 011-95). */
  readonly exclude?: readonly string[];
  /**
   * In turn on one adapter: the files run, the paths touched once one of
   * them started, the reason the run is then cancelled with, if any (row
   * 011-56), or the reason its signal was aborted with before it started
   * (review 0.1.239 B2), whether its `fileEnded` callback throws (row
   * 011-54), and whether the instance's temp directory is removed before it,
   * so it starts no test file and touches nothing (row 013-06). `edits` are
   * written in turn after the touch, each followed by the `invalidate` and
   * `affected` of its revision's runner part (row 011-95).
   */
  readonly runs: readonly {
    readonly files: readonly TestFileRef[];
    readonly touched: readonly string[];
    readonly cancel?: string;
    readonly cancelBefore?: string;
    readonly fileEndedThrows?: boolean;
    readonly removeTempDir?: boolean;
    readonly edits?: readonly { readonly path: string; readonly text: string }[];
    /** A focused run's texts per file (`RunOptions.checks`, row 011-144): see `selectedOf`. */
    readonly checks?: readonly FocusedFile[];
  }[];
  /** Read each project's environment files once open, as the case's keys (row 011-88). */
  readonly environment?: true;
}

/** The Pythons the `adapter:pytest` kind runs on, as CI installs them (`test/helpers/pytest-env.ts`). */
export type PytestPython = "3.10" | "3.13";

/** The variable a driver reads each version's environment from (`python.ts`): its directory, or why there is none. */
export const PYTHONS_VARIABLE = "SQUEAL_VALIDITY_PYTHONS";

export type Pythons = Partial<Record<PytestPython, { env: string } | { reason: string }>>;

/** A fixture the pytest adapter runs on one of the kind's Pythons (row 011-48). */
export interface PytestInput {
  /** The project's environment: one synced per comparison outside the worktree (`python.ts`), which both trees key alike. */
  readonly python: PytestPython;
  /** The worktree's files. */
  readonly files: Readonly<Record<string, string>>;
  /** The project's policy entry beyond its name; without `python`, the synced environment. */
  readonly project?: {
    readonly include?: readonly string[];
    readonly exclude?: readonly string[];
    readonly args?: readonly string[];
    readonly env?: Readonly<Record<string, string>>;
    /** Relative to the worktree, in place of the synced environment. */
    readonly python?: string;
  };
  /** The synced environment linked in as `.venv`, which D2's discovery finds, in place of a declared one. */
  readonly venv?: true;
  /**
   * In turn on one adapter: edits written and invalidated first (a text,
   * `null` to delete, absent to write the same bytes again), then the files
   * run, under Squeal's deadline (default 60 s).
   */
  readonly runs: readonly {
    readonly files: readonly string[];
    readonly edits?: readonly { readonly path: string; readonly text?: string | null }[];
    readonly timeoutMs?: number;
    /** A focused run's texts per file path (`RunOptions.checks`, row 011-144): see `selectedOf`. */
    readonly checks?: readonly { readonly path: string; readonly texts: readonly string[] }[];
  }[];
  /** Paths whose affected test files are read at open and after each run. */
  readonly affected?: readonly string[];
}

export type Case = { readonly name: string; readonly why: string } & (
  | { readonly kind: "key"; readonly input: KeyInput }
  | { readonly kind: "rows"; readonly input: RowsInput }
  | { readonly kind: "observe"; readonly input: ObserveInput }
  | { readonly kind: "accept"; readonly input: AcceptInput }
  | { readonly kind: "assemble"; readonly input: AssembleInput }
  | { readonly kind: "store"; readonly input: StoreInput }
  | { readonly kind: "adapter:vitest"; readonly input: VitestInput }
  | { readonly kind: "adapter:pytest"; readonly input: PytestInput }
);

export type CaseKind = Case["kind"];

/**
 * What a tree gave for one case. `keys` are compared and reported; where they
 * are equal, `outputs` must be equal; `wording` is listed and never fails.
 */
export interface CaseOutput {
  readonly keys?: unknown;
  readonly outputs?: unknown;
  readonly wording?: unknown;
  /** The case threw: the message, compared as an output. */
  readonly error?: string;
}
