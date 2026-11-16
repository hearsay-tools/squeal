import { dirname, extname, posix } from "node:path";
import type { TestProject } from "vitest/node";
import { compare } from "../../core/fs/compare.js";
import type { WorktreePaths } from "../../core/fs/worktree-paths.js";
import type { AbsolutePath, RelativePath } from "../../core/types/common.js";
import type { ModuleGlobs } from "../../core/types/runner.js";
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

/**
 * The project's own Vite parser, `parseAst` of `vitest/node` (reviews/wave-2.md
 * B2): Vite 8's reads TypeScript, enums, decorators, JSX and TSX by `lang`;
 * an older Vite's reads JavaScript and throws on the rest.
 */
export type ParseAst = (source: string, options: { lang: Lang }, file: string) => unknown;

type Lang = "js" | "jsx" | "ts" | "tsx";

/** A syntax node as the parser gives it: ESTree, read field by field. */
type Node = { readonly type?: unknown } & Readonly<Record<string, unknown>>;

/** The languages Vite parses a script in, by extension; any other file is not read. */
const LANGS: Readonly<Record<string, Lang>> = {
  ".js": "js",
  ".mjs": "js",
  ".cjs": "js",
  ".jsx": "jsx",
  ".ts": "ts",
  ".mts": "ts",
  ".cts": "ts",
  ".tsx": "tsx",
};

/** Characters that make a path segment a pattern (picomatch's `scan`). */
const MAGIC = /[*?[\]{}()!+@]/;

/**
 * The literal globs of `source`, read from its syntax tree: glob text in a
 * comment or a string gives none. `null` when the module cannot be read
 * here: not a script by its extension, or a parse error.
 */
export async function globPatterns(
  file: string,
  source: string,
  parse: ParseAst,
): Promise<GlobPattern[] | null> {
  if (!mayExpandFromDisk(source)) return [];
  const lang = LANGS[extname(file)];
  const parsing = Promise.resolve(lang).then((l) =>
    l === undefined ? null : parse(source, { lang: l }, file),
  );
  const program = await parsing.catch(() => null);
  if (program === null) return null;
  const out: GlobPattern[] = [];
  walk(program, (node) => {
    if (isGlobCall(node)) out.push(...globCall(node.arguments as Node[]));
    const imported = node.type === "ImportExpression" ? (node.source as Node) : null;
    const pattern = imported?.type === "TemplateLiteral" ? templateGlob(imported) : null;
    if (pattern !== null) out.push({ pattern });
  });
  return out;
}

/**
 * The folders `file`'s globs list, each resolved as Vite does
 * (`toAbsoluteGlob`, then `getCommonBase` of that pattern): `./` and `../`
 * from the importer or a `base`, `/` from the Vite `root`, others through
 * `resolve`. `null` when the module cannot be read here: the caller then
 * lists every folder, so no key that lacks a matching file is reused.
 */
export async function folderListings(
  file: AbsolutePath,
  source: string,
  root: AbsolutePath,
  resolve: GlobResolver,
  parse: ParseAst,
): Promise<FolderListing[] | null> {
  const patterns = await globPatterns(file, source, parse);
  if (patterns === null) return null;
  const out: FolderListing[] = [];
  for (const glob of patterns.filter((g) => !g.pattern.startsWith("!"))) {
    const absolute = await absoluteGlob(glob, file, root, resolve);
    if (absolute !== null) out.push(listingOf(absolute));
  }
  return out;
}

/** Listings per transform object: a re-transform reads the source again. */
const listed = new WeakMap<object, Promise<FolderListing[] | null>>();

/**
 * The adapter's report (`RunnerClosure.globs`): each walked project file of
 * `graph` with a transform, and the project folders its globs list; the
 * worktree root is `""`. A module it cannot read lists the root recursively.
 * Read once per transform; a module with no source on disk, or a folder
 * outside the worktree or in `node_modules`, gives none.
 */
export async function moduleGlobs(
  project: TestProject,
  graph: ImportClosure,
  paths: WorktreePaths,
  parse: ParseAst,
): Promise<ModuleGlobs[]> {
  const environment = project.vite.environments.ssr;
  const root = project.config.root;
  const resolve: GlobResolver = async (pattern, importer) => {
    const custom = { "vite:import-glob": { isSubImportsPattern: pattern.startsWith("#") } };
    return (
      (await environment?.pluginContainer.resolveId(pattern, importer, { custom }))?.id ?? null
    );
  };
  const everything = [{ directory: paths.root, recursive: true }];
  const out: ModuleGlobs[] = [];
  for (const file of graph.edges?.keys() ?? []) {
    const path = paths.isProjectFile(file) ? paths.toRelative(file) : null;
    const transform = environment?.moduleGraph.getModuleById(file)?.transformResult;
    if (path === null || !transform) continue;
    const listings = listed.get(transform) ?? listingsOnDisk(file, root, resolve, parse);
    listed.set(transform, listings);
    const directories = new Set<RelativePath>();
    const recursive = new Set<RelativePath>();
    for (const listing of (await listings) ?? everything) {
      const at = folderOf(listing.directory, paths);
      if (at !== null) directories.add(at);
      if (at !== null && listing.recursive) recursive.add(at);
    }
    const sorted = (set: Set<RelativePath>) => [...set].sort(compare);
    if (directories.size > 0)
      out.push({ path, directories: sorted(directories), recursive: sorted(recursive) });
  }
  return out;
}

/** A project folder's path, `""` for the worktree root (review B1); `null` outside it or in `node_modules`. */
function folderOf(directory: AbsolutePath, paths: WorktreePaths): RelativePath | null {
  if (directory === paths.root) return "";
  return paths.isProjectFile(directory) ? paths.toRelative(directory) : null;
}

function listingsOnDisk(
  file: AbsolutePath,
  root: AbsolutePath,
  resolve: GlobResolver,
  parse: ParseAst,
): Promise<FolderListing[] | null> {
  const source = readSource(file);
  return source === null ? Promise.resolve([]) : folderListings(file, source, root, resolve, parse);
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

function isGlobCall(node: Node): boolean {
  const callee = node.callee as Node | undefined;
  const meta = callee?.object as Node | undefined;
  const property = callee?.property as Node | undefined;
  return (
    node.type === "CallExpression" &&
    callee?.type === "MemberExpression" &&
    callee.computed !== true &&
    property?.name === "glob" &&
    meta?.type === "MetaProperty" &&
    (meta.meta as Node | undefined)?.name === "import"
  );
}

/** The literal patterns of one `import.meta.glob` call, with its `base`: Vite accepts nothing else. */
function globCall([first, options]: Node[]): GlobPattern[] {
  const elements = first?.type === "ArrayExpression" ? (first.elements as Node[]) : [first];
  const properties = options?.type === "ObjectExpression" ? (options.properties as Node[]) : [];
  const named = properties.find((p) => keyName(p) === "base");
  const base = literalText(named?.value as Node | undefined);
  return elements.flatMap((element) => {
    const pattern = literalText(element);
    return pattern === null ? [] : [base === null ? { pattern } : { pattern, base }];
  });
}

function keyName(property: Node): unknown {
  const key = property.key as Node | undefined;
  return key?.type === "Identifier" ? key.name : key?.value;
}

/** A string literal, or a template with no substitution; `null` for anything else. */
function literalText(node: Node | null | undefined): string | null {
  const value = node?.type === "Literal" ? node.value : null;
  const quasis = node?.type === "TemplateLiteral" ? (node.quasis as Node[]) : [];
  const expressions = node?.type === "TemplateLiteral" ? (node.expressions as Node[]) : [];
  const raw = quasis.length === 1 && expressions.length === 0 ? rawOf(quasis[0]) : value;
  return typeof raw === "string" ? raw : null;
}

function rawOf(quasi: Node | undefined): unknown {
  return (quasi?.value as Node | undefined)?.raw;
}

/**
 * Vite's `dynamicImportToGlob` for a template literal: each substitution a
 * `*`, `**` collapsed; `null` where Vite leaves the import alone (no
 * substitution, a `data:` or `http:` URL) or rejects it (no extension, a `*`
 * start).
 */
function templateGlob(node: Node): string | null {
  const quasis = node.quasis as Node[];
  const glob = quasis
    .map((q) => String(rawOf(q)))
    .join("*")
    .replace(/\*\*+/g, "*");
  const kept = (node.expressions as Node[]).length > 0 && !/^(?:data|https?):/.test(glob);
  return kept && !glob.startsWith("*") && posix.extname(glob) !== "" ? glob : null;
}

function walk(node: unknown, visit: (node: Node) => void): void {
  if (Array.isArray(node)) for (const item of node) walk(item, visit);
  if (node === null || typeof node !== "object" || Array.isArray(node)) return;
  const record = node as Node;
  if (typeof record.type === "string") visit(record);
  for (const [key, value] of Object.entries(record)) if (key !== "type") walk(value, visit);
}
