import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type {
  CoveredFile,
  ExecutedSource,
  RunnerCoverageOptions,
  SourceMapLike,
} from "../../core/code/coverage/types.js";
import type { WorktreePaths } from "../../core/fs/worktree-paths.js";
import type { AbsolutePath, RelativePath } from "../../core/types/common.js";
import type { TestFileRef } from "../../core/types/keys.js";
import type { JestGraph } from "./graph/index.js";
import type { JestEvent } from "./run/events.js";

/*
 * Spec 028 D5.3, spec 015 D8 (row 028-06b): V8 coverage in the Jest runs
 * Squeal makes anyway. A covered batch runs with `JEST_COVERAGE_ARGS`, and
 * `squeal-reporter.cjs` writes each completed file's V8 scripts to
 * `<n>.json` and what Jest's transform gave for each, `{ code, map, sha1 }`
 * by absolute path, to `<n>.sources.json` in `SQUEAL_JEST_COVERAGE_DIR`,
 * before the file's `fileResult` line names both. A file without that line
 * is not complete (Kit K8), so its files are dropped with the run.
 */

/** What the daemon gives a Jest adapter to collect coverage; absent, or `enabled` false, none. */
export type JestCoverage = RunnerCoverageOptions;

/**
 * Jest's V8 provider with no report of its own: `none` is istanbul's
 * reporter that writes nothing (an empty `--coverageReporters=` fails to
 * load a reporter named ""), and an empty `coverageThreshold` keeps the
 * project's thresholds from failing a batch whose coverage Squeal took.
 */
export const JEST_COVERAGE_ARGS: readonly string[] = [
  "--coverage",
  "--coverageProvider=v8",
  "--coverageReporters=none",
  "--coverageThreshold={}",
];

/** The variable naming the folder `squeal-reporter.cjs` writes a batch's payloads to. */
export const COVERAGE_DIR_VARIABLE = "SQUEAL_JEST_COVERAGE_DIR";

/** D8 Fidelity: a closure that imports `node:inspector` or `inspector` can read V8 coverage. */
const INSPECTOR = "inspector";

/** One completed file's payload and its transforms' file, as the reporter wrote them. */
export interface JestCoveragePayload {
  readonly testFile: TestFileRef;
  readonly payload: AbsolutePath;
  readonly sources: AbsolutePath;
}

/** One source as `squeal-reporter.cjs` writes it. */
interface WrittenSource {
  readonly code?: unknown;
  readonly map?: unknown;
  readonly sha1?: unknown;
}

/**
 * One project's coverage. Its key holds Squeal's marker exactly while its
 * runs take coverage: `keyed` is what the last `environment` gave, and a run
 * takes coverage only then, so a record is stored only under a key that
 * names it. A policy change shows at the next `invalidate`, which recreates
 * the project so its checks re-key once (node:test's `ProjectCoverage`).
 * Jest measures no child process: `coverage.children` is noted once.
 */
export class ProjectCoverage {
  #keyed: boolean;
  readonly #noted = new Set<string>();

  constructor(
    private readonly coverage: JestCoverage | undefined,
    private readonly note: (text: string) => void,
  ) {
    this.#keyed = this.#wanted();
  }

  /** For `environment`: whether the key names Squeal's coverage, kept for the next runs. */
  key(): boolean {
    this.#keyed = this.#wanted();
    if (this.#keyed && this.coverage?.children?.() === true) {
      this.#once(
        "coverage.children is not taken: Jest's coverage measures its own process only (spec 028 D5.3)",
      );
    }
    return this.#keyed;
  }

  /** For `invalidate`: the policy turned coverage on or off since the last `environment`. */
  changed(): boolean {
    return this.#wanted() !== this.#keyed;
  }

  /**
   * For a run: whether each file takes coverage, `undefined` while the key
   * holds none. A file whose closure or setup files import the inspector
   * runs without, noted once (D8 Fidelity).
   */
  covered(
    graph: JestGraph,
    files: readonly RelativePath[],
  ): ((testFile: TestFileRef) => boolean) | undefined {
    if (!this.#keyed) return undefined;
    const listed = new Set(files);
    return (testFile) => {
      if (!listed.has(testFile.path)) return true;
      const imports = graph.closure(testFile.path).packages.builtins.includes(INSPECTOR);
      if (imports) {
        this.#once(
          `coverage is off for ${testFile.path}: its closure or setup files import node:inspector, so its tests can see V8 coverage (spec 015 D8)`,
        );
      }
      return !imports;
    };
  }

  /** After a run: each completed file's payload with what Jest's transform ran, to the records' writer. */
  collect(runId: string, payloads: readonly JestCoveragePayload[], paths: WorktreePaths): void {
    if (this.coverage === undefined || payloads.length === 0) {
      for (const p of payloads) dropPayload(p);
      return;
    }
    const interned = new Map<string, ExecutedSource>();
    const files = payloads.map(
      (p): CoveredFile => ({
        testFile: p.testFile,
        payload: p.payload,
        sources: executedSources(p.sources, paths, interned),
      }),
    );
    this.coverage.collected({ runId, files });
  }

  #wanted(): boolean {
    return this.coverage?.enabled() === true;
  }

  #once(text: string): void {
    if (this.#noted.has(text)) return;
    this.#noted.add(text);
    this.note(text);
  }
}

/**
 * The project files of a reporter's sources file, by absolute path, the
 * file deleted once read. Sources alike in two files of a run are one
 * object, so a runner host sends each once (`coverage-wire.ts`). A source
 * without the sha1 of the bytes Jest read is left out: its record could not
 * name a blob.
 */
export function executedSources(
  file: AbsolutePath,
  paths: WorktreePaths,
  interned: Map<string, ExecutedSource> = new Map(),
): Map<AbsolutePath, ExecutedSource> {
  const sources = new Map<AbsolutePath, ExecutedSource>();
  let written: Record<string, WrittenSource>;
  try {
    written = JSON.parse(readFileSync(file, "utf8")) as Record<string, WrittenSource>;
  } catch {
    return sources;
  } finally {
    rmSync(file, { force: true });
  }
  for (const [absolute, source] of Object.entries(written)) {
    const at = absolute as AbsolutePath;
    if (!paths.isProjectFile(at)) continue;
    const path = paths.toRelative(at);
    const { code, sha1 } = source;
    if (path === null || typeof code !== "string" || typeof sha1 !== "string") continue;
    const map = mapOf(source.map);
    const key = `${path}\0${sha1}`;
    const known = interned.get(key);
    if (known !== undefined && known.code === code && sameMap(known.map, map)) {
      sources.set(at, known);
      continue;
    }
    const executed: ExecutedSource = { path, code, map, sha1 };
    interned.set(key, executed);
    sources.set(at, executed);
  }
  return sources;
}

function sameMap(a: SourceMapLike | null, b: SourceMapLike | null): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function mapOf(value: unknown): SourceMapLike | null {
  return typeof value === "object" && value !== null ? (value as SourceMapLike) : null;
}

/**
 * Of a batch's events, each completed file's payload: a `fileResult` line
 * of a file the batch reports (`readJestBatch`) that names both files, the
 * first such line of each file.
 */
export function payloadsOf(
  events: readonly JestEvent[],
  reported: readonly TestFileRef[],
  paths: WorktreePaths,
): JestCoveragePayload[] {
  const byPath = new Map(reported.map((f) => [f.path, f]));
  const payloads: JestCoveragePayload[] = [];
  for (const event of events) {
    if (event.type !== "fileResult") continue;
    const relative = paths.toRelative(event.testFilePath as AbsolutePath);
    const testFile = relative === null ? undefined : byPath.get(relative);
    if (testFile !== undefined) byPath.delete(relative as RelativePath);
    const { coverageFile, transformSources } = event;
    if (testFile === undefined || coverageFile === undefined || transformSources === undefined) {
      continue;
    }
    payloads.push({
      testFile,
      payload: coverageFile as AbsolutePath,
      sources: transformSources as AbsolutePath,
    });
  }
  return payloads;
}

/** Where batch `index` writes its payloads. */
export function batchCoverageDir(dir: AbsolutePath, index: number): AbsolutePath {
  return join(dir, String(index)) as AbsolutePath;
}

/**
 * Deletes every file in `dirs` but the `kept` payloads': what a file not
 * completed, or not reported, wrote is never a record (Kit K8).
 */
export function dropUnkept(
  dirs: readonly AbsolutePath[],
  kept: readonly JestCoveragePayload[],
): void {
  const keep = new Set(kept.flatMap((p) => [p.payload, p.sources]));
  for (const dir of dirs) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const path = join(dir, name);
      if (!keep.has(path as AbsolutePath)) rmSync(path, { force: true });
    }
  }
}

function dropPayload(payload: JestCoveragePayload): void {
  rmSync(payload.payload, { force: true });
  rmSync(payload.sources, { force: true });
}

/**
 * The tier's files in a group without coverage and a group with, in the
 * order given, so a file `covered` refuses never shares a covered batch.
 */
export function coverageGroups(
  files: readonly TestFileRef[],
  covered: ((testFile: TestFileRef) => boolean) | undefined,
): { files: TestFileRef[]; covered: boolean }[] {
  if (covered === undefined) return [{ files: [...files], covered: false }];
  const groups = [
    { files: [] as TestFileRef[], covered: true },
    { files: [] as TestFileRef[], covered: false },
  ];
  for (const file of files) (covered(file) ? groups[0] : groups[1])?.files.push(file);
  return groups.filter((g) => g.files.length > 0);
}
