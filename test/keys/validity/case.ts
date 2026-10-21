import type {
  CheckId,
  CoreEnvironmentInputs,
  RunnerEnvironment,
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
}

/** A fixture repository keyed as a daemon keys it. */
export interface AssembleInput {
  /** Committed, `squeal.config.json` among them. */
  readonly files: Readonly<Record<string, string>>;
  /** Written after the commit: gitignored artifacts among them. */
  readonly untracked?: Readonly<Record<string, string>>;
  /** Each test file and the paths the runner reported it imports. */
  readonly closures: readonly { readonly path: string; readonly imports: readonly string[] }[];
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
  /** In turn on one adapter: the files run, and the paths touched once one of them started. */
  readonly runs: readonly {
    readonly files: readonly TestFileRef[];
    readonly touched: readonly string[];
  }[];
}

export type Case = { readonly name: string; readonly why: string } & (
  | { readonly kind: "key"; readonly input: KeyInput }
  | { readonly kind: "rows"; readonly input: RowsInput }
  | { readonly kind: "observe"; readonly input: ObserveInput }
  | { readonly kind: "accept"; readonly input: AcceptInput }
  | { readonly kind: "assemble"; readonly input: AssembleInput }
  | { readonly kind: "store"; readonly input: StoreInput }
  | { readonly kind: "adapter:vitest"; readonly input: VitestInput }
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
