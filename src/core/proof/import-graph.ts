import { isBuiltin } from "node:module";
import { extname, posix } from "node:path";
import { codeAt } from "../../runners/node-test/graph/code-ranges.js";
import { packageName } from "../../runners/node-test/graph/packages.js";
import { PARSED_EXTENSION, parseModule, parserReady } from "../../runners/node-test/graph/parse.js";
import { parsePython } from "../../runners/pytest/graph/parse.js";
import { stdlibNames } from "../../runners/pytest/graph/stdlib-names.js";
import { pythonParserReady } from "../../runners/python/parser.js";
import type { RelativePath } from "../types/common.js";

/*
 * Spec 023 D5.2 as amended 2026-11-19 (the human, "A: stop when unsure";
 * row 023-21, `reviews/wave-14-third.md` 1 and 2): what a file at one
 * commit imports, and whether it reaches a test API directly or through
 * local imports. Imports are read by Squeal's own parsers, never by text
 * search: es-module-lexer through the node:test graph's `parseModule`
 * (its literal `require` calls kept only where `codeAt` says they are
 * code), and tree-sitter-python through the pytest graph's `parsePython`.
 * A comment or a string literal names nothing. Every import must be
 * accounted for: a local file it resolves to (followed), a builtin, a test
 * API, or a package a `package.json` declares (JavaScript) or one that is
 * no local module (Python). Anything else, an alias (`#api`, tsconfig
 * `paths`), a computed import or a source that does not parse, makes the
 * answer `unknown`: the file gives no evidence that it is not test code.
 */

/**
 * The test APIs of Squeal's runners and the libraries commonly run under
 * them: Vitest, node:test and pytest themselves, then `expect` libraries,
 * Playwright Test, Jest's globals, Testing Library and `unittest`.
 */
const JS_TEST_APIS = [
  "vitest",
  "@vitest/",
  "node:test",
  "@playwright/test",
  "@jest/globals",
  "chai",
  "sinon",
  "@testing-library/",
];
const PY_TEST_APIS = ["pytest", "_pytest", "unittest"];

const JS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
/** A literal `require("x")`, as the node:test graph's scan has it. */
const REQUIRE = /\brequire\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g;
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

/** One commit's files: whether it holds a path, its paths, and a path's text. */
export interface Tree {
  readonly commit: string;
  has(path: RelativePath): boolean;
  paths(): readonly RelativePath[];
  text(path: RelativePath): Promise<string | null>;
}

/** What one file imports, each import accounted for. */
export interface FileImports {
  /** Local files its imports resolve to. */
  readonly local: readonly RelativePath[];
  /** Test APIs it imports itself. */
  readonly tests: readonly string[];
  /** Why an import is not accounted for: `could not resolve <specifier> in <file>`. */
  readonly unresolved: readonly string[];
}

const NONE: FileImports = { local: [], tests: [], unresolved: [] };

/** `path`'s imports at `tree`'s commit; a file of another language (JSON, text) imports nothing. */
export async function importsIn(path: RelativePath, tree: Tree): Promise<FileImports> {
  const text = await tree.text(path);
  if (text === null) return NONE;
  if (PARSED_EXTENSION.test(path)) {
    await parserReady;
    return jsImports(path, text, tree);
  }
  if (extname(path) === ".py") {
    await pythonParserReady();
    return pyImports(path, text, tree);
  }
  return NONE;
}

/** The import specifiers of a JavaScript or TypeScript source, comments and strings left out. */
export function jsSpecifiers(path: RelativePath, text: string): string[] | { computed: string } {
  const parsed = parseModule(text, path);
  if (parsed.unnamed) return { computed: parsed.incomplete[0] ?? `a computed import in ${path}` };
  const code = codeAt(text);
  const requires = [...text.matchAll(REQUIRE)]
    .filter((match) => code(match.index))
    .flatMap((match) => (match[2] === undefined ? [] : [match[2]]));
  return [
    ...parsed.specifiers.filter((s) => s.kind !== "require").map((s) => s.specifier),
    ...requires,
  ];
}

async function jsImports(path: RelativePath, text: string, tree: Tree): Promise<FileImports> {
  const specifiers = jsSpecifiers(path, text);
  if (!Array.isArray(specifiers)) return { ...NONE, unresolved: [specifiers.computed] };
  const local: RelativePath[] = [];
  const tests: string[] = [];
  const unresolved: string[] = [];
  for (const specifier of specifiers) {
    if (JS_TEST_APIS.some((api) => isModule(specifier, api))) tests.push(specifier);
    else if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const found = resolveJs(path, specifier, tree);
      if (found === null) unresolved.push(notResolved(specifier, path));
      else local.push(found);
    } else if (!isBuiltin(specifier) && !(await declared(path, specifier, tree)))
      unresolved.push(notResolved(specifier, path));
  }
  return { local, tests, unresolved };
}

const notResolved = (specifier: string, path: RelativePath) =>
  `could not resolve ${specifier} in ${path}`;

/** `specifier` is module `api` or a subpath of it (`api` ending in `/` is a scope). */
function isModule(specifier: string, api: string): boolean {
  return api.endsWith("/")
    ? specifier.startsWith(api)
    : specifier === api || specifier.startsWith(`${api}/`);
}

/** The repository file a relative `specifier` in `from` names: extension, `.js` as `.ts`, `index`. */
export function resolveJs(from: RelativePath, specifier: string, tree: Tree): RelativePath | null {
  const base = posix.normalize(posix.join(posix.dirname(from), specifier));
  if (base.startsWith("..")) return null;
  const stem = base.replace(/\.(m|c)?jsx?$/, "");
  const candidates = [
    base,
    ...JS_EXTENSIONS.map((ext) => `${stem}${ext}`),
    ...JS_EXTENSIONS.map((ext) => `${base}/index${ext}`),
  ];
  return candidates.find((c) => tree.has(c)) ?? null;
}

/**
 * Whether a bare `specifier` names a package the nearest `package.json`
 * above `from`, or the root one, declares; never the package itself (a
 * self-reference resolves through its `exports`, which is not read).
 */
async function declared(from: RelativePath, specifier: string, tree: Tree): Promise<boolean> {
  const name = packageName(specifier);
  if (name === null) return false;
  const manifests = [...folders(posix.dirname(from)).map((d) => posix.join(d, "package.json"))];
  const nearest = manifests.find((m) => tree.has(m));
  for (const manifest of new Set([nearest, "package.json"])) {
    if (manifest === undefined) continue;
    const json = await manifestOf(manifest, tree);
    if (json?.name === name) return false;
    if (DEPENDENCY_FIELDS.some((field) => isDeclared(json?.[field], name))) return true;
  }
  return false;
}

function isDeclared(field: unknown, name: string): boolean {
  return typeof field === "object" && field !== null && Object.hasOwn(field, name);
}

async function manifestOf(path: RelativePath, tree: Tree): Promise<Record<string, unknown> | null> {
  try {
    const value = JSON.parse((await tree.text(path)) ?? "null") as unknown;
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** `dir` and each folder above it, the root (`.`) last. */
function folders(dir: string): string[] {
  const out = [dir];
  while (out.at(-1) !== ".") out.push(posix.dirname(out.at(-1) ?? "."));
  return out;
}

function pyImports(path: RelativePath, text: string, tree: Tree): FileImports {
  const parsed = parsePython(text);
  if (parsed.errorLine !== null)
    return { ...NONE, unresolved: [`${path} does not parse at line ${parsed.errorLine}`] };
  if (parsed.computed.length > 0)
    return {
      ...NONE,
      unresolved: [`a computed import in ${path} at line ${parsed.computed[0]}`],
    };
  const local: RelativePath[] = [];
  const tests: string[] = [];
  const unresolved: string[] = [];
  for (const imp of parsed.imports) {
    const top = imp.module.split(".")[0] ?? "";
    if (imp.level === 0 && PY_TEST_APIS.includes(top)) {
      tests.push(imp.module);
      continue;
    }
    const found = resolvePy(path, imp.module, imp.level, imp.names, tree);
    const shown = `${".".repeat(imp.level)}${imp.module}`;
    if (found.length > 0) local.push(...found);
    // Not found: relative, or a local module's name, is unresolved; else the stdlib or a package.
    else if (imp.level > 0 || (!stdlibNames(null).has(top) && localModules(tree).has(top)))
      unresolved.push(notResolved(shown, path));
  }
  return { local, tests, unresolved };
}

/**
 * The repository files a Python import names: the module from the file's
 * package (relative) or from its folder and each one above (absolute),
 * and each `from` name that is a submodule there.
 */
export function resolvePy(
  from: RelativePath,
  module: string,
  level: number,
  names: readonly string[],
  tree: Tree,
): RelativePath[] {
  let dir = posix.dirname(from);
  for (let i = 1; i < level; i++) dir = posix.dirname(dir);
  const roots = level > 0 ? [dir] : folders(dir);
  const rest = module.replaceAll(".", "/");
  for (const root of roots) {
    const base = posix.normalize(posix.join(root, rest));
    if (base.startsWith("..")) continue;
    const file = rest === "" ? null : [`${base}.py`].find((c) => tree.has(c));
    const init = `${base}/__init__.py`;
    const pkg = tree.has(init) ? init : null;
    const subs = names.flatMap((n) =>
      [`${base}/${n}.py`, `${base}/${n}/__init__.py`].filter((c) => tree.has(c)),
    );
    const found = [file, pkg, ...subs].filter((c): c is string => c !== null && c !== undefined);
    if (found.length > 0) return found;
  }
  return [];
}

const localCache = new WeakMap<Tree, ReadonlySet<string>>();

/** Every name a local Python module or package has, anywhere in the tree. */
function localModules(tree: Tree): ReadonlySet<string> {
  let names = localCache.get(tree);
  if (names === undefined) {
    const out = new Set<string>();
    for (const path of tree.paths()) {
      if (!path.endsWith(".py")) continue;
      const parts = path.split("/");
      const file = (parts.pop() ?? "").replace(/\.py$/, "");
      if (file === "__init__") {
        const pkg = parts.at(-1);
        if (pkg !== undefined) out.add(pkg);
      } else out.add(file);
    }
    names = out;
    localCache.set(tree, names);
  }
  return names;
}

/** The most files one reach follows; past it the answer is `unknown`. */
export const REACH_LIMIT = 5_000;

/** A test API `path` reaches with the files it goes through; or none, or unknown with why. */
export type Reach =
  | { readonly api: string; readonly via: readonly RelativePath[] }
  | "none"
  | { readonly unknown: string };

/**
 * Whether `path` imports a test API itself or through local imports at
 * `tree`'s commit. A test API found anywhere answers; otherwise any import
 * not accounted for makes the answer `unknown`.
 */
export async function reachesTestApi(path: RelativePath, tree: Tree): Promise<Reach> {
  const seen = new Set<RelativePath>([path]);
  const queue: { path: RelativePath; via: RelativePath[] }[] = [{ path, via: [] }];
  let unknown: string | null = null;
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const imports = await importsIn(next.path, tree);
    const api = imports.tests[0];
    if (api !== undefined) return { api, via: next.via };
    unknown ??= imports.unresolved[0] ?? null;
    for (const local of imports.local) {
      if (seen.has(local)) continue;
      if (seen.size >= REACH_LIMIT) {
        unknown ??= `more than ${REACH_LIMIT} local imports to follow from ${path}`;
        continue;
      }
      seen.add(local);
      queue.push({ path: local, via: [...next.via, local] });
    }
  }
  return unknown === null ? "none" : { unknown };
}
