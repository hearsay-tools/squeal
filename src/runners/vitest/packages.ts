import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
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
import type { WorktreePaths } from "./paths.js";
import type { ProjectInputs } from "./project.js";

const NODE_MODULES = "node_modules/";

/** A literal `require("x")`; `myrequire(` and `require(x)` do not match. */
const REQUIRE = /\brequire\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g;

/**
 * The installed packages and builtins a closure's project files import in
 * one hop (spec 001 D3, task 001-105). A package entry Vite resolved,
 * `<dir>/node_modules/<name>/...`, is looked up from `<dir>`; a specifier
 * Vite left bare from its importer's directory. Entries outside the worktree
 * are left out: no install of this worktree holds them, so its keys could
 * not cover them either way.
 */
export function closurePackages(graph: ImportClosure, paths: WorktreePaths): RunnerPackages {
  const imports: PackageImport[] = [];
  for (const file of graph.files) {
    const rel = paths.toRelative(file);
    const at = rel === null ? -1 : rel.lastIndexOf(NODE_MODULES);
    if (rel === null || at === -1 || (at > 0 && rel[at - 1] !== "/")) continue;
    const name = packageName(rel.slice(at + NODE_MODULES.length));
    if (name !== null) imports.push({ from: rel.slice(0, Math.max(0, at - 1)), name });
  }
  for (const [importer, names] of graph.bare) {
    const from = directoryOf(dirname(importer), paths);
    if (from === null) continue;
    for (const name of names) imports.push({ from, name });
  }
  return { imports, builtins: [...graph.builtins].sort(compare) };
}

/**
 * Packages every test file of the project can load (D3, task 001-105): the
 * runner itself, looked up from the project root, what the setup and
 * `globalSetup` closures import, and the bare imports and literal
 * `require`s of the config files, which name the config's plugins.
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
  if (root !== null) imports.push({ from: root, name: "vitest" });
  await init;
  for (const file of inputs.configFiles) {
    const from = paths.isProjectFile(file) ? directoryOf(dirname(file), paths) : null;
    if (from === null) continue;
    for (const specifier of await specifiersOf(file)) {
      const builtin = builtinOf(specifier);
      const name = builtin === null ? packageName(specifier) : null;
      if (builtin !== null) builtins.add(builtin);
      else if (name !== null) imports.push({ from, name });
    }
  }
  return { imports, builtins: [...builtins].sort(compare) };
}

/**
 * Import and `require` specifiers of a config file. One the lexer cannot
 * read yields only its `require`s; its imports were bundled by Vite already,
 * so a parse failure here is not a broken config.
 */
async function specifiersOf(file: AbsolutePath): Promise<string[]> {
  let source: string;
  try {
    source = await readFile(file, "utf8");
  } catch {
    return [];
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
  for (const match of source.matchAll(REQUIRE)) {
    if (match[2] !== undefined) specifiers.push(match[2]);
  }
  return specifiers;
}

/** A directory relative to the worktree root, `""` for the root, `null` outside it. */
function directoryOf(dir: AbsolutePath, paths: WorktreePaths): RelativePath | null {
  return dir === paths.root ? "" : paths.toRelative(dir);
}
