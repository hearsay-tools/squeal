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
  /** The receiving worktree's `squeal.config.json`. */
  readonly policy?: Readonly<Record<string, unknown>>;
  /** The existing files its declared inputs select (format 12 read them, 004 D6). */
  readonly declared?: readonly string[];
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

export type Case = { readonly name: string; readonly why: string } & (
  | { readonly kind: "key"; readonly input: KeyInput }
  | { readonly kind: "rows"; readonly input: RowsInput }
  | { readonly kind: "observe"; readonly input: ObserveInput }
  | { readonly kind: "accept"; readonly input: AcceptInput }
  | { readonly kind: "assemble"; readonly input: AssembleInput }
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
