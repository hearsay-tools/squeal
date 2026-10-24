import type {
  AbsolutePath,
  CheckKey,
  FileHash,
  RelativePath,
  TestFileRef,
} from "../../types/index.js";

/** What Squeal reads of a source map v3. */
export interface SourceMapLike {
  readonly mappings?: unknown;
  readonly sourcesContent?: readonly (string | null)[] | null;
}

/** One V8 block coverage range: byte offsets into the script and its count. */
export interface V8Range {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly count: number;
}

/** One V8 function of a script's precise coverage; `ranges[0]` is the function's own. */
export interface V8Function {
  readonly functionName: string;
  readonly ranges: readonly V8Range[];
  readonly isBlockCoverage: boolean;
}

/** One script of a worker's payload, as Squeal's provider writes it (`provider.mjs`). */
export interface V8Script {
  readonly url: string;
  readonly functions: readonly V8Function[];
  /** The evaluator's wrapper before the module's code. */
  readonly startOffset?: number;
}

/**
 * What a run executed of one project file, taken when its report was built,
 * before any later edit drops the transform: its code and map, and the
 * hash (sha1) of the bytes Vite read, when stamped (`SourceStamps`).
 */
export interface ExecutedSource {
  readonly path: RelativePath;
  readonly code: string;
  readonly map: SourceMapLike | null;
  readonly sha1: string | undefined;
}

/** One completed test file of a run with its worker's payload (spec 015 D8). */
export interface CoveredFile {
  readonly testFile: TestFileRef;
  /** The raw V8 payload, a JSON file the records' writer reads and deletes. */
  readonly payload: AbsolutePath;
  /** By absolute path: what the run executed of each project file. */
  readonly sources: ReadonlyMap<AbsolutePath, ExecutedSource>;
}

/** The payloads one run leaves, handed over after its report is built. */
export interface CoverageRun {
  readonly runId: string;
  readonly files: readonly CoveredFile[];
}

/**
 * Spec 015 D8: one source a test file loaded, in its coverage record. Lines
 * are 1-based; bit `n - 1` of a bitset is line `n`, little-endian in each
 * byte, base64.
 */
export interface CoverageSource {
  readonly path: RelativePath;
  /** The git blob id (011 C3) of the bytes the run executed. */
  readonly blob: FileHash;
  /** The lines with code the transform maps to: what can run. */
  readonly lines: string;
  /** Of those, the lines whose code ran. */
  readonly covered: string;
  /**
   * Each function V8 saw, mapped to the source: start line and column, end
   * line and column (1-based lines, 0-based columns), and 1 when it ran.
   * Sorted by start, then end, then hit; V8 functions that map to one span
   * with one hit are one entry, with different hits two (version 2).
   */
  readonly functions: readonly (readonly [number, number, number, number, 0 | 1])[];
}

/**
 * Spec 015 D8: a test file's coverage record, stored in the code store at
 * its result key and `COVERAGE_PROVIDER_VERSION`. `unread` names the
 * sources the run executed whose bytes could no longer be confirmed (an
 * edit after the run, before mapping): they have no entry, so a reader
 * cannot take the file as not running them.
 */
export interface CoverageRecord {
  readonly v: 1;
  readonly sources: readonly CoverageSource[];
  readonly unread: readonly RelativePath[];
}

/** The key the run's results of a test file were stored under; `undefined` while none is. */
export type ResultKeyOf = (runId: string, testFile: TestFileRef) => CheckKey | undefined;
