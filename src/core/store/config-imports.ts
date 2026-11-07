import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { compare } from "../fs/compare.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import type { FileImports } from "../types/runner.js";

/*
 * Spec 015 D11 (review 0.1.415 B3): the config walk's edges. A runner that
 * bundles its config (Vite, with Node's resolution and no aliases) lists
 * what it bundled; no transform walks those files. A relative import of a
 * listed file that names another listed file is an edge; other specifiers
 * name packages. A file that cannot be read has no entry, so no chain
 * passes it and its targets read not recorded.
 *
 * The specifiers are read with a scan, not es-module-lexer: this module
 * is in the hook bundles, which carry no package (`plugin.test.ts`). Config
 * files are short, and an edge here keys nothing: a spurious one needs a
 * relative specifier in a comment or string that names a listed file.
 */

const MODULE = /\.(?:[mc]?[jt]s|[jt]sx)$/;
const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"];

/** Block comments, and line comments not after a `:` (a URL's `//`). */
const COMMENTS = /\/\*[\s\S]*?\*\/|(^|[^:\\])\/\/[^\n]*/g;
/** `import ... from "x"`, `import "x"`, `export ... from "x"`; group 1 marks `import type`/`export type`. */
const STATIC =
  /(?:^|[;\s}])(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s*)?["']([^"'\n]+)["']/g;
/** `import("x")` with a literal specifier. */
const DYNAMIC = /\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)/g;

/** The specifiers of `source`, static apart from dynamic, without type-only ones. */
export function scanImports(source: string): { static: string[]; dynamic: string[] } {
  const code = source.replace(COMMENTS, "$1");
  const found = { static: [] as string[], dynamic: [] as string[] };
  for (const [, type, specifier] of code.matchAll(STATIC)) {
    if (type === undefined && specifier !== undefined) found.static.push(specifier);
  }
  for (const [, specifier] of code.matchAll(DYNAMIC)) {
    if (specifier !== undefined) found.dynamic.push(specifier);
  }
  return found;
}

/** The listed file a relative `specifier` of `from` names, as Node's resolution finds it; `null` for none. */
function listedTarget(
  from: RelativePath,
  specifier: string,
  listed: ReadonlySet<RelativePath>,
): RelativePath | null {
  if (!specifier.startsWith(".")) return null;
  const base = posix.normalize(posix.join(posix.dirname(from), specifier));
  const candidates = [
    base,
    base.replace(/\.([mc]?)js$/, ".$1ts"),
    ...EXTENSIONS.map((ext) => `${base}${ext}`),
    ...EXTENSIONS.map((ext) => posix.join(base, `index${ext}`)),
  ];
  return candidates.find((candidate) => listed.has(candidate)) ?? null;
}

/** The imports of each of `configs` that name another of them, by the bytes read now. */
export function configImports(root: AbsolutePath, configs: readonly RelativePath[]): FileImports[] {
  const listed = new Set(configs);
  const out: FileImports[] = [];
  for (const path of configs) {
    if (!MODULE.test(path)) continue;
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(root, path));
    } catch {
      continue;
    }
    const found = scanImports(bytes.toString("utf8"));
    const targets = (specifiers: readonly string[]) =>
      [...new Set(specifiers.flatMap((s) => listedTarget(path, s, listed) ?? []))].sort(compare);
    out.push({
      path,
      sha1: createHash("sha1").update(bytes).digest("hex"),
      static: targets(found.static),
      dynamic: targets(found.dynamic),
    });
  }
  return out;
}
