import { basename, dirname, join } from "node:path";
import type { TestProject, Vitest } from "vitest/node";
import type { AbsolutePath, TestFileRef } from "../../core/types/index.js";
import { type ImportClosure, importClosure, missingCandidates } from "./graph.js";

/** Every project's config file and the root's, plus their `configFileDependencies`. */
export function configFiles(vitest: Vitest): Set<AbsolutePath> {
  return collect([vitest.vite.config, ...vitest.projects.map((p) => p.vite.config)]);
}

/**
 * The root's config file and this project's, plus their
 * `configFileDependencies`, never a sibling's (011 C3, task 011-85 R2):
 * Vitest loads each `projects` entry as its own config, so a sibling's file
 * changes no option this project receives.
 */
export function projectConfigFiles(vitest: Vitest, project: TestProject): Set<AbsolutePath> {
  return collect([vitest.vite.config, project.vite.config]);
}

function collect(configs: readonly TestProject["vite"]["config"][]): Set<AbsolutePath> {
  const files = new Set<AbsolutePath>();
  for (const config of configs) {
    if (config.configFile) files.add(config.configFile);
    for (const dep of config.configFileDependencies) files.add(dep);
  }
  return files;
}

/**
 * Inputs shared by every test file of a project.
 *
 * Spec 001 D4: Vitest's walk misses "all test files of a project when a setup
 * file, its closure, `globalSetup`, or the config changed". Research Q3:
 * setup files, global setup and config files are in no test file's closure.
 */
export interface ProjectInputs {
  readonly configFiles: ReadonlySet<AbsolutePath>;
  readonly setup: ImportClosure;
  readonly globalSetup: ImportClosure;
  /**
   * Task 001-424: every resolution candidate of the missing targets of both
   * setup closures. A setup file's failed import fails every test file and
   * lies in no test file's closure, so only these re-key them on an add.
   */
  readonly missing: ReadonlySet<AbsolutePath>;
}

export async function projectInputs(vitest: Vitest, project: TestProject): Promise<ProjectInputs> {
  const [setup, globalSetup] = await Promise.all([
    importClosure(project, project.config.setupFiles),
    importClosure(project, globalSetupFiles(project)),
  ]);
  const extensions = resolveExtensions(project);
  const missing = new Set([
    ...missingCandidates(setup, extensions),
    ...missingCandidates(globalSetup, extensions),
  ]);
  return { configFiles: projectConfigFiles(vitest, project), setup, globalSetup, missing };
}

/** True when a change to `path` affects every test file of the project. */
export function isProjectInput(inputs: ProjectInputs, path: AbsolutePath): boolean {
  return (
    inputs.configFiles.has(path) ||
    inputs.setup.files.has(path) ||
    inputs.globalSetup.files.has(path) ||
    inputs.missing.has(path)
  );
}

/**
 * Global setup runs once per Vitest instance (`_initializeGlobalSetup` caches
 * it), so a change to it or its closure needs a new instance, like a config
 * change.
 */
export async function recreateTriggers(vitest: Vitest): Promise<Set<AbsolutePath>> {
  const triggers = configFiles(vitest);
  for (const project of vitest.projects) {
    const closure = await importClosure(project, globalSetupFiles(project));
    const missing = missingCandidates(closure, resolveExtensions(project));
    for (const file of [...closure.files, ...missing]) triggers.add(file);
  }
  return triggers;
}

/** Resolved `globalSetup` entries; Vitest types them as a string or a list. */
export function globalSetupFiles(project: TestProject): AbsolutePath[] {
  const entries = project.config.globalSetup;
  return typeof entries === "string" ? [entries] : [...entries];
}

/** Where Vitest keeps the snapshot file of a test file. */
export function snapshotPath(project: TestProject, testFile: AbsolutePath): AbsolutePath {
  const resolveSnapshotPath = project.config.snapshotOptions.resolveSnapshotPath;
  if (resolveSnapshotPath) {
    return resolveSnapshotPath(testFile, ".snap", { config: project.serializedConfig });
  }
  return join(dirname(testFile), "__snapshots__", `${basename(testFile)}.snap`);
}

/** `resolve.extensions` of the environment tests run in (`ssr`, see `importClosure`). */
export function resolveExtensions(project: TestProject): readonly string[] {
  return (project.vite.environments.ssr?.config ?? project.vite.config).resolve.extensions;
}

export function findProject(vitest: Vitest, testFile: TestFileRef): TestProject {
  const project = vitest.projects.find((p) => p.name === testFile.project);
  if (!project) {
    throw new Error(
      `vitest adapter: project "${testFile.project}" not found for ${testFile.path}; known: ${vitest.projects.map((p) => JSON.stringify(p.name)).join(", ")}`,
    );
  }
  return project;
}
