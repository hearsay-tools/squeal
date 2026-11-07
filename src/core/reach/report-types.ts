import type { EpochMs, RelativePath } from "../types/common.js";
import type { CoverageState, PathKind } from "./pairs.js";
import type { Suggestion } from "./suggest.js";

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
  readonly files: readonly RelativePath[];
  /** The folder the collapsed files share; `null` for one file. */
  readonly folder: RelativePath | null;
  readonly testFiles: number;
  /** Recorded seconds one edit re-runs; for several files, of one of them. */
  readonly seconds: number;
  readonly share: number;
  readonly avoidableSeconds: number;
  /** Edits in the window that changed one of the files, and the seconds they re-ran. */
  readonly edits: number;
  readonly editSeconds: number;
  readonly coverage: Split<CoverageState>;
  readonly kinds: Split<PathKind>;
  readonly gateway: ReachRoute | null;
  readonly suggestion: Suggestion | null;
  /** For a child-process or runtime-read entry: Squeal re-runs these by design. */
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
  readonly avoidableSeconds: number;
}

/** A named file in full. */
export interface NamedFile {
  readonly path: RelativePath;
  readonly testFiles: number;
  readonly seconds: number;
  readonly share: number;
  readonly edits: number;
  readonly coverage: Split<CoverageState>;
  readonly routes: readonly (ReachRoute & {
    readonly tests: readonly {
      readonly path: RelativePath;
      readonly seconds: number | null;
      readonly coverage: CoverageState;
    }[];
  })[];
  readonly suggestion: Suggestion | null;
  readonly note?: string;
}

/** What the report proposes; it starts nothing. */
export type Proposal =
  /** No test file has a recorded result: the whole answer. */
  | { readonly kind: "warmup"; readonly command: string; readonly testFiles: number | null }
  /** Some test files have no recorded seconds. */
  | { readonly kind: "seconds"; readonly command: string; readonly testFiles: number }
  /** Coverage is off (option A). */
  | { readonly kind: "coverage"; readonly keys: readonly string[]; readonly command: string }
  /** Test files with no coverage record at their current keys. */
  | {
      readonly kind: "records";
      readonly command: string;
      readonly testFiles: number;
      readonly share: number;
    };

export interface ReachReport {
  readonly v: typeof REACH_REPORT_VERSION;
  /** False while no test file has a recorded result; the proposals are then the answer. */
  readonly history: boolean;
  readonly suite: {
    readonly testFiles: number;
    readonly seconds: number;
    readonly withoutSeconds: number;
    readonly leftOut: number;
  };
  /** The edits the store keeps, by time; `null` with none. */
  readonly window: { readonly from: EpochMs; readonly to: EpochMs; readonly edits: number } | null;
  readonly coverage: "on" | "off";
  /** Runners of the suite whose runs give no coverage records, while coverage is on. */
  readonly unmeasured: readonly string[];
  /** Row 015-108's import edges are stored, so `import` is split. */
  readonly edges: boolean;
  /** `import` pairs whose chain is not recorded yet. */
  readonly notRecorded: number;
  readonly files: readonly FileEntry[];
  readonly moreFiles: number;
  readonly testFiles: readonly TestEntry[];
  readonly moreTestFiles: number;
  readonly named?: readonly NamedFile[];
  readonly proposals: readonly Proposal[];
}
