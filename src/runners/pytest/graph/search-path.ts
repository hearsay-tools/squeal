import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AbsolutePath } from "../../../core/types/index.js";
import { importRoots } from "../environment/import-roots.js";
import type { MappedModule } from "../environment/index.js";
import { minorVersion, readOptional, readPyvenvCfg } from "../environment/site.js";
import { deriveRoots } from "./derive-roots.js";
import { stdlibNames } from "./stdlib-names.js";

/** pytest's `--import-mode` (runner-api F4). */
export type ImportMode = "prepend" | "append" | "importlib";

/**
 * One `sys.path` location: a directory, or the standard library's names
 * standing in for its directories. A `basedir` is one pytest inserts as it
 * imports a test file or conftest, so whether it is on the path yet, and
 * where, depends on the batch (review 007-16 B2).
 */
export type Location =
  | { readonly kind: "dir"; readonly dir: AbsolutePath; readonly basedir?: true }
  | { readonly kind: "stdlib"; readonly names: ReadonlySet<string> };

/** Spec 007 D4's `sys.path` model of one project, from files. */
export interface SearchPath {
  readonly locations: readonly Location[];
  /** Import-hook editables, consulted after the whole path. */
  readonly mapped: readonly MappedModule[];
  /** `environment` when `<env>/pyvenv.cfg` was read, `derived` from `pyproject.toml` otherwise. */
  readonly source: "environment" | "derived";
  readonly notes: readonly string[];
}

export interface SearchPathInputs {
  readonly root: AbsolutePath;
  /** pytest's working directory: `python -m pytest` puts it on the path. */
  readonly cwd: AbsolutePath;
  /** The environment directory D2 discovered, or `null`. */
  readonly env: AbsolutePath | null;
  readonly importMode: ImportMode;
  /** The pytest config's `pythonpath`, absolute, in order. */
  readonly pythonpath: readonly AbsolutePath[];
  /** Test files and conftests, absolute and sorted: each one's basedir under `prepend` and `append`. */
  readonly pytestModules: readonly AbsolutePath[];
}

/**
 * The search path pytest would see, in order (D4, module-graph Q1): the
 * basedirs `prepend` inserts, each at the front unless already present, and
 * marked, since a batch inserts them in its own order or not at all;
 * `pythonpath`; `cwd`; the standard library, always as the bundled names of
 * the environment's minor, or of the `.python-version` pin, or of every
 * measured minor, so a synced and an unsynced worktree resolve alike
 * (007-04); site-packages and the `.pth` paths with an environment, the
 * derived roots without one; `append`'s basedirs last.
 */
export function searchPath(inputs: SearchPathInputs): SearchPath {
  const cfg = inputs.env === null ? null : readPyvenvCfg(inputs.env);
  const env = inputs.env !== null && cfg !== null ? inputs.env : null;
  const stdlib: Location = { kind: "stdlib", names: stdlibNames(minorVersion(cfg) ?? pin(inputs)) };
  const tail: Location[] = [stdlib];
  let mapped: readonly MappedModule[];
  let notes: readonly string[] = [];
  if (env !== null) {
    const roots = importRoots(env);
    if (roots.sitePackages !== null) tail.push(dir(roots.sitePackages));
    tail.push(...roots.pthPaths.map(dir));
    mapped = roots.mapped;
  } else {
    const derived = deriveRoots(inputs.root);
    tail.push(...derived.pthPaths.map(dir));
    mapped = derived.mapped;
    notes = derived.notes;
  }
  const front: AbsolutePath[] = [];
  const known = new Set<AbsolutePath>([inputs.cwd]);
  const insert = (path: AbsolutePath) => {
    if (known.has(path)) return;
    known.add(path);
    front.unshift(path);
  };
  for (const path of inputs.pythonpath.toReversed()) insert(path);
  const basedirs = inputs.pytestModules.map(basedir);
  if (inputs.importMode === "prepend") for (const path of basedirs) insert(path);
  const inserted = new Set(inputs.importMode === "prepend" ? basedirs : []);
  const locations = [
    ...front.map((path) => (inserted.has(path) ? basedirLocation(path) : dir(path))),
    dir(inputs.cwd),
    ...tail,
  ];
  if (inputs.importMode === "append") {
    for (const path of basedirs) {
      if (known.has(path)) continue;
      known.add(path);
      locations.push(basedirLocation(path));
    }
  }
  return { locations, mapped, source: env === null ? "derived" : "environment", notes };
}

/** pytest's basedir of a module: the first directory upward without `__init__.py`. */
export function basedir(file: AbsolutePath): AbsolutePath {
  let at = dirname(file);
  while (existsSync(join(at, "__init__.py"))) at = dirname(at);
  return at;
}

const dir = (path: AbsolutePath): Location => ({ kind: "dir", dir: path });
const basedirLocation = (path: AbsolutePath): Location => ({
  kind: "dir",
  dir: path,
  basedir: true,
});

/** The minor a `.python-version` pin names at `cwd` or the worktree root. */
function pin(inputs: SearchPathInputs): string | null {
  for (const at of [inputs.cwd, inputs.root]) {
    const text = readOptional(join(at, ".python-version"));
    const match = text === null ? null : /^\s*(?:cpython-)?(\d+\.\d+)/m.exec(text);
    if (match) return match[1] as string;
  }
  return null;
}
