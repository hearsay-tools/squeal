import { join, relative, resolve } from "node:path";
import { compare, toRelative } from "../../core/fs/index.js";
import type {
  AbsolutePath,
  PytestProject,
  RelativePath,
  RunnerEnvironment,
} from "../../core/types/index.js";
import { slashes } from "./adapter-files.js";
import { discoverEnvironment, type PytestEnvironment, projectDir } from "./environment/index.js";
import { listOptional, sitePackagesDir } from "./environment/site.js";

/** `runnerVersion` while the environment is not `ready`: no stored result was produced under it. */
export const PYTEST_UNAVAILABLE = "unavailable";

/**
 * Where the project's environment is or would be: the one D2 discovers,
 * else the declared `python`, else `<cwd>/.venv`, which `uv sync` creates.
 * The graph resolves against it once its `pyvenv.cfg` exists.
 */
export function environmentDir(root: AbsolutePath, project: PytestProject): AbsolutePath {
  const discovery = discoverEnvironment(root, project);
  if (discovery.kind === "found") return discovery.env;
  const cwd = projectDir(root, project);
  return project.python === undefined ? join(cwd, ".venv") : resolve(cwd, project.python);
}

/**
 * What `ready` and every other state key by, and what a change of compares:
 * D2's hash, or the state and its note.
 */
export function environmentSignature(environment: PytestEnvironment): string {
  return environment.state === "ready"
    ? `ready:${environment.hash}`
    : `${environment.state}:${environment.note}`;
}

/**
 * The installed pytest's version from its `.dist-info` name, for
 * `runnerVersion`; the hash holds every site-packages entry anyway.
 */
export function pytestVersion(environment: PytestEnvironment): string {
  if (environment.state !== "ready") return PYTEST_UNAVAILABLE;
  const site = sitePackagesDir(environment.discovery.env);
  const entry =
    site === null
      ? undefined
      : listOptional(site).find((name) => /^pytest-\d[^-]*\.dist-info$/.test(name));
  return entry === undefined ? "unknown" : entry.slice("pytest-".length, -".dist-info".length);
}

export interface EnvironmentParts {
  readonly root: AbsolutePath;
  readonly project: PytestProject;
  readonly environment: PytestEnvironment;
  readonly adapterVersion: string;
  /** The config file, if any. */
  readonly configFile: AbsolutePath | null;
  /** Where the environment is or would be ({@link environmentDir}). */
  readonly envDir: AbsolutePath;
  /** D2: the closure of the `pytest11` and `-p` plugins inside the worktree. */
  readonly pluginPaths: readonly RelativePath[];
}

/**
 * Spec 007 D2: the runner-side environment of one pytest project.
 * `resolvedConfig` carries D2's hash, which is computed with every
 * worktree path written as `<worktree>`, so two worktrees synced from one
 * lock key alike; not `ready`, it carries the state's note. `files` are the
 * paths the core hashes and watches: the config file, the plugins' closure,
 * and `<env>/pyvenv.cfg` when the environment sits in the worktree, so its
 * appearance or a recreated environment is a batch (D2: "re-checked when
 * `<env>/pyvenv.cfg` appears or changes"). `packages` is empty: no
 * JavaScript lockfile keys a Python test.
 */
export function projectEnvironment(parts: EnvironmentParts): RunnerEnvironment {
  const { root, project, environment } = parts;
  const cwd = slashes(relative(root, projectDir(root, project)));
  const ready = environment.state === "ready";
  const config = {
    cwd,
    python: project.python ?? null,
    include: project.include,
    exclude: project.exclude ?? [],
    state: environment.state,
    ...(ready ? { hash: environment.hash } : { note: environment.note }),
  };
  const files = new Set(parts.pluginPaths);
  for (const path of [parts.configFile, join(parts.envDir, "pyvenv.cfg")]) {
    const inside = path === null ? null : toRelative(root, path);
    if (inside !== null) files.add(inside);
  }
  return {
    project: project.name,
    ...(cwd === "" ? {} : { root: cwd }),
    runnerName: "pytest",
    runnerVersion: pytestVersion(environment),
    adapterVersion: parts.adapterVersion,
    resolvedConfig: JSON.stringify(config),
    files: [...files].sort(compare),
    packages: { imports: [], builtins: [] },
  };
}
