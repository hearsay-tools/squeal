import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AbsolutePath } from "../../../core/types/index.js";
import { pthFiles, readOptional, readPyvenvCfg, sitePackagesDir, stdlibDirs } from "./site.js";

/**
 * One module an import-hook editable maps to a path. setuptools' finder
 * maps a top-level name to a package directory (or a `.py` for a module);
 * `editables`, hatchling's exact mode, maps a name to its `__init__.py` or
 * `.py`. Both finders follow `PathFinder`, so a same-named module on the
 * path wins (module-graph Q1).
 */
export interface MappedModule {
  readonly module: string;
  readonly path: AbsolutePath;
  readonly finder: "setuptools" | "editables";
}

/**
 * Spec 007 D4's resolution inputs that come from the environment's files,
 * in `sys.path` order: the standard library, site-packages, then each
 * `.pth` path line in file-name order; and the import-hook editables'
 * literals, consulted after the whole path. The caller puts `cwd` (from
 * `-m`), `PYTHONPATH`, the pytest config's `pythonpath` and the import
 * mode's basedirs in front.
 */
export interface ImportRoots {
  readonly stdlib: readonly AbsolutePath[];
  readonly sitePackages: AbsolutePath | null;
  /** `.pth` path lines that exist, as `site` appends them: in order, once each. */
  readonly pthPaths: readonly AbsolutePath[];
  readonly mapped: readonly MappedModule[];
  /**
   * `include-system-site-packages = true`: the base interpreter's
   * site-packages also join the path. Not listed here; the interpreter's
   * real path in the environment hash stands for them.
   */
  readonly systemSitePackages: boolean;
}

/** Reads `ImportRoots` of an environment directory from files; never runs Python. */
export function importRoots(env: AbsolutePath): ImportRoots {
  const cfg = readPyvenvCfg(env);
  const site = sitePackagesDir(env);
  const pthPaths: AbsolutePath[] = [];
  const mapped: MappedModule[] = [];
  if (site !== null) {
    const known = new Set<AbsolutePath>([site]);
    for (const name of pthFiles(site)) {
      const lines = readPthLines(site, name);
      for (const path of lines.paths) {
        if (known.has(path) || !existsSync(path)) continue;
        known.add(path);
        pthPaths.push(path);
      }
      for (const module of lines.imports) mapped.push(...finderLiterals(site, module));
    }
  }
  return {
    stdlib: stdlibDirs(cfg),
    sitePackages: site,
    pthPaths,
    mapped,
    systemSitePackages: cfg?.["include-system-site-packages"]?.toLowerCase() === "true",
  };
}

/**
 * One `.pth` file as `site.addpackage` reads it: `#` lines and blank lines
 * are skipped, a line starting with `import ` or `import<TAB>` is executed,
 * every other line, right-stripped, is a path relative to the site
 * directory. Of an executed line, the module it imports first.
 */
function readPthLines(
  site: AbsolutePath,
  name: string,
): { readonly paths: readonly AbsolutePath[]; readonly imports: readonly string[] } {
  const paths: AbsolutePath[] = [];
  const imports: string[] = [];
  for (const line of (readOptional(join(site, name)) ?? "").split(/\r?\n/)) {
    if (line.startsWith("#") || line.trim() === "") continue;
    if (line.startsWith("import ") || line.startsWith("import\t")) {
      const module = /^import[ \t]+([A-Za-z_][\w]*)/.exec(line)?.[1];
      if (module !== undefined) imports.push(module);
      continue;
    }
    paths.push(resolve(site, line.trimEnd()));
  }
  return { paths, imports };
}

const STRING = String.raw`(['"])((?:\\.|(?!\1).)*)\1`;
/** setuptools: `MAPPING: dict[str, str] = {'spkg': '/abs/lib_src'}` on one line. */
const MAPPING = /^MAPPING\s*(?::[^=]*)?=\s*\{(.*)\}\s*$/m;
const PAIR = new RegExp(`${STRING}\\s*:\\s*${STRING.replaceAll("\\1", "\\3")}`, "g");
/** editables: `F.map_module('hpkg', '/abs/src/hpkg/__init__.py')`. */
const MAP_MODULE = new RegExp(
  `map_module\\(\\s*${STRING}\\s*,\\s*${STRING.replaceAll("\\1", "\\3")}\\s*\\)`,
  "g",
);

/** The finder literals of `<site>/<module>.py`, the module a `.pth` import line runs. */
function finderLiterals(site: AbsolutePath, module: string): readonly MappedModule[] {
  const text = readOptional(join(site, `${module}.py`));
  if (text === null) return [];
  const found: MappedModule[] = [];
  const mapping = MAPPING.exec(text)?.[1];
  if (mapping !== undefined) {
    for (const pair of mapping.matchAll(PAIR)) {
      found.push({
        module: unquote(pair[2] as string),
        path: unquote(pair[4] as string),
        finder: "setuptools",
      });
    }
  }
  for (const call of text.matchAll(MAP_MODULE)) {
    found.push({
      module: unquote(call[2] as string),
      path: unquote(call[4] as string),
      finder: "editables",
    });
  }
  return found;
}

/** The value of a Python string literal's body: `repr` escapes only backslashes and quotes in a path. */
function unquote(body: string): string {
  return body.replace(/\\(.)/g, "$1");
}
