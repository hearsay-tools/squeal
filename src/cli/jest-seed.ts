import { existsSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { compare } from "../core/fs/compare.js";
import { isRecord } from "../core/fs/json.js";
import { toAbsolute } from "../core/fs/paths.js";
import type { AbsolutePath } from "../core/types/common.js";
import type { JestProject } from "../core/types/policy-jest.js";
import { type JestRead, readJestProject } from "../runners/jest/environment.js";
import { resolveJest } from "../runners/jest/resolve.js";

/*
 * Spec 028 D1.2: `squeal setup` seeds one `jest` entry per Jest project.
 * Each config file and each `package.json` with a `jest` key is read once
 * with the project's own `jest-config`, in a child process. A root config
 * that lists `projects` (`@nx/jest`'s `getJestProjectsAsync()` too) is
 * expanded into its projects and not seeded itself: a file or folder entry
 * by its own config, an inline project object by the root config and its
 * selector (`JestProject.project`, review 0.1.646 B2). A config without
 * `projects` that sits above other Jest configs is a catch-all that would
 * run their tests without their transforms, and a root config that selects
 * no test file catches nothing: each is skipped with a note.
 */

/** A `jest` entry as written: `include`, `exclude`, `args` and `env` are left to their defaults. */
export type SeededJest = Pick<JestProject, "name" | "config" | "cwd" | "project">;

export interface JestSeed {
  readonly projects: readonly SeededJest[];
  /** One line per seeded project, per skipped config and per config read without Jest. */
  readonly notes: readonly string[];
}

/** The config file names Jest finds in a folder, in its order (`JEST_CONFIG_EXT_ORDER`). */
const CONFIG_NAMES: readonly string[] = [
  "jest.config.js",
  "jest.config.ts",
  "jest.config.mjs",
  "jest.config.cjs",
  "jest.config.json",
];

/** Directories never taken for a project: another tool's, and test fixtures (as the pytest seed's). */
const SKIPPED = /(^|\/)(node_modules|fixtures|__fixtures__|\.[^/]*)(\/|$)/;

/** Config reads at once: each is a Node process that loads the project's Jest. */
const READS_AT_ONCE = 4;

/** One project to seed: a config, and the inline project of it when it is one. */
interface Entry {
  readonly config: string;
  readonly project?: string;
  readonly read: JestRead | null;
}

/** One candidate config and what its read found. */
interface Candidate {
  /** Worktree-relative. */
  readonly config: string;
  /** Its folder, worktree-relative, `""` for the root. */
  readonly dir: string;
  readonly read: JestRead | null;
}

/**
 * The Jest projects of the worktree at `root`, from its `tracked` files
 * (worktree-relative); `env` is the environment a config is read in.
 * `taken` holds names other runners' projects already use.
 */
export async function seedJest(
  root: AbsolutePath,
  tracked: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  taken: ReadonlySet<string> = new Set(),
): Promise<JestSeed> {
  const configs = candidates(root, tracked);
  const reads = await pool(configs, (config) => readConfig(root, config, env));
  const found: Candidate[] = configs.map((config, i) => ({
    config,
    dir: dirOf(config),
    read: reads[i] ?? null,
  }));
  const notes: string[] = [];
  const entries: Entry[] = [];
  const add = (entry: Entry) => {
    const same = (e: Entry) => e.config === entry.config && e.project === entry.project;
    if (!entries.some(same)) entries.push(entry);
  };
  for (const candidate of found) {
    const { config, read } = candidate;
    const listed = projectsOf(read);
    if (listed.length > 0) {
      notes.push(
        `Jest config ${config} lists ${listed.length} project${listed.length === 1 ? "" : "s"}: Squeal seeds each, not the config itself`,
      );
      for (const entry of await expand(root, candidate, listed, env, notes)) add(entry);
      continue;
    }
    const skip = catchAll(candidate, found);
    if (skip !== null) {
      notes.push(`skipped Jest config ${config}: ${skip}`);
      continue;
    }
    if (read === null && mentionsProjects(root, config)) {
      notes.push(
        `skipped Jest config ${config}: jest is not installed yet, and the config may list projects only Jest can expand; install jest and run squeal setup again`,
      );
      continue;
    }
    add({ config, read });
  }
  const names = new Set(taken);
  const projects: SeededJest[] = [];
  entries.sort((a, b) => compare(a.config, b.config) || compare(a.project ?? "", b.project ?? ""));
  for (const { config, project, read } of entries) {
    const name = uniqueName(displayName(read), dirOf(config), names);
    names.add(name);
    projects.push({ name, config, ...(project === undefined ? {} : { project }) });
    const inline = project === undefined ? "" : ` (project ${JSON.stringify(project)})`;
    notes.push(`seeded jest project "${name}" from ${config}${inline}`);
    if (read === null) {
      notes.push(
        `jest project "${name}": jest is not installed yet, so its config was not read; its checks stay unknown until jest 29 or 30 is installed`,
      );
    } else if (!read.ok) {
      notes.push(`jest project "${name}": ${read.error}`);
    }
  }
  return { projects, notes };
}

/** Tracked Jest config files and `package.json` files with a `jest` key, sorted. */
function candidates(root: AbsolutePath, tracked: readonly string[]): string[] {
  return tracked
    .filter((path) => {
      if (SKIPPED.test(dirOf(path))) return false;
      const name = posix.basename(path);
      if (CONFIG_NAMES.includes(name)) return true;
      return name === "package.json" && hasJestKey(join(root, path));
    })
    .sort(compare);
}

/**
 * Reads one config, or its inline project `selector`, with the Jest
 * installed for its folder; `null` when there is none.
 */
async function readConfig(
  root: AbsolutePath,
  config: string,
  env: Readonly<Record<string, string | undefined>>,
  selector?: string,
): Promise<JestRead | null> {
  const project: JestProject = {
    name: config,
    config,
    ...(selector === undefined ? {} : { project: selector }),
    include: [],
    exclude: [],
    args: [],
    env: {},
  };
  const resolution = resolveJest(config, toAbsolute(root, dirOf(config)), root);
  if (!resolution.ok) return null;
  return readJestProject(root, project, resolution.install, env as NodeJS.ProcessEnv);
}

/** The `projects` a read config lists, as Jest resolved them; `[]` for none. */
function projectsOf(read: JestRead | null): readonly unknown[] {
  const listed = read?.ok === true ? read.global.projects : undefined;
  return Array.isArray(listed) ? listed : [];
}

/**
 * Each project a root config lists, read: a file or folder entry by its
 * config (a folder takes the first Jest config in it, else its
 * `package.json`, as Jest finds one), an inline object by the root config
 * and the selector its read names.
 */
async function expand(
  root: AbsolutePath,
  { config: from, read }: Candidate,
  listed: readonly unknown[],
  env: Readonly<Record<string, string | undefined>>,
  notes: string[],
): Promise<Entry[]> {
  const configs: string[] = [];
  for (const entry of listed) {
    if (typeof entry !== "string") continue;
    const config = projectConfig(root, entry);
    if (config === null) {
      notes.push(
        `Jest config ${from} lists ${entry}, which holds no Jest config inside the worktree`,
      );
    } else if (!configs.includes(config)) configs.push(config);
  }
  const selectors = read?.ok === true ? (read.inlineProjects ?? []) : [];
  const [files, inline] = await Promise.all([
    pool(configs, (config) => readConfig(root, config, env)),
    pool(selectors, (selector) => readConfig(root, from, env, selector)),
  ]);
  return [
    ...configs.map((config, i) => ({ config, read: files[i] ?? null })),
    ...selectors.map((project, i) => ({ config: from, project, read: inline[i] ?? null })),
  ];
}

/** A listed project's config file, worktree-relative; `null` for none inside the worktree. */
function projectConfig(root: AbsolutePath, path: string): string | null {
  const rel = relative(root, path).split(sep).join("/");
  if (rel === ".." || rel.startsWith("../") || posix.isAbsolute(rel)) return null;
  if (isFile(path)) return rel;
  for (const name of [...CONFIG_NAMES, "package.json"]) {
    if (isFile(join(path, name))) return posix.join(rel, name);
  }
  return null;
}

/** Why a config without `projects` is a catch-all not to seed, or `null`. */
function catchAll(candidate: Candidate, all: readonly Candidate[]): string | null {
  const { dir, read } = candidate;
  const nested = all
    .filter((c) => c.dir !== dir && (dir === "" || c.dir.startsWith(`${dir}/`)))
    .map((c) => c.config);
  if (nested.length > 0) {
    return `it lists no projects and sits above ${nested.join(", ")}, whose tests it would run without their own config; Squeal seeds those instead`;
  }
  // Below the root a config with no test yet is still a project; at the root it is a catch-all.
  if (dir !== "" || read?.ok !== true || read.testPaths.length > 0) return null;
  return "it lists no projects and selects no test file";
}

/** Jest's `displayName`, a string or `{ name }`; `null` without one. */
function displayName(read: JestRead | null): string | null {
  if (read?.ok !== true) return null;
  const value = read.project.displayName;
  const name = isRecord(value) ? value.name : value;
  return typeof name === "string" && name.trim() !== "" ? name.trim() : null;
}

/** The display name, else the config's folder (`jest` at the root), made unique among `taken`. */
function uniqueName(preferred: string | null, dir: string, taken: ReadonlySet<string>): string {
  const folder = dir === "" ? "jest" : dir;
  for (const name of [preferred, folder]) if (name !== null && !taken.has(name)) return name;
  for (let n = 2; ; n++) if (!taken.has(`${folder}-${n}`)) return `${folder}-${n}`;
}

/** Whether a config file read without Jest names `projects`, which only Jest can expand. */
function mentionsProjects(root: AbsolutePath, config: string): boolean {
  try {
    const text = readFileSync(join(root, config), "utf8");
    if (posix.basename(config) !== "package.json") return /\bprojects\b/.test(text);
    const manifest: unknown = JSON.parse(text);
    return isRecord(manifest) && isRecord(manifest.jest) && "projects" in manifest.jest;
  } catch {
    return false;
  }
}

function hasJestKey(path: string): boolean {
  try {
    const manifest: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isRecord(manifest) && "jest" in manifest;
  } catch {
    return false;
  }
}

/** Maps `items` with at most {@link READS_AT_ONCE} calls of `each` running, in order. */
async function pool<T, R>(items: readonly T[], each: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const work = async () => {
    while (next < items.length) {
      const at = next++;
      results[at] = await each(items[at] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(READS_AT_ONCE, items.length) }, work));
  return results;
}

function dirOf(path: string): string {
  const dir = posix.dirname(path);
  return dir === "." ? "" : dir;
}

function isFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}
