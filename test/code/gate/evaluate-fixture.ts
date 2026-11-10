import type { CoverageSource } from "../../../src/core/code/coverage/types.js";
import type { BasePolicy } from "../../../src/core/code/gate/policy.js";
import type { EngineVersions, GateTimes } from "../../../src/core/code/gate/report.js";
import type {
  ChangedFunction,
  ChangedSet,
  CountedPath,
  Evidence,
  TestFileEvidence,
  UncountedPath,
} from "../../../src/core/code/gate/types.js";
import type { FunctionCount } from "../../../src/core/types/code.js";

/*
 * Spec 020 D5 to D7 (row 020-01): small inputs for `evaluate`. A function
 * here spans whole lines from column 1 to a `}` at column 1, so its V8
 * entry is `[startLine, 0, endLine, 0, hit]` (015 D9's join).
 */

export const BLOB = "b".repeat(40);
export const OLD_BLOB = "a".repeat(40);

/** The defaults of 015's keys, read at the base (D6). */
export const POLICY: BasePolicy = {
  complexityThreshold: 20,
  crapThreshold: 30,
  coverageExclude: [],
  include: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,py}"],
  exclude: ["**/dist/**", "**/build/**", "**/vendor/**", "**/*.min.js"],
  maxFileBytes: 524_288,
};

export const VERSIONS: EngineVersions = {
  squeal: "0.0.0-test",
  counter: 3,
  coverageProvider: 3,
  coverageRecord: 4,
};

export const TIMES: GateTimes = {
  createdAt: "2026-11-09T12:00:00.000Z",
  durationsMs: { vitest: 1200 },
};

/** A counted function over `lines`, inclusive. */
export function fn(
  qualifiedName: string,
  [startLine, endLine]: readonly [number, number],
  complexity: number,
  occurrence = 0,
): FunctionCount {
  return {
    qualifiedName,
    occurrence,
    range: { startLine, startColumn: 1, endLine, endColumn: 2 },
    bodyHash: `h:${qualifiedName}:${occurrence}`,
    complexity,
    decisions: {},
  };
}

/** A base64 bitset of 1-based lines, as a record holds them. */
export function bitset(lines: readonly number[]): string {
  const bytes = new Uint8Array(Math.ceil(Math.max(0, ...lines) / 8));
  for (const line of lines) {
    const at = (line - 1) >> 3;
    bytes[at] = (bytes[at] ?? 0) | (1 << ((line - 1) & 7));
  }
  return Buffer.from(bytes).toString("base64");
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** A record's entry for `path`: every function's own V8 entry, `ran` the ones that ran. */
export function source(
  path: string,
  functions: readonly FunctionCount[],
  opts: {
    readonly ran?: readonly string[];
    readonly lines?: readonly number[];
    readonly covered?: readonly number[];
    readonly blob?: string;
  } = {},
): CoverageSource {
  const ran = new Set(opts.ran ?? functions.map((f) => f.qualifiedName));
  const all = functions.flatMap((f) => range(f.range.startLine, f.range.endLine));
  const covered = functions
    .filter((f) => ran.has(f.qualifiedName))
    .flatMap((f) => range(f.range.startLine, f.range.endLine));
  return {
    path,
    blob: opts.blob ?? BLOB,
    lines: bitset(opts.lines ?? all),
    covered: bitset(opts.covered ?? covered),
    functions: functions.map(
      (f) => [f.range.startLine, 0, f.range.endLine, 0, ran.has(f.qualifiedName) ? 1 : 0] as const,
    ),
  };
}

/** A completed Vitest file that loads `loads` and whose record holds `sources`. */
export function testFile(
  path: string,
  loads: readonly string[] | null,
  sources: readonly CoverageSource[],
  opts: Partial<Pick<TestFileEvidence, "runner" | "completed" | "failed" | "skipped">> & {
    readonly record?: null;
    readonly unread?: readonly string[];
  } = {},
): TestFileEvidence {
  return {
    runner: opts.runner ?? "vitest",
    path,
    completed: opts.completed ?? true,
    failed: opts.failed ?? [],
    skipped: opts.skipped ?? false,
    loads,
    record: opts.record === null ? null : { v: 1, sources, unread: [...(opts.unread ?? [])] },
  };
}

export function evidence(testFiles: readonly TestFileEvidence[], timedOut = false): Evidence {
  return { testFiles, timedOut, budgetSeconds: 600 };
}

/** One changed path: every head function, and the names of those changed. */
export interface PathInput {
  readonly path: string;
  readonly functions: readonly FunctionCount[];
  readonly changed: readonly string[];
  /** Of `changed` and `inErrors`, the ones added; the others are edited. */
  readonly added?: readonly string[];
  readonly inErrors?: readonly string[];
  readonly blob?: string;
}

export function changedSet(
  paths: readonly PathInput[],
  uncounted: readonly UncountedPath[] = [],
): ChangedSet {
  const pick = (p: PathInput, names: readonly string[]): ChangedFunction[] =>
    p.functions
      .filter((f) => names.includes(f.qualifiedName))
      .map((count) => ({
        path: p.path,
        blob: p.blob ?? BLOB,
        change: p.added?.includes(count.qualifiedName) ? "added" : "edited",
        count,
      }));
  const counted: CountedPath[] = paths.map((p) => ({
    path: p.path,
    blob: p.blob ?? BLOB,
    functions: p.functions,
  }));
  return {
    ref: "origin/main",
    baseCommit: "c".repeat(40),
    headCommit: "d".repeat(40),
    dirty: false,
    paths: [...paths.map((p) => p.path), ...uncounted.map((u) => u.path)].sort(),
    functions: paths.flatMap((p) => pick(p, p.changed)),
    counted,
    inErrors: paths.flatMap((p) => pick(p, p.inErrors ?? [])),
    uncounted,
  };
}
