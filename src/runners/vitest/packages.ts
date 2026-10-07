import { readFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { init, parse } from "es-module-lexer";
import type { TestProject } from "vitest/node";
import { compare } from "../../core/fs/index.js";
import type {
  AbsolutePath,
  PackageImport,
  RelativePath,
  RunnerPackages,
} from "../../core/types/index.js";
import { builtinOf, type ImportClosure, packageName } from "./graph.js";
import { environmentPackage, sourceLoads } from "./loads.js";
import type { WorktreePaths } from "./paths.js";
import type { ProjectInputs } from "./project.js";

const NODE_MODULES = "node_modules/";

/**
 * The builtin a closure reports for a load no package name stands for: a
 * file under `node_modules` outside any package (`.vite/deps_ssr`, Vite's
 * pre-bundled packages; review wave-11b N4), or a `require` no specifier
 * names. Like `module` itself, it can reach any package.
 */
const UNNAMED = "module";

/**
 * The installed packages and builtins a closure's project files import in
 * one hop (spec 001 D3, task 001-105). A package entry Vite resolved,
 * `<dir>/node_modules/<name>/...`, is looked up from `<dir>`; a specifier
 * Vite left bare from its importer's directory; the environment a docblock
 * names from the project root (task 001-109). Entries outside the worktree
 * are left out: no install of this worktree holds them, so its keys could
 * not cover them either way.
 */
export function closurePackages(graph: ImportClosure, paths: WorktreePaths): RunnerPackages {
  const imports: PackageImport[] = [];
  const builtins = new Set(graph.builtins);
  for (const file of graph.files) {
    const entry = installedEntry(file, paths);
    if (entry === "unnamed") builtins.add(UNNAMED);
    else if (entry !== null) imports.push(entry);
  }
  for (const [importer, names] of graph.bare) {
    const from = directoryOf(dirname(importer), paths);
    if (from === null) continue;
    for (const name of names) imports.push({ from, name });
  }
  const root = directoryOf(graph.root, paths);
  if (root !== null) for (const name of graph.rooted) imports.push({ from: root, name });
  return { imports, builtins: [...builtins].sort(compare) };
}

/**
 * The package an installed file belongs to, looked up from the directory
 * holding its `node_modules`; `"unnamed"` for a file under `node_modules` in
 * no package; `null` for a project file or one outside the worktree.
 */
function installedEntry(
  file: AbsolutePath,
  paths: WorktreePaths,
): PackageImport | "unnamed" | null {
  const rel = paths.toRelative(file);
  const at = rel === null ? -1 : rel.lastIndexOf(NODE_MODULES);
  if (rel === null || at === -1 || (at > 0 && rel[at - 1] !== "/")) return null;
  const rest = rel.slice(at + NODE_MODULES.length);
  const name = packageName(rest);
  if (name === null) return "unnamed";
  const from = rel.slice(0, Math.max(0, at - 1));
  return rest === `${name}/package.json` ? { from, name, manifest: true } : { from, name };
}

/**
 * Packages every test file of the project can load (D3, task 001-105): the
 * runner itself, looked up from the project root, what the setup and
 * `globalSetup` closures import, and the bare imports and literal
 * `require`s of the config files, which name the config's plugins. Task
 * 001-109 (review wave-11b B1): also what the resolved config names by
 * string, which Vitest loads for every test file of the project.
 */
export async function environmentPackages(
  project: TestProject,
  inputs: ProjectInputs,
  paths: WorktreePaths,
): Promise<RunnerPackages> {
  const setup = closurePackages(inputs.setup, paths);
  const globalSetup = closurePackages(inputs.globalSetup, paths);
  const imports = [...setup.imports, ...globalSetup.imports];
  const builtins = new Set([...setup.builtins, ...globalSetup.builtins]);
  const root = directoryOf(project.config.root, paths);
  const runner: PackageImport[] = root === null ? [] : [{ from: root, name: "vitest" }];
  imports.push(...runner);
  if (root !== null) {
    for (const name of namedByConfig(project.config)) imports.push({ from: root, name });
  }
  for (const file of configModules(project.config)) {
    const entry = installedEntry(file, paths);
    if (entry === "unnamed") builtins.add(UNNAMED);
    else if (entry !== null) imports.push(entry);
  }
  await init;
  for (const file of inputs.configFiles) {
    const from = paths.isProjectFile(file) ? directoryOf(dirname(file), paths) : null;
    if (from === null) continue;
    const { specifiers, unnamed } = await loadsOf(file);
    if (unnamed) builtins.add(UNNAMED);
    for (const specifier of specifiers) {
      const builtin = builtinOf(specifier);
      const name = builtin === null ? packageName(specifier) : null;
      if (builtin !== null) builtins.add(builtin);
      else if (name !== null) imports.push({ from, name });
    }
  }
  return { imports, builtins: [...builtins].sort(compare), runner };
}

/** The resolved config's fields Vitest loads by package name. */
interface NamingConfig {
  readonly environment?: unknown;
  readonly reporters?: unknown;
}

/**
 * Package names the resolved config gives as strings, looked up from the
 * project root: the environment's package and every reporter that is a bare
 * specifier. A builtin reporter's name resolves to no package and keys as
 * absent, which changes only when a package of that name is installed.
 */
function namedByConfig(config: NamingConfig): string[] {
  const names: string[] = [];
  if (typeof config.environment === "string") {
    const name = environmentPackage(config.environment);
    if (name !== null) names.push(name);
  }
  const reporters = Array.isArray(config.reporters) ? config.reporters : [];
  for (const reporter of reporters) {
    const specifier = Array.isArray(reporter) ? reporter[0] : reporter;
    const name = typeof specifier === "string" ? packageName(specifier) : null;
    if (name !== null) names.push(name);
  }
  return names;
}

/** The resolved config's fields Vitest resolves to the paths of modules it loads. */
interface ModuleConfig {
  readonly snapshotSerializers?: unknown;
  readonly runner?: unknown;
  readonly snapshotEnvironment?: unknown;
  readonly diff?: unknown;
}

/**
 * The modules the resolved config names by path. Vitest resolves
 * `snapshotSerializers`, `runner`, `snapshotEnvironment` and `diff` when it
 * resolves the config, so a package any of them names shows as
 * `<dir>/node_modules/<name>/…`.
 */
function configModules(config: ModuleConfig): AbsolutePath[] {
  const serializers = Array.isArray(config.snapshotSerializers) ? config.snapshotSerializers : [];
  const values = [...serializers, config.runner, config.snapshotEnvironment, config.diff];
  return values.filter(
    (value): value is AbsolutePath => typeof value === "string" && isAbsolute(value),
  );
}

/**
 * Import and `require` specifiers of a config file, and whether it loads
 * something no specifier names (`require.resolve` and the like). One the
 * lexer cannot read yields only its `require`s; its imports were bundled by
 * Vite already, so a parse failure here is not a broken config.
 */
async function loadsOf(file: AbsolutePath): Promise<{ specifiers: string[]; unnamed: boolean }> {
  let source: string;
  try {
    source = await readFile(file, "utf8");
  } catch {
    return { specifiers: [], unnamed: false };
  }
  const specifiers: string[] = [];
  try {
    const [imports] = parse(source, file);
    for (const record of imports) {
      if (record.type === "import-meta" || record.specifier === undefined) continue;
      if (record.type === "dynamic" ? !record.probablyTypeOnly : !record.typeOnly) {
        specifiers.push(record.specifier);
      }
    }
  } catch {
    // Unreadable to the lexer: the `require` scan below still runs.
  }
  const loads = sourceLoads(source);
  specifiers.push(...loads.requires);
  return { specifiers, unnamed: loads.unnamed };
}

/** A directory relative to the worktree root, `""` for the root, `null` outside it. */
function directoryOf(dir: AbsolutePath, paths: WorktreePaths): RelativePath | null {
  return dir === paths.root ? "" : paths.toRelative(dir);
}
