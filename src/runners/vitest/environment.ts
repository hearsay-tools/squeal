import type { TestProject } from "vitest/node";
import { compare } from "../../core/fs/index.js";
import type { RelativePath, RunnerEnvironment } from "../../core/types/index.js";
import type { WorktreePaths } from "./paths.js";
import { globalSetupFiles, type ProjectInputs } from "./project.js";

export interface EnvironmentContext {
  readonly paths: WorktreePaths;
  readonly runnerVersion: string;
  readonly adapterVersion: string;
}

/**
 * Runner-side environment hash inputs of one project.
 *
 * Spec 001 D3: "the resolved Vitest config, the contents of the config file
 * and its `configFileDependencies`, the closure of every `setupFiles` and
 * `globalSetup` entry". The adapter lists the files; the core hashes them.
 */
export function projectEnvironment(
  project: TestProject,
  inputs: ProjectInputs,
  context: EnvironmentContext,
): RunnerEnvironment {
  const { paths } = context;
  const files = new Set<RelativePath>();
  for (const file of [...inputs.configFiles, ...inputs.setup.files, ...inputs.globalSetup.files]) {
    const rel = paths.toRelative(file);
    if (rel !== null && paths.isProjectFile(file)) files.add(rel);
  }
  return {
    project: project.name,
    runnerName: "vitest",
    runnerVersion: context.runnerVersion,
    adapterVersion: context.adapterVersion,
    resolvedConfig: canonicalConfig(project, paths),
    files: [...files].sort(compare),
  };
}

/**
 * Canonical JSON of the config tests receive (`serializedConfig`), plus
 * `globalSetup`, which runs in the main process and is not serialized.
 * `sequence.seed` is dropped: Vitest draws it from the clock on every start.
 * Keys sorted, absolute paths relativized to the worktree root.
 */
export function canonicalConfig(project: TestProject, paths: WorktreePaths): string {
  const { sequence, ...config } = project.serializedConfig;
  const { seed: _seed, ...stableSequence } = sequence;
  return JSON.stringify(
    canonicalize(
      { ...config, sequence: stableSequence, globalSetup: globalSetupFiles(project) },
      paths,
    ),
  );
}

function canonicalize(value: unknown, paths: WorktreePaths): unknown {
  if (typeof value === "string") return paths.relativizeText(value);
  if (value instanceof RegExp) return value.toString();
  if (Array.isArray(value)) return value.map((v) => canonicalize(v, paths));
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined && typeof v !== "function")
      .sort(([a], [b]) => compare(a, b))
      .map(([k, v]) => [k, canonicalize(v, paths)]);
    return Object.fromEntries(entries);
  }
  return value;
}
