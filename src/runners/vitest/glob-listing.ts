import { stripTypeScriptTypes } from "node:module";
import { dirname, posix } from "node:path";
import {
  type ArrayExpression,
  type Literal,
  type Node,
  type ObjectExpression,
  type Program,
  parse,
  type TemplateLiteral,
} from "acorn";
import type { TestProject } from "vitest/node";
import { compare } from "../../core/fs/compare.js";
import type { WorktreePaths } from "../../core/fs/worktree-paths.js";
import type { AbsolutePath, RelativePath } from "../../core/types/common.js";
import type { ModuleGlobs } from "../../core/types/runner.js";
import { quietly } from "../node-test/enumerate.js";
import { mayExpandFromDisk, readSource } from "./dynamic.js";
import type { ImportClosure } from "./graph.js";

/**
 * Row 023-13 (fix A, `023 research/glob-membership.md` 2): a folder a
 * module's `import.meta.glob` or template-literal `import()` lists on disk.
 * Its entry names join the key, so adding or removing a matching file moves
 * it at a restart, in another worktree and at a commit.
 */
export interface FolderListing {
  readonly directory: AbsolutePath;
  /** The pattern's rest past the folder holds `/` or `**`: every folder below is listed too. */
  readonly recursive: boolean;
}

/** One literal glob of a module, before it is resolved; `base` is `import.meta.glob`'s option. */
export interface GlobPattern {
  readonly pattern: string;
  readonly base?: string;
}

/** Resolves a non-relative glob as Vite's `resolveId` does (aliases, `#` subpaths); `null`: nothing does. */
export type GlobResolver = (pattern: string, importer: AbsolutePath) => Promise<string | null>;

/** Characters that make a path segment a pattern (picomatch's `scan`). */
const MAGIC = /[*?[\]{}()!+@]/;

/** Source files acorn reads, TypeScript after Node strips its types; others fall back. */
const PARSED = /\.[mc]?[jt]s$/;

/**
 * The literal globs of `source`, read from its syntax tree: glob text in a
 * comment or a string gives none. `null` when the file does not parse here
 * (JSX, a framework file, TypeScript that strip mode refuses).
 */
export function globPatterns(file: string, source: string): GlobPattern[] | null {
  if (!mayExpandFromDisk(source)) return [];
  const program = PARSED.test(file) ? parseModule(source, /\.[mc]?ts$/.test(file)) : null;
  if (program === null) return null;
  const out: GlobPattern[] = [];
  walk(program, (node) => {
    if (isGlobCall(node)) out.push(...globCall(node.arguments));
    const imported = node.type === "ImportExpression" ? (node as { source?: Node }).source : null;
    const pattern =
      imported?.type === "TemplateLiteral" ? templateGlob(imported as TemplateLiteral) : null;
    if (pattern !== null) out.push({ pattern });
  });
  return out;
}

/**
 * The folders `file`'s globs list, each resolved as Vite does
 * (`toAbsoluteGlob`, then `getCommonBase` of that pattern): `./` and `../`
 * from the importer or a `base`, `/` from the Vite `root`, others through
 * `resolve`. A file that does not parse here lists its own folder,
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
  for (const glob of patterns.filter((g) => !g.pattern.startsWith("!"))) {
    const absolute = await absoluteGlob(glob, file, root, resolve);
    if (absolute !== null) out.push(listingOf(absolute));
  }
  return out;
}

/** Listings per transform object: a re-transform reads the source again. */
const listed = new WeakMap<object, Promise<FolderListing[]>>();

/**
 * The adapter's report (`RunnerClosure.globs`): each walked project file of
 * `graph` with a transform, and the project folders its globs list. Read
 * once per transform; a module with no source on disk, or a folder outside
 * the worktree or in `node_modules`, gives none.
 */
export async function moduleGlobs(
  project: TestProject,
  graph: ImportClosure,
  paths: WorktreePaths,
): Promise<ModuleGlobs[]> {
  const environment = project.vite.environments.ssr;
  const root = project.config.root;
  const resolve: GlobResolver = async (pattern, importer) => {
    const custom = { "vite:import-glob": { isSubImportsPattern: pattern.startsWith("#") } };
    return (
      (await environment?.pluginContainer.resolveId(pattern, importer, { custom }))?.id ?? null
    );
  };
  const out: ModuleGlobs[] = [];
  for (const file of graph.edges?.keys() ?? []) {
    const path = paths.isProjectFile(file) ? paths.toRelative(file) : null;
    const transform = environment?.moduleGraph.getModuleById(file)?.transformResult;
    if (path === null || !transform) continue;
    const listings = listed.get(transform) ?? listingsOnDisk(file, root, resolve);
    listed.set(transform, listings);
    const directories = new Set<RelativePath>();
    const recursive = new Set<RelativePath>();
    for (const listing of await listings) {
      const at = paths.isProjectFile(listing.directory)
        ? paths.toRelative(listing.directory)
        : null;
      if (at !== null) directories.add(at);
      if (at !== null && listing.recursive) recursive.add(at);
    }
    const sorted = (set: Set<RelativePath>) => [...set].sort(compare);
    if (directories.size > 0)
      out.push({ path, directories: sorted(directories), recursive: sorted(recursive) });
  }
  return out;
}

function listingsOnDisk(file: AbsolutePath, root: AbsolutePath, resolve: GlobResolver) {
  const source = readSource(file);
  return source === null ? Promise.resolve([]) : folderListings(file, source, root, resolve);
}

async function absoluteGlob(
  glob: GlobPattern,
  importer: AbsolutePath,
  root: AbsolutePath,
  resolve: GlobResolver,
): Promise<string | null> {
  const { pattern, base } = glob;
  const from = base?.startsWith("/")
    ? posix.join(root, base)
    : posix.resolve(dirname(importer), base ?? ".");
  if (pattern.startsWith("/")) return posix.join(root, pattern.slice(1));
  if (pattern.startsWith("./") || pattern.startsWith("../")) return posix.join(from, pattern);
  // Vite throws for a glob nothing resolves to an absolute path: the module fails to transform.
  const resolved = await resolve(pattern, importer).catch(() => null);
  return resolved?.startsWith("/") ? resolved : null;
}

/** The static folder of an absolute glob; a glob with no pattern lists its file's folder. */
function listingOf(glob: string): FolderListing {
  const segments = glob.split("/");
  const at = segments.findIndex((segment) => MAGIC.test(segment));
  const rest = at < 0 ? "" : segments.slice(at).join("/");
  const directory = at < 0 ? posix.dirname(glob) : segments.slice(0, at).join("/") || "/";
  return { directory, recursive: rest.includes("/") || rest.includes("**") };
}

function isGlobCall(node: Node): node is Node & { arguments: Node[] } {
  const callee = (node as { callee?: Node & { object?: Node; property?: Node } }).callee;
  const meta = callee?.object as (Node & { meta?: { name: string } }) | undefined;
  const property = callee?.property as (Node & { name?: string }) | undefined;
  return (
    node.type === "CallExpression" &&
    callee?.type === "MemberExpression" &&
    (callee as { computed?: boolean }).computed !== true &&
    property?.name === "glob" &&
    meta?.type === "MetaProperty" &&
    meta.meta?.name === "import"
  );
}

/** The literal patterns of one `import.meta.glob` call, with its `base`: Vite accepts nothing else. */
function globCall([first, options]: Node[]): GlobPattern[] {
  const elements =
    first?.type === "ArrayExpression" ? (first as ArrayExpression).elements : [first];
  const properties =
    options?.type === "ObjectExpression" ? (options as ObjectExpression).properties : [];
  const named = properties.find((p) => keyName(p) === "base") as { value?: Node } | undefined;
  const base = literalText(named?.value);
  return elements.flatMap((element) => {
    const pattern = literalText(element);
    return pattern === null ? [] : [base === null ? { pattern } : { pattern, base }];
  });
}

function keyName(property: Node): unknown {
  const key = (property as { key?: Node & { name?: string; value?: unknown } }).key;
  return key?.type === "Identifier" ? key.name : key?.value;
}

/** A string literal, or a template with no substitution; `null` for anything else. */
function literalText(node: Node | null | undefined): string | null {
  const value = node?.type === "Literal" ? (node as Literal).value : null;
  const template = node?.type === "TemplateLiteral" ? (node as TemplateLiteral) : null;
  const raw = template?.expressions.length === 0 ? template.quasis[0]?.value.raw : value;
  return typeof raw === "string" ? raw : null;
}

/**
 * Vite's `dynamicImportToGlob` for a template literal: each substitution a
 * `*`, `**` collapsed; `null` where Vite leaves the import alone (no
 * substitution, a `data:` or `http:` URL) or rejects it (no extension, a `*`
 * start).
 */
function templateGlob(node: TemplateLiteral): string | null {
  const glob = node.quasis
    .map((q) => q.value.raw)
    .join("*")
    .replace(/\*\*+/g, "*");
  const kept = node.expressions.length > 0 && !/^(?:data|https?):/.test(glob);
  return kept && !glob.startsWith("*") && posix.extname(glob) !== "" ? glob : null;
}

function parseModule(source: string, typescript: boolean): Program | null {
  try {
    const code = typescript
      ? quietly(() => stripTypeScriptTypes(source, { mode: "strip" }))
      : source;
    return parse(code, { ecmaVersion: "latest", sourceType: "module", allowHashBang: true });
  } catch {
    return null;
  }
}

function walk(node: unknown, visit: (node: Node & { arguments: Node[] }) => void): void {
  if (Array.isArray(node)) for (const item of node) walk(item, visit);
  if (node === null || typeof node !== "object" || Array.isArray(node)) return;
  const record = node as Record<string, unknown>;
  if (typeof record.type === "string") visit(node as Node & { arguments: Node[] });
  for (const [key, value] of Object.entries(record)) if (key !== "type") walk(value, visit);
}
