import { execFile } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { compare } from "../../core/fs/compare.js";
import { toAbsolute } from "../../core/fs/paths.js";
import type { AbsolutePath, RelativePath } from "../../core/types/common.js";
import type { JestProject } from "../../core/types/policy-jest.js";
import type { RunnerEnvironment } from "../../core/types/runner.js";
import { RECORDER_VERSION } from "../observe/runtime.js";
import { type JestInstall, tsNodeHygiene } from "./resolve.js";

/*
 * Spec 028 D2.3: one Jest project's environment identity. The resolved
 * config is read in a child process with the project's own `jest-config`
 * (`readConfig`, as `--config` reads it), so the project's config code never
 * runs in the daemon and an edited config is never served from a `require`
 * cache. The same child lists the project's test files with Jest's own
 * `testMatch` matcher. Every worktree path is written `<worktree>`, so two
 * worktrees with the same code and packages key alike (Decision 0002).
 */

/** `runnerVersion` while the project has no Jest to run: no stored result was produced under it. */
export const JEST_UNAVAILABLE = "unavailable";

/** What the child read of one project, or why it could not. */
export type JestRead =
  | {
      readonly ok: true;
      /** Jest's normalized `ProjectConfig`, as `--showConfig` prints it. */
      readonly project: Readonly<Record<string, unknown>>;
      /** Jest's normalized `GlobalConfig`. */
      readonly global: Readonly<Record<string, unknown>>;
      /** Every file Jest's `testMatch`, `testRegex` and `testPathIgnorePatterns` select under `roots`. */
      readonly testPaths: readonly AbsolutePath[];
      /** The raw config's `preset`, resolved to its file; `null` without one. */
      readonly preset: AbsolutePath | null;
      /** Worktree files the config's evaluation loaded or read, outside `node_modules` and `.git`. */
      readonly configDeps: readonly AbsolutePath[];
    }
  | {
      readonly ok: false;
      readonly error: string;
      /** What the evaluation loaded or read before it failed; absent when the child gave no answer. */
      readonly configDeps?: readonly AbsolutePath[];
    };

const READ_TIMEOUT_MS = 60_000;

/**
 * Reads `jest-config` at argv[1] on the config at argv[2], recording every
 * worktree file (argv[3]) the evaluation loads by `require` or `import`, or
 * reads with `fs` (review 0.1.644 B4), then walks `roots` (skipping
 * `node_modules` and `.git`) for the files Jest's SearchSource would select.
 * Its JSON is the last line it prints, with the recorded files on a failure too.
 */
const READER = String.raw`
const path = require("path");
const fs = require("fs");
const { createRequire, registerHooks } = require("module");
const { fileURLToPath } = require("url");
const [jestConfig, configPath, worktree] = process.argv.slice(1);
const print = (value) => process.stdout.write("\n" + JSON.stringify(value) + "\n");
const roots = [worktree];
try { roots.push(fs.realpathSync(worktree)); } catch {}
const seen = new Set();
let recording = false;
const record = (target) => {
  if (!recording) return;
  try {
    if (target instanceof URL || (typeof target === "string" && target.startsWith("file:"))) {
      seen.add(fileURLToPath(target));
    } else if (typeof target === "string") seen.add(path.resolve(target));
    else if (Buffer.isBuffer(target)) seen.add(path.resolve(target.toString()));
  } catch {}
};
const configDeps = (cached) => {
  for (const file of Object.keys(require.cache)) if (!cached.has(file)) seen.add(file);
  const out = new Set();
  for (const file of seen) {
    const root = roots.find((r) => file.startsWith(r + path.sep));
    if (root === undefined) continue;
    const local = worktree + file.slice(root.length);
    const parts = local.slice(worktree.length + 1).split(path.sep);
    if (parts.includes("node_modules") || parts.includes(".git")) continue;
    try { if (fs.statSync(local).isFile()) out.add(local); } catch {}
  }
  return [...out].sort();
};
(async () => {
  const { readConfig, readInitialOptions } = require(jestConfig);
  const cached = new Set(Object.keys(require.cache));
  let hooks = null;
  try {
    hooks = registerHooks({ load(url, context, next) { record(url); return next(url, context); } });
  } catch {}
  const wrapped = [[fs, "readFileSync"], [fs, "readFile"], [fs.promises, "readFile"]];
  const originals = wrapped.map(([owner, name]) => owner[name]);
  wrapped.forEach(([owner, name], i) => {
    owner[name] = function (target, ...rest) { record(target); return originals[i].call(this, target, ...rest); };
  });
  let projectConfig, globalConfig, preset = null, deps;
  recording = true;
  try {
    ({ projectConfig, globalConfig } = await readConfig({ $0: "jest", _: [], ci: true }, configPath));
    try {
      const raw = (await readInitialOptions(configPath, { skipMultipleConfigError: true })).config;
      if (typeof raw.preset === "string") {
        const from = createRequire(path.join(projectConfig.rootDir, "package.json"));
        const named = raw.preset.startsWith(".") ? path.resolve(projectConfig.rootDir, raw.preset) : raw.preset;
        for (const candidate of [named, named + "/jest-preset"]) {
          try { preset = from.resolve(candidate); break; } catch {}
        }
      }
    } catch {}
  } catch (error) {
    throw Object.assign(new Error(String((error && error.message) || error)), { deps: configDeps(cached) });
  } finally {
    recording = false;
    wrapped.forEach(([owner, name], i) => { owner[name] = originals[i]; });
    try { if (hooks !== null) hooks.deregister(); } catch {}
  }
  deps = configDeps(cached);
  const util = require(createRequire(path.join(jestConfig, "package.json")).resolve("jest-util"));
  const exts = new Set(projectConfig.moduleFileExtensions.map((e) => "." + e));
  const match = projectConfig.testMatch.length > 0 ? util.globsToMatcher(projectConfig.testMatch) : null;
  const regex = [].concat(projectConfig.testRegex || []).map((r) => new RegExp(r));
  const ignored = projectConfig.testPathIgnorePatterns.length > 0
    ? new RegExp(projectConfig.testPathIgnorePatterns.join("|")) : null;
  const found = new Set();
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && exts.has(path.extname(file))) {
        if (ignored !== null && ignored.test(file)) continue;
        if (match !== null ? match(file) : regex.some((r) => r.test(file))) found.add(file);
      }
    }
  };
  for (const root of projectConfig.roots) walk(root);
  print({ ok: true, project: projectConfig, global: globalConfig, testPaths: [...found].sort(), preset, configDeps: deps });
})().catch((error) => print({
  ok: false,
  error: String((error && error.message) || error),
  ...(error && Array.isArray(error.deps) ? { configDeps: error.deps } : {}),
}));
`;

/**
 * The environment the project's Jest processes start from, as `runJest`
 * gives it: `source`, the project's unexpanded `env` over it,
 * `NODE_ENV=test` when neither sets it, and D2.2's ts-node pin on Jest 29.
 */
export function projectProcessEnv(
  root: AbsolutePath,
  project: JestProject,
  install: JestInstall,
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...source, ...project.env };
  return {
    ...env,
    NODE_ENV: env.NODE_ENV ?? "test",
    ...tsNodeHygiene(install.major, toAbsolute(root, project.config), root, env),
  };
}

/** The project's `cwd`: its own, else the config file's folder. */
export function jestCwd(root: AbsolutePath, project: JestProject): AbsolutePath {
  return project.cwd === undefined
    ? (dirname(toAbsolute(root, project.config)) as AbsolutePath)
    : toAbsolute(root, project.cwd);
}

/** D2.3: reads the project's resolved config and test files in a child process from its `cwd`. */
export function readJestProject(
  root: AbsolutePath,
  project: JestProject,
  install: JestInstall,
  source: NodeJS.ProcessEnv,
): Promise<JestRead> {
  const env = projectProcessEnv(root, project, install, source);
  const args = ["-e", READER, install.config, toAbsolute(root, project.config), root];
  return new Promise((done) => {
    execFile(
      process.execPath,
      args,
      { cwd: jestCwd(root, project), env, timeout: READ_TIMEOUT_MS, maxBuffer: 64 << 20 },
      (error, stdout) => {
        const last = stdout.trimEnd().split("\n").at(-1) ?? "";
        try {
          if (last.startsWith("{")) return done(JSON.parse(last) as JestRead);
        } catch {
          // Reported below.
        }
        const reason = error?.message.split("\n")[0] ?? `unexpected output ${JSON.stringify(last)}`;
        done({ ok: false, error: `reading its Jest config failed: ${reason}` });
      },
    );
  });
}

/** What one project's environment is computed from. */
export interface JestEnvironmentInput {
  readonly root: AbsolutePath;
  readonly project: JestProject;
  readonly install: JestInstall;
  readonly read: JestRead;
  /** The run environment the project's processes inherit. */
  readonly source: NodeJS.ProcessEnv;
  readonly adapterVersion: string;
  /** Runs carry `recorder.cjs` (policy `observe.runtimeInputs`): its version is keyed. */
  readonly observing: boolean;
}

/** Projects config fields that change per run, machine or worktree and never an outcome. */
const VOLATILE_PROJECT = new Set(["cacheDirectory", "id", "runtime"]);
const VOLATILE_GLOBAL = new Set([
  "cacheDirectory",
  "maxWorkers",
  "seed",
  "reporters",
  "watch",
  "watchAll",
  "watchman",
  "ci",
]);
/** D2.3: the packages whose installed version keys every Jest project. */
const PACKAGES = [
  "jest",
  "jest-environment-jsdom",
  "babel-jest",
  "ts-jest",
  "@babel/core",
  "typescript",
] as const;
const BABEL = [
  "babel.config.js",
  "babel.config.cjs",
  "babel.config.mjs",
  "babel.config.cts",
  "babel.config.json",
  ".babelrc",
  ".babelrc.js",
  ".babelrc.cjs",
  ".babelrc.mjs",
  ".babelrc.cts",
  ".babelrc.json",
];
const TSCONFIGS = ["tsconfig.spec.json", "tsconfig.json", "tsconfig.base.json"];

/** D2.3: the runner-side environment inputs of one Jest project. */
export function jestEnvironment(input: JestEnvironmentInput): RunnerEnvironment {
  const { root, project, install, read } = input;
  const portable = portablePaths(root);
  const cwd = slashes(relative(root, jestCwd(root, project)));
  const env = projectProcessEnv(root, project, install, input.source);
  const descriptors = Object.fromEntries(
    Object.entries(env)
      .filter(
        ([name]) =>
          name === "NODE_ENV" ||
          name === "BABEL_ENV" ||
          name === "TZ" ||
          (install.major === 29 && name.startsWith("TS_NODE_")),
      )
      .sort(([a], [b]) => compare(a, b)),
  );
  const config = {
    config: project.config,
    cwd,
    include: project.include,
    exclude: project.exclude,
    args: project.args,
    // Unexpanded: a slot template keys as written, never as one slot's value (spec 027 D2).
    env: Object.entries(project.env).sort(([a], [b]) => compare(a, b)),
    variables: descriptors,
    ...(input.observing ? { recorder: RECORDER_VERSION } : {}),
    ...(read.ok
      ? {
          project: omit(read.project, VOLATILE_PROJECT),
          global: omit(read.global, VOLATILE_GLOBAL),
          packages: packageVersions(root, jestCwd(root, project), read),
        }
      : { error: read.error }),
  };
  return {
    project: project.name,
    ...(cwd === "" ? {} : { root: cwd }),
    runnerName: "jest",
    runnerVersion: read.ok ? install.version : JEST_UNAVAILABLE,
    adapterVersion: input.adapterVersion,
    resolvedConfig: portable(JSON.stringify(sorted(config))),
    files: configFiles(root, project, read, env),
    // Spec 016 D4: its runs report module loads, which key whatever `observe.runtimeInputs` says.
    observedLoads: true,
  };
}

/**
 * The environment of a project without a Jest to drive (D2.1): every file
 * stays `unknown`, and nothing is keyed or inherited under it.
 */
export function unavailableEnvironment(
  root: AbsolutePath,
  project: JestProject,
  note: string,
  adapterVersion: string,
  /** What a config that failed to read had loaded: an edit of one may fix it. */
  configDeps: readonly AbsolutePath[] = [],
): RunnerEnvironment {
  const cwd = slashes(relative(root, jestCwd(root, project)));
  const config = { config: project.config, state: "unavailable", note };
  return {
    project: project.name,
    ...(cwd === "" ? {} : { root: cwd }),
    runnerName: "jest",
    runnerVersion: JEST_UNAVAILABLE,
    adapterVersion,
    resolvedConfig: portablePaths(root)(JSON.stringify(config)),
    files: inside(root, [toAbsolute(root, project.config), ...configDeps]),
    observedLoads: true,
  };
}

/**
 * D2.3's watched config chain: the config file, the preset file, the babel
 * configs from the project's `rootDir` up to the worktree root, the nearest
 * `package.json` and tsconfig with its `extends` chain, ts-node's pinned
 * project, and every project file the resolved config names (setup files,
 * a local transformer, environment or resolver), and every worktree file
 * the config's evaluation loaded or read. Worktree-relative, sorted.
 */
export function configFiles(
  root: AbsolutePath,
  project: JestProject,
  read: JestRead,
  env: NodeJS.ProcessEnv,
): RelativePath[] {
  const config = toAbsolute(root, project.config);
  const files: string[] = [config];
  const rootDir = read.ok ? String(read.project.rootDir) : dirname(config);
  const dirs = upTo(rootDir, root);
  for (const dir of dirs) for (const name of BABEL) files.push(join(dir, name));
  const manifest = dirs.map((dir) => join(dir, "package.json")).find((path) => existsSync(path));
  if (manifest !== undefined) files.push(manifest);
  const tsconfig = dirs.flatMap((dir) => TSCONFIGS.map((name) => join(dir, name))).find(existsSync);
  for (const path of [tsconfig, env.TS_NODE_PROJECT]) {
    if (path !== undefined) files.push(...extendsChain(resolve(jestCwd(root, project), path)));
  }
  // Review 0.1.644 B4: what the config imported or read, on a read that failed too.
  files.push(...(read.configDeps ?? []));
  if (read.ok) {
    if (read.preset !== null) files.push(read.preset);
    for (const value of strings(read.project)) {
      if (value.startsWith(root + sep) && !value.includes(`${sep}node_modules${sep}`)) {
        if (isFile(value)) files.push(value);
      }
    }
  }
  return inside(root, files);
}

/** A tsconfig and each file its relative `extends` names, existing ones only. */
function extendsChain(path: string): string[] {
  const chain: string[] = [];
  for (let at: string | null = path; at !== null && !chain.includes(at); ) {
    if (!isFile(at)) {
      chain.push(at);
      break;
    }
    chain.push(at);
    const base = extendsOf(at);
    at =
      base === null ? null : resolve(dirname(at), base.endsWith(".json") ? base : `${base}.json`);
  }
  return chain;
}

/** A tsconfig's relative `extends`; `null` for none, a package's, or a file that is no JSON. */
function extendsOf(path: string): string | null {
  try {
    const text = readFileSync(path, "utf8").replace(/^\s*\/\/.*$/gm, "");
    const value = (JSON.parse(text) as { extends?: unknown }).extends;
    return typeof value === "string" && value.startsWith(".") ? value : null;
  } catch {
    return null;
  }
}

/**
 * D2.3: the installed version of each of {@link PACKAGES} found from `cwd`
 * up to the worktree root, and of each package the resolved config loads
 * from `node_modules` (a preset, transformer, environment or runner).
 */
function packageVersions(
  root: AbsolutePath,
  cwd: AbsolutePath,
  read: Extract<JestRead, { ok: true }>,
): Record<string, string | null> {
  const versions: Record<string, string | null> = {};
  for (const name of PACKAGES) {
    const dir = upTo(cwd, root)
      .map((d) => join(d, "node_modules", name))
      .find((d) => existsSync(join(d, "package.json")));
    versions[name] = dir === undefined ? null : (manifestOf(dir)?.version ?? null);
  }
  for (const value of strings(read.project)) {
    const at = value.lastIndexOf(`${sep}node_modules${sep}`);
    // A pattern such as `testPathIgnorePatterns`' `/node_modules/` is no installed file.
    if (at <= 0 || !isFile(value)) continue;
    for (let dir = dirname(value); dir.length > at && dir !== dirname(dir); dir = dirname(dir)) {
      const manifest = manifestOf(dir);
      if (manifest?.name === undefined) continue;
      versions[manifest.name] = manifest.version ?? null;
      break;
    }
  }
  return versions;
}

function manifestOf(dir: string): { name?: string; version?: string } | null {
  try {
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      name?: string;
      version?: string;
    };
  } catch {
    return null;
  }
}

/** Every string inside `value`, at any depth. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

/** `from` and each folder above it up to `root`; only `from` when it is outside `root`. */
function upTo(from: string, root: AbsolutePath): string[] {
  const dirs = [from];
  if (from !== root && !from.startsWith(root + sep)) return dirs;
  for (let dir = from; dir !== root && dir !== dirname(dir); ) {
    dir = dirname(dir);
    dirs.push(dir);
  }
  return dirs;
}

/** The paths inside `root`, worktree-relative, sorted, once each. */
function inside(root: AbsolutePath, paths: readonly string[]): RelativePath[] {
  const out = new Set<RelativePath>();
  for (const path of paths) {
    if (path.startsWith(root + sep)) out.add(slashes(path.slice(root.length + 1)));
  }
  return [...out].sort(compare);
}

function omit(
  value: Readonly<Record<string, unknown>>,
  keys: ReadonlySet<string>,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.has(key)));
}

/** Objects with their keys sorted, at any depth. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort(compare)
        .map((key) => [key, sorted((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/**
 * Replaces the worktree root, as given and as its real path, with
 * `<worktree>` wherever it starts a path: followed by `/`, a quote, white
 * space or the end, so `/w/a` does not touch `/w/ab` (pytest's rule).
 */
function portablePaths(root: AbsolutePath): (text: string) => string {
  let real: string = root;
  try {
    real = realpathSync(root);
  } catch {
    // The root as given.
  }
  const roots = [...new Set([root, real])].sort((a, b) => b.length - a.length);
  const escaped = roots.map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")})(?=[/"'\\s]|$)`, "g");
  return (text) => text.replace(pattern, "<worktree>");
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function slashes(path: string): string {
  return path.split(sep).join("/");
}
