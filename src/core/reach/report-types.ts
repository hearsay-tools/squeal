import type { EpochMs, RelativePath } from "../types/common.js";
import type { CoverageState, PathKind } from "./pairs.js";
import type { SecondGateway, Suggestion } from "./suggest.js";
import type { DeclaredPattern, StaleFallback } from "./types.js";

/*
 * Spec 015 D11: the report `squeal impact` prints, and `--json` gives in
 * this versioned shape. Shares are fractions of recorded seconds. Version
 * 2 (row 015-128) adds `gateways`, `moreGateways`, `stale`,
 * `window.rerunSeconds`, `FileEntry.editShare`, `NamedFile.editSeconds`
 * and `NamedFile.editShare`. Row 015-129 adds `offset`, `totalGateways`,
 * `totalFiles`, `totalByEdits` and `totalTestFiles`.
 */

export const REACH_REPORT_VERSION = 2;

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
  /** `editSeconds` over the window's `rerunSeconds`; 0 with none (row 015-128). */
  readonly editShare: number;
  readonly coverage: Split<CoverageState>;
  readonly kinds: Split<PathKind>;
  /** The kind of its main route: of the routes with avoidable seconds when it has any (015-116, P3). */
  readonly kind: PathKind;
  readonly gateway: ReachRoute | null;
  readonly second: SecondGateway | null;
  readonly suggestion: Suggestion | null;
  /** When child-process and runtime-read seconds outweigh import seconds: who reads it outside their imports, and how (row 015-128). */
  readonly note?: string;
}

/** How an observed gateway reaches its test files (row 015-128). */
export type GatewayMode =
  /** One path the test files read or load, such as `package.json`. */
  | "observed path"
  /** Test files that read at least `BROAD_READS` source modules outside their import walk: `test/daemon/*`, or one test file. */
  | "broad test reader";

/** Row 015-128: one gateway, by the seconds the window's edits of the files behind it re-ran. */
export interface GatewayEntry {
  readonly kind: PathKind;
  /** A setup root, a helper, a barrel, a hub, a declared input glob, an observed path, or a reader group. */
  readonly gateway: string;
  readonly mode?: GatewayMode;
  /** For a declared input, its pattern. */
  readonly declared?: DeclaredPattern;
  /** Edited files behind it in the window. */
  readonly editedFiles: number;
  /** Window edits that changed one of them. */
  readonly edits: number;
  /** Test files those edits re-ran through it. */
  readonly testFiles: number;
  /** Seconds those edits re-ran through it, each test file once per edit. */
  readonly editSeconds: number;
  /** `editSeconds` over the window's `rerunSeconds`. */
  readonly editShare: number;
  /** Up to 3 of its edited files, the most edited first. */
  readonly sampleFiles: readonly RelativePath[];
  readonly suggestion: Suggestion | null;
  /** For a runtime read or child process: who reads or loads what, and how. */
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
  /** Seconds its window edits re-ran, and their share of the window's `rerunSeconds` (row 015-128). */
  readonly editSeconds: number;
  readonly editShare: number;
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
  /**
   * The edits the store keeps of paths this worktree has, by time; `null`
   * with none (015-122). `rerunSeconds` sums, over those edits, the seconds
   * of the suite's test files each re-ran, each test file once per edit
   * (row 015-128).
   */
  readonly window: {
    readonly from: EpochMs;
    readonly to: EpochMs;
    readonly edits: number;
    readonly rerunSeconds: number;
  } | null;
  /** Row 015-128: test files that read their newest stored closure or walk, at no current key here; `null` when none did. */
  readonly stale: StaleFallback | null;
  readonly coverage: "on" | "off";
  /** Runners of the suite whose runs give no coverage records, while coverage is on. */
  readonly unmeasured: readonly string[];
  /** Row 015-108's import edges are stored, so `import` is split. */
  readonly edges: boolean;
  /** `import` pairs whose chain is not recorded yet. */
  readonly notRecorded: number;
  /** Paths with no bytes in this worktree, left out of `files` and `byEdits` (015-122). */
  readonly absent: number;
  /** Row 015-129: the entries `--offset` skipped in each ranked list and each named route's test files. */
  readonly offset: number;
  /** Row 015-129: each ranked list's length before `--offset` and `--limit`. */
  readonly totalGateways: number;
  readonly totalFiles: number;
  readonly totalByEdits: number;
  readonly totalTestFiles: number;
  /** Row 015-128: the gateways the window's edits went through, by the seconds they re-ran; empty with no edits. */
  readonly gateways: readonly GatewayEntry[];
  readonly moreGateways: number;
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
