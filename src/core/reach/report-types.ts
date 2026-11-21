import type { EpochMs, RelativePath } from "../types/common.js";
import type { CoverageState, PathKind } from "./pairs.js";
import type { SecondGateway, Suggestion } from "./suggest.js";

/*
 * Spec 015 D11: the report `squeal reach` prints, and `--json` gives in
 * this versioned shape. Shares are fractions of recorded seconds.
 */

export const REACH_REPORT_VERSION = 1;

/** Shares of seconds; a state or kind with none is absent. */
export type Split<K extends string> = Partial<Record<K, number>>;

/** One way a file's pairs reach their test files: a path kind and, for imports and setup, a gateway. */
export interface ReachRoute {
  readonly kind: PathKind;
  readonly gateway: RelativePath | null;
  readonly chain: readonly RelativePath[];
  readonly testFiles: number;
  readonly seconds: number;
  readonly coverage: Split<CoverageState>;
}

/** Part 1: one file, or the files that share a gateway and a reach. */
export interface FileEntry {
  /** Its place in `files`' order, from 1; in `byEdits` too. */
  readonly rank: number;
  readonly files: readonly RelativePath[];
  /** The folder the collapsed files share; `null` for one file. */
  readonly folder: RelativePath | null;
  readonly testFiles: number;
  /** Recorded seconds one edit re-runs; for several files, of one of them. */
  readonly seconds: number;
  readonly share: number;
  readonly avoidableSeconds: number;
  /** Seconds of its import pairs whose coverage is unknown; the order counts them with the avoidable ones (015-116, P8). */
  readonly unknownSeconds: number;
  /** Edits in the window that changed one of the files, and the seconds they re-ran. */
  readonly edits: number;
  readonly editSeconds: number;
  readonly coverage: Split<CoverageState>;
  readonly kinds: Split<PathKind>;
  /** The kind of its main route: of the routes with avoidable seconds when it has any (015-116, P3). */
  readonly kind: PathKind;
  readonly gateway: ReachRoute | null;
  readonly second: SecondGateway | null;
  readonly suggestion: Suggestion | null;
  /** When child-process and runtime-read seconds outweigh import seconds: Squeal re-runs these by design. */
  readonly note?: string;
}

/** Part 2: a test file that re-runs on many files' edits. */
export interface TestEntry {
  readonly project: string;
  readonly path: RelativePath;
  readonly seconds: number | null;
  /** Source files in its `import` closure. */
  readonly sources: number;
  /** Of them, those it calls; `null` when its coverage cannot tell. */
  readonly called: number | null;
  readonly edits: number;
  /** Its own direct import that brings in most of its uncalled files. */
  readonly via: { readonly path: RelativePath; readonly uncalled: number } | null;
  /** Pair-seconds: its seconds times the import-path source files it loads and never calls (015-116, P12). */
  readonly avoidablePairSeconds: number;
}

/** A named file in full. */
export interface NamedFile {
  readonly path: RelativePath;
  readonly testFiles: number;
  readonly seconds: number;
  readonly share: number;
  readonly edits: number;
  readonly coverage: Split<CoverageState>;
  /** `--limit` routes, by seconds, each with `--limit` test files (015-116, P10). */
  readonly routes: readonly (ReachRoute & {
    readonly tests: readonly {
      readonly path: RelativePath;
      readonly seconds: number | null;
      readonly coverage: CoverageState;
    }[];
    readonly moreTests: number;
  })[];
  readonly moreRoutes: number;
  readonly second: SecondGateway | null;
  readonly suggestion: Suggestion | null;
  readonly note?: string;
}

/** What the report proposes; it starts nothing. */
export type Proposal =
  /** No daemon listed this worktree's test files yet: the whole answer (015-116, P9). */
  | {
      readonly kind: "start";
      readonly command: string;
      /** `baseline.onStart` runs the test files its lookups find no result for. */
      readonly runsMissing: boolean;
    }
  /** The listed test files have no recorded result: the whole answer. */
  | { readonly kind: "warmup"; readonly command: string; readonly testFiles: number | null }
  /** Some test files have no recorded seconds. */
  | { readonly kind: "seconds"; readonly command: string; readonly testFiles: number }
  /** Coverage is off (option A). */
  | { readonly kind: "coverage"; readonly keys: readonly string[]; readonly command: string }
  /** Test files with recorded seconds and no coverage record at their current keys (015-116, P7). */
  | {
      readonly kind: "records";
      /** A forced checkpoint: the only run of a current result, about one run of the whole suite. */
      readonly command: string;
      /** Queues a run of a test file with no result at its inputs. */
      readonly retry: string;
      readonly testFiles: number;
      readonly share: number;
      /** With a result at their inputs: only `command` re-runs them. */
      readonly current: readonly RelativePath[];
      /** With no result at their inputs: `retry` runs each once. */
      readonly noResult: readonly RelativePath[];
    };

export interface ReachReport {
  readonly v: typeof REACH_REPORT_VERSION;
  /** False while no test file has a recorded result; the proposals are then the answer. */
  readonly history: boolean;
  readonly suite: {
    readonly testFiles: number;
    readonly seconds: number;
    readonly withoutSeconds: number;
    readonly withoutClosure: number;
    readonly leftOut: number;
  };
  /** The edits the store keeps of paths this worktree has, by time; `null` with none (015-122). */
  readonly window: { readonly from: EpochMs; readonly to: EpochMs; readonly edits: number } | null;
  readonly coverage: "on" | "off";
  /** Runners of the suite whose runs give no coverage records, while coverage is on. */
  readonly unmeasured: readonly string[];
  /** Row 015-108's import edges are stored, so `import` is split. */
  readonly edges: boolean;
  /** `import` pairs whose chain is not recorded yet. */
  readonly notRecorded: number;
  /** Paths with no bytes in this worktree, left out of `files` and `byEdits` (015-122). */
  readonly absent: number;
  readonly files: readonly FileEntry[];
  readonly moreFiles: number;
  /** 015-118: the entries the window's edits changed, by the seconds those edits re-ran; empty with no edits. */
  readonly byEdits: readonly FileEntry[];
  readonly moreByEdits: number;
  readonly testFiles: readonly TestEntry[];
  readonly moreTestFiles: number;
  readonly named?: readonly NamedFile[];
  readonly proposals: readonly Proposal[];
}
