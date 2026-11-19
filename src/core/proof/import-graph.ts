import { extname, posix } from "node:path";
import type { RelativePath } from "../types/common.js";

/*
 * Spec 023 D5.2 as amended 2026-11-19 (the human, "A: stop when unsure";
 * row 023-21, `reviews/wave-14-rereview.md` B1): what a file imports, read
 * from its text, and whether it reaches a test API directly or through
 * local imports (a local barrel that re-exports `it` and `expect` from
 * vitest included). Only local specifiers are followed: relative ones in
 * JavaScript and TypeScript; relative and package-path modules in Python.
 * Path aliases (tsconfig `paths`, package `imports`) are not resolved: a
 * file reached only through one is not followed.
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
/** `from "x"`, `import "x"`, `import("x")`, `require("x")`, `export ... from "x"`. */
const JS_SPECIFIER = /\b(?:from|import|require)\s*\(?\s*["']([^"'\n]+)["']/g;
/** `import a.b, c as d` at a line's start. */
const PY_IMPORT = /^[ \t]*import[ \t]+([^\n#]+)/gm;
/** `from .a.b import x, y` at a line's start. */
const PY_FROM = /^[ \t]*from[ \t]+(\.*[A-Za-z0-9_.]*)[ \t]+import[ \t]+\(?([^\n#)]*)/gm;

const isJs = (path: string) => JS_EXTENSIONS.includes(extname(path));

/** Each module specifier `text` names, by `path`'s language; Python's `from . import x` as `.x`. */
export function specifiersOf(path: RelativePath, text: string): string[] {
  if (isJs(path)) return [...text.matchAll(JS_SPECIFIER)].flatMap(([, s]) => (s ? [s] : []));
  if (extname(path) !== ".py") return [];
  const out: string[] = [];
  for (const [, names] of text.matchAll(PY_IMPORT))
    for (const name of (names ?? "").split(",")) out.push(name.trim().split(/\s+/)[0] ?? "");
  for (const [, module, names] of text.matchAll(PY_FROM)) {
    if (module === undefined) continue;
    out.push(module);
    if (/^\.+$/.test(module))
      for (const name of (names ?? "").split(","))
        out.push(`${module}${name.trim().split(/\s+/)[0] ?? ""}`);
  }
  return out.filter((s) => s !== "");
}

/** The first test API `text` imports itself; `null` for none. */
export function testApiOf(path: RelativePath, text: string): string | null {
  for (const specifier of specifiersOf(path, text)) {
    if (isJs(path) && JS_TEST_APIS.some((api) => isModule(specifier, api))) return specifier;
    if (!isJs(path) && PY_TEST_APIS.includes(specifier.split(".")[0] ?? "")) return specifier;
  }
  return null;
}

/** `specifier` is module `api` or a subpath of it (`api` ending in `/` is a scope). */
function isModule(specifier: string, api: string): boolean {
  return api.endsWith("/")
    ? specifier.startsWith(api)
    : specifier === api || specifier.startsWith(`${api}/`);
}

/** The repository file a local `specifier` in `from` names, by `has`; `null` for a package or none. */
export function resolveLocal(
  from: RelativePath,
  specifier: string,
  has: (path: RelativePath) => boolean,
): RelativePath | null {
  const found = (candidates: readonly string[]) =>
    candidates.find((c) => !c.startsWith("..") && has(c)) ?? null;
  const dir = posix.dirname(from);
  if (isJs(from)) {
    if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;
    const base = posix.normalize(posix.join(dir, specifier));
    const stem = base.replace(/\.(m|c)?jsx?$/, "");
    return found([
      base,
      ...JS_EXTENSIONS.map((ext) => `${stem}${ext}`),
      ...JS_EXTENSIONS.map((ext) => `${base}/index${ext}`),
    ]);
  }
  const dots = /^\.*/.exec(specifier)?.[0].length ?? 0;
  const rest = specifier.slice(dots).replaceAll(".", "/");
  const roots =
    dots > 0 ? [[...Array(dots - 1)].reduce<string>((d) => posix.dirname(d), dir)] : ancestors(dir);
  return found(
    roots.flatMap((root) => {
      const base = posix.normalize(posix.join(root, rest));
      return rest === "" ? [`${base}/__init__.py`] : [`${base}.py`, `${base}/__init__.py`];
    }),
  );
}

/** `dir` and each folder above it, the root last: where a Python package path may start. */
function ancestors(dir: string): string[] {
  const out = [dir];
  while (out.at(-1) !== ".") out.push(posix.dirname(out.at(-1) ?? "."));
  return out;
}

/** One commit's files: whether it holds a path, and a path's text (`null` when it lacks it). */
export interface Tree {
  readonly commit: string;
  has(path: RelativePath): boolean;
  text(path: RelativePath): Promise<string | null>;
}

/** The most files one reach follows; past it the answer is `unknown`. */
export const REACH_LIMIT = 5_000;

/** A test API `path` reaches, and the local files it goes through (empty: it imports it itself). */
export type Reach =
  | { readonly api: string; readonly via: readonly RelativePath[] }
  | "none"
  | "unknown";

/** Whether `path` imports a test API itself or through local imports at `tree`'s commit. */
export async function reachesTestApi(path: RelativePath, tree: Tree): Promise<Reach> {
  const seen = new Set<RelativePath>([path]);
  const queue: { path: RelativePath; via: RelativePath[] }[] = [{ path, via: [] }];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const text = await tree.text(next.path);
    if (text === null) continue;
    const api = testApiOf(next.path, text);
    if (api !== null) return { api, via: next.via };
    for (const specifier of specifiersOf(next.path, text)) {
      const local = resolveLocal(next.path, specifier, (p) => tree.has(p));
      if (local === null || seen.has(local)) continue;
      if (seen.size >= REACH_LIMIT) return "unknown";
      seen.add(local);
      queue.push({ path: local, via: [...next.via, local] });
    }
  }
  return "none";
}
