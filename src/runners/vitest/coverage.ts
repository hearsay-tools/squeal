import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Vitest } from "vitest/node";
import {
  type CoverageRun,
  type CoveredFile,
  coverageProvider,
  type ExecutedSource,
} from "../../core/code/coverage/index.js";
import type { AbsolutePath, TestFileRef } from "../../core/types/index.js";
import { importClosure } from "./graph.js";
import type { WorktreePaths } from "./paths.js";
import { findProject } from "./project.js";
import { type Environment, type SourceStamps, sourceOf } from "./sources.js";
import { cachedTransform } from "./stale.js";

/**
 * Spec 015 D8: what the daemon gives an adapter to collect coverage in the
 * runs it makes anyway. Absent, or `enabled` false, every instance gets
 * `coverage: { enabled: false }` (row 013-07).
 */
export interface VitestCoverage {
  /** Policy `coverage.enabled` with `complexity.enabled` (D1), read at each start. */
  readonly enabled: () => boolean;
  /** Where each instance keeps its workers' payloads: the daemon's temp directory. */
  readonly tempDir: AbsolutePath;
  /** One run's payloads, handed over after its report is built; never awaited by the run. */
  readonly collected: (run: CoverageRun) => void;
}

/** One worker batch as Squeal's provider keeps it (`provider.mjs`, `onAfterSuiteRun`). */
interface Batch {
  readonly coverage: string;
  readonly testFiles: readonly string[];
  readonly environment: string;
  readonly projectName: string;
}

/** Spec 015 D8 Fidelity: a test file whose closure imports `node:inspector` can read V8 coverage itself. */
const INSPECTOR = "inspector";

/** Coverage for one Vitest instance: its reports directory under the daemon's temp directory. */
export class InstanceCoverage {
  private constructor(
    readonly dir: AbsolutePath,
    readonly provider: AbsolutePath,
  ) {}

  /** `null` when Squeal's provider is not found beside the running code. */
  static start(tempDir: AbsolutePath): InstanceCoverage | null {
    const provider = coverageProvider();
    if (provider === null) return null;
    mkdirSync(tempDir, { recursive: true });
    return new InstanceCoverage(mkdtempSync(join(tempDir, "coverage-")), provider);
  }

  /** D8's `createVitest` option: Squeal's provider, no report, payloads in `dir`. */
  options() {
    return {
      enabled: true,
      provider: "custom" as const,
      customProviderModule: this.provider,
      reporter: [],
      reportsDirectory: this.dir,
    };
  }

  /** Before a run: the test files whose workers take no coverage (`provider.mjs`). */
  skip(files: readonly AbsolutePath[]): void {
    writeFileSync(join(this.dir, "skip.json"), JSON.stringify(files));
  }

  /** The batches the provider kept since the last call. */
  take(vitest: Vitest): Batch[] {
    // Vitest's own getter, typed internal in 5.0: the provider `getProvider` returned.
    const { coverageProvider } = vitest as unknown as {
      coverageProvider?: { takeBatches?: () => Batch[] } | null;
    };
    return coverageProvider?.takeBatches?.() ?? [];
  }

  remove(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

/**
 * Of `testFiles`, those whose closure imports `node:inspector` or
 * `inspector` (D8 Fidelity), from the transform graph as `closure` walks it.
 */
export async function inspectorFiles(
  vitest: Vitest,
  testFiles: readonly TestFileRef[],
  paths: WorktreePaths,
): Promise<TestFileRef[]> {
  const found: TestFileRef[] = [];
  for (const ref of testFiles) {
    const graph = await importClosure(findProject(vitest, ref), [paths.toAbsolute(ref.path)]);
    if (graph.builtins.has(INSPECTOR)) found.push(ref);
  }
  return found;
}

/**
 * The completed files' payloads with what the run executed, read at the
 * run's end, before an edit drops a transform. A batch of several files
 * (`isolate: false` gives none) or of a file not completed or not wanted is
 * dropped with its payload.
 */
export function coveredFiles(
  vitest: Vitest,
  batches: readonly Batch[],
  wanted: (ref: TestFileRef) => boolean,
  stamps: SourceStamps,
  paths: WorktreePaths,
): CoveredFile[] {
  const executed = new Map<Environment, ReadonlyMap<AbsolutePath, ExecutedSource>>();
  const files: CoveredFile[] = [];
  for (const batch of batches) {
    const [file, ...more] = batch.testFiles;
    const environment = vitest.projects.find((p) => p.name === batch.projectName)?.vite
      .environments[batch.environment];
    const path = file === undefined ? null : paths.toRelative(paths.toAbsolute(file));
    const ref = path === null ? null : { project: batch.projectName, path };
    if (more.length > 0 || environment === undefined || ref === null || !wanted(ref)) {
      rmSync(batch.coverage, { force: true });
      continue;
    }
    let sources = executed.get(environment);
    if (sources === undefined) {
      sources = executedSources(environment, stamps, paths);
      executed.set(environment, sources);
    }
    files.push({ testFile: ref, payload: batch.coverage, sources });
  }
  return files;
}

/** Each project file with a transform in `environment`, by module ID: its code, map and stamp. */
function executedSources(
  environment: Environment,
  stamps: SourceStamps,
  paths: WorktreePaths,
): Map<AbsolutePath, ExecutedSource> {
  const sources = new Map<AbsolutePath, ExecutedSource>();
  for (const [id, module] of environment.moduleGraph.idToModuleMap) {
    const file = sourceOf(id, paths);
    const transform = cachedTransform(module);
    const path = file === null ? null : paths.toRelative(file);
    if (file !== id || transform === null || path === null) continue;
    sources.set(file, {
      path,
      code: transform.code,
      map: (transform.map as ExecutedSource["map"]) ?? null,
      sha1: stamps.readHash(environment, id),
    });
  }
  return sources;
}
