import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, posix } from "node:path";
import { type Node, type Program, parse, type TemplateLiteral } from "acorn";
import type { TestProject } from "vitest/node";
import { compare } from "../../core/fs/compare.js";
import type { WorktreePaths } from "../../core/fs/worktree-paths.js";
import type { AbsolutePath, RelativePath } from "../../core/types/common.js";
import type { ModuleGlobs } from "../../core/types/runner.js";
import { mayExpandFromDisk } from "./dynamic.js";
import type { ImportClosure } from "./graph.js";

/**
 * Row 023-13 (fix A, `research/glob-membership.md` 2): the folders a
 * module's `import.meta.glob` calls and template-literal `import()`s list on
 * disk, so a key holds the folder's entry names and an add or delete of a
 * matching file moves it at a restart, in another worktree and at a commit.
 */
export interface FolderListing {
  readonly directory: AbsolutePath;
  /** The pattern's remainder past the folder holds `/` or `**`: every folder below is listed too. */
  readonly recursive: boolean;
}

/** One literal glob of a module, before it is resolved. */
export interface GlobPattern {
  readonly pattern: string;
  /** `import.meta.glob`'s `base` option. */
  readonly base?: string;
  /** From a template-literal `import()`, as Vite's `dynamicImportToGlob` writes it. */
  readonly template?: boolean;
}

/** Resolves a non-relative glob as Vite's `resolveId` does; `null` when nothing resolves it. */
export type GlobResolver = (pattern: string, importer: AbsolutePath) => Promise<string | null>;

/** Characters that make a path segment a pattern (picomatch's `scan`). */
const MAGIC = /[*?[\]{}()!+@]/;

/** Source extensions acorn reads after Node strips types; other files fall back. */
const PARSED = /\.(?:[mc]?ts|[mc]?js)$/;

/**
 * The literal globs of `source`, read from its syntax tree: comments and
 * strings that hold glob text give none. `null` when the file does not
 * parse here (TSX, JSX, a framework file): the caller falls back.
 */
export function globPatterns(file: string, source: string): GlobPattern[] | null {
  if (!mayExpandFromDisk(source)) return [];
  const program = PARSED.test(file) ? parseModule(source, /\.[mc]?ts$/.test(file)) : null;
  if (program === null) return null;
  const out: GlobPattern[] = [];
  walk(program, (node) => {
    if (isGlobCall(node)) out.push(...globCall(node));
    if (node.type === "ImportExpression") {
      const source = (node as Node & { source: Node }).source;
      if (source.type === "TemplateLiteral") {
        const pattern = templateGlob(source as TemplateLiteral);
        if (pattern !== null) out.push({ pattern, template: true });
      }
    }
  });
  return out;
}

/**
 * The folders `file`'s globs list, resolved as Vite does (`toAbsoluteGlob`,
 * `getCommonBase` per pattern): `./` and `../` from the importer or a
 * `base`, `/` from the Vite `root`, anything else through `resolve` (aliases,
 * `#` subpaths). A file that does not parse lists its own folder,
 * recursively: an over-run, never a miss.
 */
export async function folderListings(
  file: AbsolutePath,
  source: string,
  root: AbsolutePath,
  resolve: GlobResolver,
): Promise<FolderListing[]> {
  const patterns = globPatterns(file, source);
  if (patterns === null) return [{ directory: dirname(file), recursive: true }];
  const out: FolderListing[] = [];
  for (const glob of patterns) {
    if (glob.pattern.startsWith("!")) continue;
    const absolute = await absoluteGlob(glob, file, root, resolve);
    if (absolute !== null) out.push(listingOf(absolute, root));
  }
  return out;
}

/** `folderListings` of the source on disk; none when it cannot be read (a module served by a plugin). */
export async function folderListingsOnDisk(
  file: AbsolutePath,
  root: AbsolutePath,
  resolve: GlobResolver,
): Promise<FolderListing[]> {
  let source: string;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  return folderListings(file, source, root, resolve);
}

/** Listings per transform object: a re-transform reads the source again. */
const listed = new WeakMap<object, Promise<FolderListing[]>>();

/**
 * The adapter's report (`RunnerClosure.globs`): each walked project file of
 * `graph` with a transform whose globs list a project folder. Read once per
 * transform; a folder outside the worktree or in `node_modules` is left out.
 */
export async function moduleGlobs(
  project: TestProject,
  graph: ImportClosure,
  paths: WorktreePaths,
): Promise<ModuleGlobs[]> {
  const environment = project.vite.environments.ssr;
  if (!environment) return [];
  const root = project.config.root;
  const resolve: GlobResolver = async (pattern, importer) => {
    const custom = { "vite:import-glob": { isSubImportsPattern: pattern.startsWith("#") } };
    return (await environment.pluginContainer.resolveId(pattern, importer, { custom }))?.id ?? null;
  };
  const out: ModuleGlobs[] = [];
  for (const file of graph.edges?.keys() ?? []) {
    const path = paths.isProjectFile(file) ? paths.toRelative(file) : null;
    const transform = environment.moduleGraph.getModuleById(file)?.transformResult;
    if (path === null || !transform) continue;
    let listings = listed.get(transform);
    if (listings === undefined) {
      listings = folderListingsOnDisk(file, root, resolve);
      listed.set(transform, listings);
    }
    const directories = new Set<RelativePath>();
    const recursive = new Set<RelativePath>();
    for (const listing of await listings) {
      const directory = paths.isProjectFile(listing.directory)
        ? paths.toRelative(listing.directory)
        : null;
      if (directory === null) continue;
      directories.add(directory);
      if (listing.recursive) recursive.add(directory);
    }
    if (directories.size > 0) {
      out.push({
        path,
        directories: [...directories].sort(compare),
        recursive: [...recursive].sort(compare),
      });
    }
  }
  return out.sort((a, b) => compare(a.path, b.path));
}

async function absoluteGlob(
  glob: GlobPattern,
  importer: AbsolutePath,
  root: AbsolutePath,
  resolve: GlobResolver,
): Promise<string | null> {
  const { pattern, base } = glob;
  if (pattern.startsWith("**")) return posix.join(root, pattern);
  let dir = dirname(importer);
  if (base !== undefined)
    dir = base.startsWith("/") ? posix.join(root, base) : posix.resolve(dir, base);
  if (pattern.startsWith("/")) return posix.join(root, pattern.slice(1));
  if (pattern.startsWith("./")) return posix.join(dir, pattern.slice(2));
  if (pattern.startsWith("../")) return posix.join(dir, pattern);
  let resolved: string | null;
  try {
    resolved = await resolve(pattern, importer);
  } catch {
    return null;
  }
  // Vite throws for a glob that resolves to no absolute path: the module fails to transform.
  return resolved?.startsWith("/") ? resolved : null;
}

/** The static folder of an absolute glob, and whether the rest reaches below it. */
function listingOf(glob: string, root: AbsolutePath): FolderListing {
  const segments = glob.split("/");
  const at = segments.findIndex((segment) => MAGIC.test(segment));
  if (at < 0) {
    // No pattern at all: Vite lists the named file's folder (`getCommonBase`).
    return { directory: posix.dirname(glob) || root, recursive: false };
  }
  const directory = segments.slice(0, at).join("/") || "/";
  const rest = segments.slice(at).join("/");
  return { directory, recursive: rest.includes("/") || rest.includes("**") };
}

function isGlobCall(node: Node): node is Node & { arguments: Node[] } {
  if (node.type !== "CallExpression") return false;
  const callee = (node as Node & { callee: Node }).callee as Node & {
    object?: Node & { meta?: { name: string }; property?: { name: string } };
    property?: Node & { name?: string };
    computed?: boolean;
  };
  return (
    callee.type === "MemberExpression" &&
    callee.computed !== true &&
    callee.property?.name === "glob" &&
    callee.object?.type === "MetaProperty" &&
    callee.object.meta?.name === "import"
  );
}

/** The literal patterns of one `import.meta.glob` call and its `base`; Vite accepts nothing else. */
function globCall(node: Node & { arguments: Node[] }): GlobPattern[] {
  const [first, options] = node.arguments;
  const elements =
    first?.type === "ArrayExpression" ? (first as Node & { elements: Node[] }).elements : [first];
  const base = options === undefined ? undefined : baseOption(options);
  return elements.flatMap((element) => {
    const text = literalText(element);
    return text === null ? [] : [{ pattern: text, ...(base === undefined ? {} : { base }) }];
  });
}

function baseOption(node: Node): string | undefined {
  if (node.type !== "ObjectExpression") return undefined;
  for (const property of (node as Node & { properties: Node[] }).properties) {
    const { key, value } = property as Node & {
      key?: Node & { name?: string; value?: unknown };
      value?: Node;
    };
    const name = key?.type === "Identifier" ? key.name : key?.value;
    if (name === "base" && value !== undefined) return literalText(value) ?? undefined;
  }
  return undefined;
}

/** A string literal, or a template with no substitution. */
function literalText(node: Node | undefined | null): string | null {
  if (node === undefined || node === null) return null;
  if (node.type === "Literal") {
    const value = (node as Node & { value: unknown }).value;
    return typeof value === "string" ? value : null;
  }
  if (node.type === "TemplateLiteral") {
    const template = node as TemplateLiteral;
    return template.expressions.length === 0 ? (template.quasis[0]?.value.raw ?? null) : null;
  }
  return null;
}

/**
 * Vite's `dynamicImportToGlob` for a template literal: each substitution a
 * `*`, `**` collapsed; `null` for one Vite leaves alone (no substitution, a
 * `data:` or `http:` URL) or rejects (no extension, a bare start).
 */
export function templateGlob(node: TemplateLiteral): string | null {
  if (node.expressions.length === 0) return null;
  const glob = node.quasis
    .map((q) => q.value.raw)
    .join("*")
    .replace(/\*\*+/g, "*");
  if (/^(?:data|https?):/.test(glob)) return null;
  if (glob.startsWith("*") || posix.extname(glob) === "") return null;
  return glob;
}

function parseModule(source: string, typescript: boolean): Program | null {
  let code = source;
  if (typescript) {
    try {
      code = quietly(() => stripTypeScriptTypes(source, { mode: "strip" }));
    } catch {
      return null;
    }
  }
  for (const sourceType of ["module", "script"] as const) {
    try {
      return parse(code, { ecmaVersion: "latest", sourceType, allowHashBang: true });
    } catch {
      // A CommonJS file can fail as a module; try it as a script.
    }
  }
  return null;
}

function walk(node: unknown, visit: (node: Node) => void): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  const record = node as Record<string, unknown>;
  if (typeof record.type === "string") visit(node as Node);
  for (const [key, value] of Object.entries(record)) {
    if (key !== "type" && typeof value === "object") walk(value, visit);
  }
}

/** `stripTypeScriptTypes` with its once-per-process `ExperimentalWarning` dropped (as node:test's `enumerate`). */
function quietly<T>(strip: () => T): T {
  const emit = process.emitWarning;
  process.emitWarning = function (this: NodeJS.Process, warning, ...rest: unknown[]) {
    const text = typeof warning === "string" ? warning : warning.message;
    if (text.includes("stripTypeScriptTypes")) return;
    return Reflect.apply(emit, this, [warning, ...rest]);
  } as typeof process.emitWarning;
  try {
    return strip();
  } finally {
    process.emitWarning = emit;
  }
}
