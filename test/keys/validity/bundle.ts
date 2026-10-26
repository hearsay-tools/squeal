import { existsSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { build, type Plugin } from "esbuild";
import { nodeFloor } from "../../../src/harness/build.js";
import { bundleOptions } from "../../../src/harness/claude-code/build.js";
import { observeMetafile } from "../../helpers/build-inputs.js";
import { COMPONENTS, FORMAT_FILE } from "./components.js";
import { type Overlay, packageOf, ROOT } from "./trees.js";

/*
 * A validity module bundled against one tree as the shipped bundles are
 * built (011 C3, task 011-37 sections 2 and 3): the shipped target, Node ESM,
 * the packages left as imports, no comments. The harness and the entries are
 * the candidate's; their imports of `src/` resolve into the tree under test,
 * so the same harness runs at both trees. Every component's version is held
 * at one value in both, so a raise does not hide an equal key and a bump
 * alone changes no emitted line.
 */

const VALIDITY = join(ROOT, "test/keys/validity");
const DRIVER = join(VALIDITY, "driver.ts");

/** The format version both bundles hold. */
export function pinFormat(text: string): string {
  return text.replace(/KEY_FORMAT_VERSION = \d+;/, "KEY_FORMAT_VERSION = 0;");
}

/** The tree-relative files that state a version. */
const VERSION_FILES = new Set(COMPONENTS.map((c) => c.version.path));

/** `text` of the tree-relative `path`, the version it states held at one value. */
function pinned(path: string, text: string): string {
  if (path === FORMAT_FILE) return pinFormat(text);
  const component = COMPONENTS.find((c) => c.version.path === path);
  if (component === undefined) return text;
  return text.replace(new RegExp(`(${component.version.constant} = )"[^"]*"`), '$1"0"');
}

export interface Bundle {
  /** The emitted code, esbuild's `// path` module markers blanked so trees at other paths compare alike. */
  readonly text: string;
  /** Its source map (version 3), `sources` absolute. */
  readonly map: SourceMap;
  /** The packages it imports, by name. */
  readonly packages: readonly string[];
  /** The tree's `src/` files it holds, tree-relative. */
  readonly inputs: ReadonlySet<string>;
}

export interface SourceMap {
  readonly sources: readonly string[];
  readonly sourcesContent?: readonly string[];
  readonly mappings: string;
}

const under = (path: string, dir: string) => path === dir || path.startsWith(`${dir}${sep}`);

/** `tree`'s file for the candidate's `src/` path `path`, `.js` read as the `.ts` beside it. */
function inTree(tree: string, path: string): string {
  const mapped = join(tree, relative(ROOT, path));
  const ts = mapped.replace(/\.js$/, ".ts");
  return existsSync(ts) ? ts : mapped;
}

function treePlugin(tree: string, overlay: Overlay): Plugin {
  return {
    name: "validity-tree",
    setup(b) {
      b.onResolve({ filter: /^\.\.?\// }, (args) => {
        if (tree === ROOT || !under(args.importer, VALIDITY)) return undefined;
        const target = resolve(dirname(args.importer), args.path);
        if (!under(target, join(ROOT, "src"))) return undefined;
        return { path: inTree(tree, target) };
      });
      b.onLoad({ filter: /\.ts$/ }, (args) => {
        if (!under(args.path, tree) || under(args.path, VALIDITY)) return undefined;
        const path = relative(tree, args.path).split(sep).join("/");
        if (overlay[path] === undefined && !VERSION_FILES.has(path)) return undefined;
        const text = overlay[path] ?? readFileSync(args.path, "utf8");
        return { contents: pinned(path, text), loader: "ts" };
      });
    },
  };
}

/** Blanks esbuild's `// path` markers, keeping every line where it is. */
export function normalized(text: string): string {
  return text.replace(/^\/\/ \S+\.(?:ts|js|mjs|cjs|json)$/gm, "");
}

/** The driver bundled against `tree`, with `overlay`'s texts in place of its files, by `bundler`. */
export const bundleDriver = (
  tree: string,
  outfile: string,
  overlay: Overlay = {},
  bundler: typeof build = build,
) => bundleModule(tree, DRIVER, outfile, overlay, bundler);

/** A component's entries, `entries` relative to `test/keys/validity/`, bundled against `tree`. */
export const bundleEntries = (tree: string, entries: string, overlay: Overlay = {}) =>
  bundleModule(tree, join(VALIDITY, entries), join(VALIDITY, "entries.mjs"), overlay);

const BUILD = "src/harness/build.ts";
const MANIFEST = "package.json";

/**
 * The target `tree`'s own build names (`bundleOptions`), so a moved target
 * shows in the emitted code: the literal its build held until 011-86, else
 * `node` and the floor of its `package.json`'s `engines.node` (`nodeFloor`).
 */
function targetOf(tree: string, overlay: Overlay): string {
  const text = overlay[BUILD] ?? readFileSync(join(tree, BUILD), "utf8");
  const literal = /\btarget: "([^"]+)"/.exec(text)?.[1];
  if (literal !== undefined) return literal;
  const manifest = overlay[MANIFEST] ?? readFileSync(join(tree, MANIFEST), "utf8");
  return `node${nodeFloor(manifest)}`;
}

/** `module`, a validity module, bundled against `tree` with `overlay`'s texts in place of its files. */
async function bundleModule(
  tree: string,
  module: string,
  outfile: string,
  overlay: Overlay,
  bundler: typeof build = build,
) {
  const { platform, format } = bundleOptions(join(tree, "dist"));
  const target = targetOf(tree, overlay);
  if (platform === undefined || format === undefined) {
    throw new Error("the shipped build names no platform or format");
  }
  const result = await bundler({
    absWorkingDir: ROOT,
    entryPoints: [module],
    outfile,
    bundle: true,
    write: false,
    platform,
    format,
    target,
    define: { __SQUEAL_VERSION__: JSON.stringify("0.0.0-validity") },
    packages: "external",
    legalComments: "none",
    sourcemap: "external",
    metafile: true,
    logLevel: "silent",
    plugins: [treePlugin(tree, overlay)],
  });
  // What esbuild read in this worktree keys the test that bundled it (011-141); another tree's are not ours.
  observeMetafile(result.metafile, ROOT);
  const files = result.outputFiles ?? [];
  const js = files.find((f) => !f.path.endsWith(".map"));
  const mapFile = files.find((f) => f.path.endsWith(".map"));
  if (js === undefined || mapFile === undefined) throw new Error("esbuild wrote no bundle");
  const map = JSON.parse(mapFile.text) as SourceMap;
  const imports = Object.values(result.metafile?.outputs ?? {}).flatMap((o) => o.imports);
  const inputs = Object.keys(result.metafile?.inputs ?? {})
    .map((input) => relative(tree, resolve(ROOT, input)).split(sep).join("/"))
    .filter((path) => path.startsWith("src/"));
  return {
    text: normalized(js.text),
    map: { ...map, sources: map.sources.map((s) => resolve(dirname(outfile), s)) },
    packages: [
      ...new Set(
        imports.filter((i) => i.external && !isBuiltin(i.path)).map((i) => packageOf(i.path)),
      ),
    ].sort(),
    inputs: new Set(inputs),
  } satisfies Bundle;
}
