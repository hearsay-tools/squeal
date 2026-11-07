import type { ImportGraph } from "../store/import-graph.js";
import type { CheckRunner } from "../types/check-groups.js";
import type { EpochMs, RelativePath } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";

/*
 * Spec 015 D11 (row 015-109): what `squeal reach` reads, as plain data. The
 * analysis in this folder is pure over a `ReachSnapshot`; only `read.ts`
 * touches the stores and the files.
 */

/**
 * What a test file's coverage record at its current key says (D8):
 * `unknown` with coverage off or a runner that gives no records (pytest),
 * `none` with no record at the current key.
 */
export type CoverageView =
  | { readonly kind: "unknown" }
  | { readonly kind: "none" }
  | {
      readonly kind: "record";
      /** Sources a function of which, other than the module's top level, ran. */
      readonly called: ReadonlySet<RelativePath>;
      /** Every source the record holds at confirmed bytes, called or not. */
      readonly loaded: ReadonlySet<RelativePath>;
      /** Sources the run executed whose bytes the record cannot confirm. */
      readonly unread: ReadonlySet<RelativePath>;
    };

/** One listed test file of the worktree. */
export interface ReachTestFile {
  readonly ref: TestFileRef;
  readonly runner: CheckRunner;
  /** False for a file of a group at `manual` (spec 019): it runs on no edit. */
  readonly inSuite: boolean;
  /** Recorded seconds: at its current key, else its newest result; `null` when none. */
  readonly seconds: number | null;
  /** Its trusted closure (`closureFor`); `null` when none is. */
  readonly closure: readonly RelativePath[] | null;
  /** Paths a process it started imported (`observedModules.`, `observedDirect.`). */
  readonly childProcess: ReadonlySet<RelativePath>;
  /** Paths its runs read beyond its imports (`observed.`). */
  readonly runtimeRead: ReadonlySet<RelativePath>;
  readonly coverage: CoverageView;
}

/** One edit: a `watch` revision in which `HEAD` did not move, of any worktree. */
export interface ReachEdit {
  readonly at: EpochMs;
  readonly paths: readonly RelativePath[];
}

/** What the analysis asks about a module; `read.ts` answers from its bytes and the code store. */
export interface ModuleFacts {
  /** A module of imports and re-exports only. */
  barrel(path: RelativePath): boolean;
  /** The targets `barrel` re-exports with `export *` (not `export type *`), as `project` resolves them. */
  starTargets(path: RelativePath, project: string): ReadonlySet<RelativePath>;
  /** The counter's function count at the file's current bytes (D3); `null` when not known. */
  functions(path: RelativePath): number | null;
}

/** The `squeal.config.json` `inputs` entry that gives `path` to a test file: its test glob and input glob. */
export interface DeclaredPattern {
  /** The test-file glob of a map entry; `null` for the list shape, which applies to every test file. */
  readonly tests: string | null;
  readonly input: string;
}

/** The coverage policy as the report reads it. */
export interface ReachCoverage {
  /** `coverage.enabled` and `complexity.enabled` both on (`coverageOn`). */
  readonly on: boolean;
  readonly coverageEnabled: boolean;
  readonly complexityEnabled: boolean;
}

/** Everything the report reads from the stores, the policy and the files. */
export interface ReachSnapshot {
  readonly testFiles: readonly ReachTestFile[];
  readonly edits: readonly ReachEdit[];
  readonly coverage: ReachCoverage;
  /** Row 015-108's stored edges and environment files; `null` while the store has none. */
  readonly graph: ImportGraph | null;
  readonly modules: ModuleFacts;
  /** The `inputs` entry that gives `path` to the test file at `testPath`; `null` when none does. */
  declared(testPath: RelativePath, path: RelativePath): DeclaredPattern | null;
}
