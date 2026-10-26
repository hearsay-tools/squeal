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
  /** Row 015-86: read of Node's `source-map-cache`, which gives absolute file URLs. */
  readonly sources?: readonly (string | null)[] | null;
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
  /**
   * Row 015-86: the executed code's line lengths when its text is not
   * known (a node:test script under a loader, from Node's
   * `source-map-cache`); `code` is then empty, and the closing-punctuation
   * rule reads the mapped position in the map's `sourcesContent`.
   */
  readonly lineLengths?: readonly number[];
}

/** One completed test file of a run with its worker's payload (spec 015 D8). */
export interface CoveredFile {
  readonly testFile: TestFileRef;
  /** The raw V8 payload, a JSON file the records' writer reads and deletes. */
  readonly payload: AbsolutePath;
  /** By absolute path: what the run executed of each project file. */
  readonly sources: ReadonlyMap<AbsolutePath, ExecutedSource>;
  /**
   * Row 015-86: the payload is the `NODE_V8_COVERAGE` file of a node:test
   * file's own process, so what ran of each script is read from it and from
   * the files, not from `sources`: each script under this root, a real
   * path, and outside `node_modules` (`ownRecord`).
   */
  readonly ownRoot?: AbsolutePath;
}

/** Row 015-86: one entry of Node's `source-map-cache`, by script URL, in a `NODE_V8_COVERAGE` file. */
export interface CachedSourceMap {
  /** The length of each line of the code V8 ran. */
  readonly lineLengths: readonly number[];
  readonly data: SourceMapLike | null;
}

/** Row 015-86: a `NODE_V8_COVERAGE` file of one process. */
export interface V8Payload {
  readonly result: readonly V8Script[];
  readonly "source-map-cache"?: Readonly<Record<string, CachedSourceMap>>;
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
