import { existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { compare, toRelative } from "../../core/fs/index.js";
import type {
  AbsolutePath,
  InvalidatedPath,
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
 * D2's environment as the adapter admits it: `ready` only once pytest is
 * installed. A sync writes `pyvenv.cfg` first and the packages after it,
 * so an environment without pytest is most likely one still syncing, and
 * running it would only report pytest missing.
 */
export type AdapterEnvironment =
  | PytestEnvironment
  | { readonly state: "no-pytest"; readonly note: string }
  | { readonly state: "unsettled"; readonly note: string };

/** How long a ready environment's fingerprint holds still before it is admitted, the most to wait, how often to look. */
export const SETTLE_MS = 1_000;
export const SETTLE_LIMIT_MS = 20_000;
export const SETTLE_POLL_MS = 200;

/** Time for {@link admit}; tests drive it. */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const REAL_CLOCK: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
};

/** What {@link admit} decided, and the fingerprint it held still at when `stable` and ready. */
export interface Admission {
  readonly outcome: "stable" | "timeout";
  readonly environment: AdapterEnvironment;
  readonly fingerprint: string | null;
}

type Ready = Extract<AdapterEnvironment, { state: "ready" }>;

/**
 * D2's admission, the one path for the first and every later one (review
 * wave 2, B2): a ready environment is admitted once its fingerprint held
 * still for `SETTLE_MS`, read again and found at that fingerprint, so what
 * keys it is what settled. Any other state is returned as read: nothing
 * runs under it. Still moving after `SETTLE_LIMIT_MS`, it is `unsettled`,
 * which keys and runs as every state but `ready` does; a later recheck
 * admits it again. An environment without pytest is read again every
 * `SETTLE_POLL_MS` up to the same limit, since a sync writes `pyvenv.cfg`
 * before the packages and no watched file shows pytest landing (task
 * 007-39, lessons.md defect 8); without pytest at the limit, it is
 * `no-pytest`.
 */
export async function admit(
  project: PytestProject,
  read: () => Promise<AdapterEnvironment>,
  fingerprint: (environment: Ready) => string,
  clock: Clock = REAL_CLOCK,
): Promise<Admission> {
  const end = clock.now() + SETTLE_LIMIT_MS;
  let environment = await read();
  while (environment.state === "no-pytest" && clock.now() < end) {
    await clock.sleep(SETTLE_POLL_MS);
    environment = await read();
  }
  while (environment.state === "ready") {
    let last = environment.fingerprint;
    let since = clock.now();
    while (clock.now() - since < SETTLE_MS) {
      if (clock.now() >= end) return unsettled(project);
      await clock.sleep(SETTLE_POLL_MS);
      const now = fingerprint(environment);
      if (now !== last) {
        last = now;
        since = clock.now();
      }
    }
    const settled = last;
    environment = await read();
    if (environment.state === "ready" && environment.fingerprint === settled) {
      return { outcome: "stable", environment, fingerprint: settled };
    }
    if (clock.now() >= end) return unsettled(project);
  }
  return { outcome: "stable", environment, fingerprint: null };
}

function unsettled(project: PytestProject): Admission {
  return {
    outcome: "timeout",
    fingerprint: null,
    environment: {
      state: "unsettled",
      note: `pytest project "${project.name}": the Python environment kept changing for ${SETTLE_LIMIT_MS / 1_000} s (a sync or install in progress). Its checks stay unknown until it holds still for ${SETTLE_MS / 1_000} s.`,
    },
  };
}

/** `<site-packages>/pytest/__init__.py` of the environment once its `pyvenv.cfg` names one. */
export function pytestMarker(envDir: AbsolutePath): AbsolutePath | null {
  const site = sitePackagesDir(envDir);
  return site === null ? null : join(site, "pytest", "__init__.py");
}

/** `environment`, or `no-pytest` when it is ready but pytest is not installed in it. */
export function admitEnvironment(
  root: AbsolutePath,
  project: PytestProject,
  environment: PytestEnvironment,
): AdapterEnvironment {
  if (environment.state !== "ready") return environment;
  const marker = pytestMarker(environment.discovery.env);
  if (marker !== null && existsSync(marker)) return environment;
  const where = toRelative(root, environment.discovery.env) ?? environment.discovery.env;
  return {
    state: "no-pytest",
    note: `pytest project "${project.name}": pytest is not installed in ${where} (a sync in progress, or pytest missing from the project's dependencies). Its checks stay unknown until it is.`,
  };
}

/**
 * What `ready` and every other state key by, and what a change of compares:
 * D2's hash, or the state and its note.
 */
export function environmentSignature(environment: AdapterEnvironment): string {
  return environment.state === "ready"
    ? `ready:${environment.hash}`
    : `${environment.state}:${environment.note}`;
}

/** Whether a fresh read moved from the admitted environment: by fingerprint when both are ready. */
export function moving(read: AdapterEnvironment, admitted: AdapterEnvironment): boolean {
  if (read.state === "ready" && admitted.state === "ready") {
    return read.fingerprint !== admitted.fingerprint;
  }
  return environmentSignature(read) !== environmentSignature(admitted);
}

/**
 * The installed pytest's version from its `.dist-info` name, for
 * `runnerVersion`; the hash holds every site-packages entry anyway.
 */
export function pytestVersion(environment: AdapterEnvironment): string {
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
  readonly environment: AdapterEnvironment;
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
 * and, when the environment sits in the worktree, `<env>/pyvenv.cfg`, so the
 * environment's appearance and a recreated environment are each a batch
 * (D2: "re-checked when `<env>/pyvenv.cfg` appears or changes"); it hashes
 * alike in every worktree synced from one lock. No site-packages file is
 * among them (task 007-28): uv hardlinks those from its cache wherever it
 * cannot clone them, so every environment synced from the cache shares
 * their inodes, and a sync or removal anywhere moves their ctime, a touch
 * that withholds every run in flight (task 001-168). pytest's install is
 * found by `recheck` instead, whose fingerprint lists site-packages
 * (task 007-26). `packages` is empty: no JavaScript lockfile keys a Python
 * test.
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
    // 016 D4, O8: its runs observe module imports, which key whatever `observe.runtimeInputs` says
    observedLoads: true,
  };
}

/** A change to `pyvenv.cfg`, which re-derives the graph's search path (D5). */
export function structural(root: AbsolutePath, dir: AbsolutePath): InvalidatedPath[] {
  // An environment outside the worktree too: the graph reads the name, not the place.
  return [{ path: relative(root, join(dir, "pyvenv.cfg")).split(sep).join("/"), kind: "change" }];
}
