import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Vitest } from "vitest/node";
import type { CoverageRun, CoveredFile, ExecutedSource } from "../../core/code/coverage/index.js";
import type { AbsolutePath, TestFileRef } from "../../core/types/index.js";
import { type ImportClosure, importClosure } from "./graph.js";
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
  /** Squeal's provider, `provider.mjs`, which Vitest loads by path. */
  readonly provider: AbsolutePath;
  /** Where each instance keeps its workers' payloads: the daemon's temp directory. */
  readonly tempDir: AbsolutePath;
  /** One run's payloads, handed over after its report is built; never awaited by the run. */
  readonly collected: (run: CoverageRun) => void;
}

/** One worker batch as Squeal's provider keeps it (`provider.mjs`, `onAfterSuiteRun`). */
export interface CoverageBatch {
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

  static start({ tempDir, provider }: VitestCoverage): InstanceCoverage {
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

  /**
   * Row 013-08: a test file in a client environment (jsdom, happy-dom)
   * loads the provider through Vite's client environment, which loads no
   * file outside `server.fs.allow` (`fs.strict`), and the provider sits in
   * a plugin cache outside every project. So each Vite server of the
   * instance allows this one file, by its path and its real path, which
   * Vite's resolver gives; its own entries and `fs.strict` stay. Called
   * before any run.
   */
  allow(vitest: Vitest): void {
    const files = new Set([this.provider, realPath(this.provider)]);
    const servers = new Set([vitest.vite, ...vitest.projects.map((p) => p.vite)]);
    for (const server of servers) {
      const allowed = server.config.server.fs.allow;
      for (const file of files) if (!allowed.includes(file)) allowed.push(file);
    }
  }

  /** Before a run: the test files whose workers take no coverage (`provider.mjs`). */
  skip(files: readonly AbsolutePath[]): void {
    writeFileSync(join(this.dir, "skip.json"), JSON.stringify(files));
  }

  /**
   * The batches the provider kept since the last call. Read before the
   * instance closes: `closeEmptied` deletes the getter's state.
   */
  take(vitest: Vitest): CoverageBatch[] {
    // Vitest's own getter, typed internal in 5.0: the provider `getProvider` returned.
    const { coverageProvider } = vitest as unknown as {
      coverageProvider?: { takeBatches?: () => CoverageBatch[] } | null;
    };
    return coverageProvider?.takeBatches?.() ?? [];
  }

  remove(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

/** `path` with its symbolic links resolved, or itself when it cannot be read. */
function realPath(path: AbsolutePath): AbsolutePath {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** Why a test file runs with coverage off under D8's Fidelity rule. */
export interface InspectorFile {
  readonly ref: TestFileRef;
  /** `setup`: its project's setup files import the inspector (review 0.1.295 B2). */
  readonly through: "closure" | "setup";
}

/**
 * Of `testFiles`, those that can read V8 coverage (D8 Fidelity): each file
 * of a project whose setup closure imports `node:inspector` or `inspector`,
 * since a setup file runs in every test file's worker but lies in no test
 * file's closure, and each other file whose own closure imports it, from
 * the transform graph as `closure` walks it.
 */
export async function inspectorFiles(
  vitest: Vitest,
  testFiles: readonly TestFileRef[],
  paths: WorktreePaths,
): Promise<InspectorFile[]> {
  const setups = new Map<string, Promise<boolean>>();
  const found: InspectorFile[] = [];
  for (const ref of testFiles) {
    const project = findProject(vitest, ref);
    let setup = setups.get(project.name);
    if (setup === undefined) {
      setup = importClosure(project, project.config.setupFiles).then(readsInspector);
      setups.set(project.name, setup);
    }
    if (await setup) found.push({ ref, through: "setup" });
    else if (readsInspector(await importClosure(project, [paths.toAbsolute(ref.path)]))) {
      found.push({ ref, through: "closure" });
    }
  }
  return found;
}

const readsInspector = (closure: ImportClosure) => closure.builtins.has(INSPECTOR);

/** The note that names a file `inspectorFiles` found. */
export function inspectorNote({ ref, through }: InspectorFile): string {
  const imports =
    through === "setup"
      ? "its project's setup files import node:inspector"
      : "its closure imports node:inspector";
  return `coverage is off for ${ref.path}: ${imports}, so its tests can see V8 coverage (spec 015 D8)`;
}

/**
 * The completed files' payloads with what the run executed, read at the
 * run's end, before an edit drops a transform. A batch of several files
 * (`isolate: false` gives none) or of a file not completed or not wanted is
 * dropped with its payload.
 */
export function coveredFiles(
  vitest: Vitest,
  batches: readonly CoverageBatch[],
  wanted: (ref: TestFileRef) => boolean,
  stamps: SourceStamps,
  paths: WorktreePaths,
): CoveredFile[] {
  const executed = new Map<Environment, ReadonlyMap<AbsolutePath, ExecutedSource>>();
  const files: CoveredFile[] = [];
  for (const batch of batches) {
    const [file, ...more] = batch.testFiles;
    const project = vitest.projects.find((p) => p.name === batch.projectName);
    const environment = project?.vite.environments[batch.environment];
    // Row 013-10: Vitest names the file from its project's root (`file.name`, Vitest 4 and 5).
    const path =
      file === undefined || project === undefined
        ? null
        : paths.toRelative(resolve(project.config.root, file));
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

/** Deletes each batch's payload: a hung, crashed or rejected run keeps no record (D8). */
export function dropPayloads(batches: readonly CoverageBatch[]): void {
  for (const batch of batches) rmSync(batch.coverage, { force: true });
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
