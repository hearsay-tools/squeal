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

export type Case = { readonly name: string; readonly why: string } & (
  | { readonly kind: "key"; readonly input: KeyInput }
  | { readonly kind: "rows"; readonly input: RowsInput }
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

/** What the driver is told beside the cases. */
export interface DriverContext {
  /** An empty directory the case may write in, one per case below it. */
  readonly scratch: string;
}
