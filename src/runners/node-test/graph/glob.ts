import { readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import type { AbsolutePath } from "../../../core/types/index.js";

/** `.js` in a template-literal `import()` may load `.ts` under tsx, as in a literal one. */
const ALIASED: Record<string, readonly string[]> = {
  ".js": [".ts", ".tsx", ".js"],
  ".mjs": [".mts", ".mjs"],
  ".cjs": [".cts", ".cjs"],
};

/**
 * The files a template-literal `import()` can load (spec 003 D3): its glob,
 * each `${...}` collapsed to `*` by the lexer, matched within one directory.
 * `null` when the glob cannot be expanded statically: a bare specifier or a
 * substitution in a directory segment.
 */
export function expandGlob(
  glob: string,
  importer: AbsolutePath,
  tsx: boolean,
): readonly AbsolutePath[] | null {
  if (!glob.startsWith("./") && !glob.startsWith("../")) return null;
  const pattern = resolve(dirname(importer), glob);
  const dir = dirname(pattern);
  if (dir.includes("*")) return null;
  const base = pattern.slice(dir.length + 1);
  const ext = extname(base);
  const stems =
    tsx && ALIASED[ext] ? ALIASED[ext].map((e) => base.slice(0, -ext.length) + e) : [base];
  const matchers = stems.map(
    (stem) => new RegExp(`^${stem.split("*").map(escapeRegExp).join("[^/]*")}$`),
  );
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((name) => matchers.some((m) => m.test(name))).map((name) => join(dir, name));
}

const escapeRegExp = (text: string) => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
