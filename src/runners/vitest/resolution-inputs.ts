import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import type { TestProject } from "vitest/node";
import { isRecord } from "../../core/fs/json.js";
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
 * import key the change as the running daemon sees it (D4).
 *
 * - A `#` import: the `package.json` Vite reads its `imports` from, the
 *   nearest above the importer, and each absent one on the way there. A
 *   bare target of the entry is followed as a bare import (reviews/wave-4.md
 *   B1).
 * - A bare import that resolves to a project folder (a workspace link, or
 *   the importer's own package by name): that package's `package.json`
 *   (`exports`, `main`). Without `exports`, also the manifest of the folder
 *   its subpath names, and for each import target inside the package, the
 *   manifests from the target's folder up to the nearest that exists (a
 *   nested `main`, B2); with `exports`, no folder's manifest is read.
 *   An installed package adds none: the installed dependencies key it.
 *
 * Not modelled: tsconfig `paths` and aliases (closures are declared
 * incomplete, D3), and a file that shadows a relative import's target (a
 * `registry.js` beside an imported `registry.ts`): Vite 8 probes those in
 * its native resolver, so no CI shard's evidence holds their absence (row
 * 023-14 notes).
 */

/** The import specifiers of one module that read a manifest, as its source writes them. */
export interface ModuleSpecifiers {
  /** Its `#` subpath specifiers. */
  readonly subpaths: readonly string[];
  /** Its bare specifiers, builtins left out. */
  readonly bare: readonly string[];
}

const NONE: ModuleSpecifiers = { subpaths: [], bare: [] };

/**
 * The `#` and bare specifiers of `source`'s value imports and re-exports and
 * its literal `import()`, read from its syntax tree: type-only ones are
 * erased and resolve nothing, and text in a comment or string gives none.
 * `null` when the module cannot be read here (not a script by its
 * extension, or a parse error).
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
  const subpaths = new Set<string>();
  const bare = new Set<string>();
  walk(program, (node) => {
    const specifier = specifierOf(node);
    if (specifier === null) return;
    const path = specifier.split("?")[0] ?? specifier;
    if (path.startsWith("#")) subpaths.add(path);
    else if (builtinOf(path) === null && packageName(path) !== null) bare.add(path);
  });
  return { subpaths: [...subpaths], bare: [...bare] };
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
 * The `package.json` paths from `from` up to `root`, nearest first, ending
 * at the first that exists: what Vite's `findNearestPackageData` reads, and
 * the absent ones that would come first.
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
 * Every target an `imports` field gives `specifier`, under any condition:
 * its exact key, or each `*` pattern key that matches it, the match put in
 * for the `*`. More than Node picks, never less.
 */
export function importsTargets(imports: unknown, specifier: string): string[] {
  if (!isRecord(imports)) return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(imports)) {
    const star = key.indexOf("*");
    const prefix = star < 0 ? key : key.slice(0, star);
    const suffix = star < 0 ? "" : key.slice(star + 1);
    const fits = specifier.startsWith(prefix) && specifier.endsWith(suffix);
    const matches = star < 0 ? key === specifier : fits && specifier.length >= key.length - 1;
    const part = specifier.slice(prefix.length, specifier.length - suffix.length);
    if (matches) out.push(...leaves(value).map((leaf) => leaf.replaceAll("*", part)));
  }
  return out;
}

function leaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(leaves);
  return isRecord(value) ? Object.values(value).flatMap(leaves) : [];
}

/**
 * A manifest's data; `undefined` when absent. One that does not parse fails
 * Vite 8's resolver first (a `JSONError`), so no module below it has a
 * transform to walk; one edited between Vite's read and this one throws, and
 * the closure call fails as a state (001 D5) until the edit's re-resolve.
 */
function manifestOf(path: AbsolutePath | undefined): Record<string, unknown> | undefined {
  const text = path === undefined ? null : readSource(path);
  const data: unknown = text === null ? undefined : JSON.parse(text);
  return isRecord(data) ? data : undefined;
}

/** The importer's own package: its `nearestManifests`, and the data of the last. */
interface Own {
  readonly nearest: readonly AbsolutePath[];
  readonly data: Record<string, unknown> | undefined;
}

/**
 * The project folder a bare `specifier` from `from` resolves into, Vite's
 * way: the importer's own package by name first, then `node_modules/<name>`
 * from `from` up. `null` for an installed package, or none.
 */
function packageRoot(
  specifier: string,
  from: AbsolutePath,
  own: Own,
  paths: WorktreePaths,
): AbsolutePath | null {
  const name = packageName(specifier);
  const ownManifest = own.nearest.at(-1);
  if (name === null) return null;
  if (own.data?.name === name && ownManifest !== undefined) return dirname(ownManifest);
  for (let dir = from; ; dir = dirname(dir)) {
    const link = join(dir, "node_modules", name);
    if (statSync(link, { throwIfNoEntry: false })?.isDirectory()) {
      const real = realpathSync(link);
      return paths.isProjectFile(real) ? real : null;
    }
    if (dir === paths.root || dirname(dir) === dir) return null;
  }
}

/**
 * One walked module's resolution inputs (the module doc), `targets` being
 * its import targets. None when its source cannot be read or parsed: its
 * imports then key as before.
 */
export async function moduleResolutionInputs(
  file: AbsolutePath,
  targets: Iterable<AbsolutePath>,
  paths: WorktreePaths,
  parse: ParseAst,
): Promise<AbsolutePath[]> {
  const source = readSource(file);
  const specifiers =
    source === null ? NONE : ((await moduleSpecifiers(file, source, parse)) ?? NONE);
  if (specifiers.subpaths.length === 0 && specifiers.bare.length === 0) return [];
  const nearest = nearestManifests(dirname(file), paths.root);
  const ownManifest = nearest.at(-1);
  const own: Own = { nearest, data: manifestOf(ownManifest) };
  const out = new Set<AbsolutePath>(specifiers.subpaths.length > 0 ? nearest : []);
  // B1: an entry's bare target resolves from the manifest's own folder.
  const ownDir = dirname(ownManifest ?? file);
  const bare: (readonly [string, AbsolutePath])[] = [
    ...specifiers.bare.map((s) => [s, dirname(file)] as const),
    ...specifiers.subpaths.flatMap((s) =>
      importsTargets(own.data?.imports, s)
        .filter((t) => !t.startsWith("."))
        .map((t) => [t, ownDir] as const),
    ),
  ];
  const roots = new Set<AbsolutePath>();
  for (const [specifier, from] of bare) {
    const root = packageRoot(specifier, from, own, paths);
    if (root === null) continue;
    // The own package is the nearest manifest: one added on the way there takes its place.
    if (own.data?.name === packageName(specifier)) for (const m of own.nearest) out.add(m);
    const manifest = join(root, "package.json");
    out.add(manifest);
    // An `exports` field alone maps the package's subpaths: no folder's manifest is read.
    if (manifestOf(manifest)?.exports !== undefined) continue;
    roots.add(root);
    const subpath = specifier.slice(packageName(specifier)?.length ?? specifier.length);
    if (subpath.startsWith("/")) out.add(join(root, subpath, "package.json"));
  }
  // B2: the manifests that pick a target inside a package without `exports` (a nested `main`).
  for (const target of targets) {
    const root = [...roots].find((r) => target.startsWith(`${r}/`));
    if (root !== undefined) for (const m of nearestManifests(dirname(target), root)) out.add(m);
  }
  return [...out];
}

/** Inputs per transform object: a re-transform reads the source and its targets again. */
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
  for (const [file, edges] of graph.edges ?? []) {
    const transform = environment?.moduleGraph.getModuleById(file)?.transformResult;
    if (!paths.isProjectFile(file) || !transform) continue;
    const targets = [...edges.static, ...edges.dynamic];
    const inputs = read.get(transform) ?? moduleResolutionInputs(file, targets, paths, parse);
    read.set(transform, inputs);
    for (const path of await inputs) out.add(path);
  }
  return out;
}
