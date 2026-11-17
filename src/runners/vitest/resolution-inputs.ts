import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import type { TestProject } from "vitest/node";
import type { WorktreePaths } from "../../core/fs/worktree-paths.js";
import type { AbsolutePath } from "../../core/types/common.js";
import { readSource } from "./dynamic.js";
import { LANGS, type Node, type ParseAst, walk } from "./glob-listing.js";
import { builtinOf, type ImportClosure, packageName } from "./graph.js";

/**
 * Row 023-14 (`023 research/glob-membership.md` 3, S7): the manifests that
 * decide how a module's imports resolve, though no closure file's bytes
 * change when they change. Each enters the closure as a path, an absent one
 * hashing as absent (spec 001 D3), so a restart, another worktree and a CI
 * import key the change as the running daemon sees it (D4). A CI shard's
 * evidence holds them: Vite reads each module's nearest `package.json` in
 * JavaScript (018 D9).
 *
 * - For a `#` import, the `package.json` Vite reads its `imports` from: the
 *   nearest one above the importer, and each absent one on the way there.
 * - For a bare import that resolves to a project folder (a workspace link,
 *   or the importer's own package by name), that folder's `package.json`,
 *   whose `exports` or `main` picked the file.
 *
 * Not modelled: tsconfig `paths` and aliases (closures are declared
 * incomplete, D3), the target of a `#` entry, and a file that shadows a
 * relative import's target (a `registry.js` beside an imported
 * `registry.ts`): Vite 8 probes those in its native resolver, so no CI
 * shard's evidence holds their absence (row 023-14 notes).
 */

/** The import specifiers of one module that read a manifest, as its source writes them. */
export interface ModuleSpecifiers {
  /** Whether it imports a `#` subpath. */
  readonly subpath: boolean;
  /** Its bare specifiers, builtins left out. */
  readonly bare: readonly string[];
}

const NONE: ModuleSpecifiers = { subpath: false, bare: [] };

/**
 * The `#` and bare specifiers of `source`'s value imports and re-exports and its
 * literal `import()`, read from its syntax tree: type-only ones are erased
 * and resolve nothing, and text in a comment or string gives none. `null`
 * when the module cannot be read here (not a script by its extension, or a
 * parse error).
 */
export async function moduleSpecifiers(
  file: string,
  source: string,
  parse: ParseAst,
): Promise<ModuleSpecifiers | null> {
  const lang = LANGS[extname(file)];
  const parsing = Promise.resolve(lang).then((l) =>
    l === undefined ? null : parse(source, { lang: l }, file),
  );
  const program = await parsing.catch(() => null);
  if (program === null) return null;
  const bare = new Set<string>();
  let subpath = false;
  walk(program, (node) => {
    const specifier = specifierOf(node);
    if (specifier === null) return;
    const path = specifier.split("?")[0] ?? specifier;
    if (path.startsWith("#")) subpath = true;
    else if (builtinOf(path) === null && packageName(path) !== null) bare.add(path);
  });
  return { subpath, bare: [...bare] };
}

function specifierOf(node: Node): string | null {
  const kind = node.type;
  const erased = node.importKind === "type" || node.exportKind === "type";
  const declares =
    kind === "ImportDeclaration" ||
    kind === "ExportAllDeclaration" ||
    kind === "ExportNamedDeclaration";
  const source = declares && !erased ? (node.source as Node | null | undefined) : null;
  const imported = kind === "ImportExpression" ? (node.source as Node | undefined) : null;
  const value = (source ?? imported)?.value;
  return typeof value === "string" ? value : null;
}

/**
 * The `package.json` paths from `from` up to the worktree root, nearest
 * first, ending at the first that exists: what Vite's
 * `findNearestPackageData` reads, and the absent ones that would come first.
 */
export function nearestManifests(from: AbsolutePath, root: AbsolutePath): AbsolutePath[] {
  const out: AbsolutePath[] = [];
  for (let dir = from; ; dir = dirname(dir)) {
    const manifest = join(dir, "package.json");
    out.push(manifest);
    if (existsSync(manifest) || dir === root || dirname(dir) === dir) return out;
  }
}

/**
 * The manifest of the project folder a bare `specifier` from `importer`
 * resolves to, Vite's way: the importer's own package by name first
 * (`nearest`, its `nearestManifests`, and `own`, the name of the last), then
 * `node_modules/<name>` from its folder up. `[]` for an installed package,
 * which the installed dependencies key (D3).
 */
function bareManifests(
  specifier: string,
  importer: AbsolutePath,
  own: { readonly nearest: readonly AbsolutePath[]; readonly name: unknown },
  paths: WorktreePaths,
): readonly AbsolutePath[] {
  const name = packageName(specifier);
  if (name === null) return [];
  if (own.name === name) return own.nearest;
  for (let dir = dirname(importer); ; dir = dirname(dir)) {
    const link = join(dir, "node_modules", name);
    if (statSync(link, { throwIfNoEntry: false })?.isDirectory()) {
      const real = realpathSync(link);
      return paths.isProjectFile(real) ? [join(real, "package.json")] : [];
    }
    if (dir === paths.root || dirname(dir) === dir) return [];
  }
}

/**
 * The `name` of `manifest`; `undefined` when it cannot be read. One that
 * does not parse never gets here: Vite 8's resolver rejects it (a
 * `JSONError`), so no module below it has a transform to walk. One edited
 * between Vite's read and this one throws, and the closure call fails as a
 * state (001 D5) until the edit's re-resolve (D3).
 */
function manifestName(manifest: AbsolutePath | undefined): unknown {
  const text = manifest === undefined ? null : readSource(manifest);
  return text === null ? undefined : (JSON.parse(text) as { name?: unknown }).name;
}

/**
 * One walked module's resolution inputs (the module doc). None when its
 * source cannot be read or parsed: its imports then key as before.
 */
export async function moduleResolutionInputs(
  file: AbsolutePath,
  paths: WorktreePaths,
  parse: ParseAst,
): Promise<AbsolutePath[]> {
  const source = readSource(file);
  const specifiers =
    source === null ? NONE : ((await moduleSpecifiers(file, source, parse)) ?? NONE);
  if (!specifiers.subpath && specifiers.bare.length === 0) return [];
  const nearest = nearestManifests(dirname(file), paths.root);
  const out = new Set<AbsolutePath>(specifiers.subpath ? nearest : []);
  if (specifiers.bare.length === 0) return [...out];
  const own = { nearest, name: manifestName(nearest.at(-1)) };
  for (const specifier of specifiers.bare) {
    for (const manifest of bareManifests(specifier, file, own, paths)) out.add(manifest);
  }
  return [...out];
}

/** Inputs per transform object: a re-transform reads the source again. */
const read = new WeakMap<object, Promise<AbsolutePath[]>>();

/**
 * The adapter's report for one closure: the resolution inputs of each walked
 * project file with a transform, read once per transform. Absolute; the
 * caller keeps the project's.
 */
export async function resolutionInputs(
  project: TestProject,
  graph: ImportClosure,
  paths: WorktreePaths,
  parse: ParseAst,
): Promise<Set<AbsolutePath>> {
  const environment = project.vite.environments.ssr;
  const out = new Set<AbsolutePath>();
  for (const file of graph.edges?.keys() ?? []) {
    const transform = environment?.moduleGraph.getModuleById(file)?.transformResult;
    if (!paths.isProjectFile(file) || !transform) continue;
    const inputs = read.get(transform) ?? moduleResolutionInputs(file, paths, parse);
    read.set(transform, inputs);
    for (const path of await inputs) out.add(path);
  }
  return out;
}
