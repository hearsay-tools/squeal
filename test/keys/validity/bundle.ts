import { existsSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { build, type Plugin } from "esbuild";
import { bundleOptions } from "../../../src/harness/claude-code/build.js";
import { type Overlay, packageOf, ROOT } from "./trees.js";

/*
 * The driver bundled against one tree as the shipped bundles are built
 * (011 C3, task 011-37 sections 2 and 3): the shipped target, Node ESM, the
 * packages left as imports, no comments. The harness is the candidate's; its
 * imports of `src/` resolve into the tree under test, so the same harness runs
 * at both trees. The format version is held at one value in both, so a raise
 * does not hide an equal key.
 */

const VALIDITY = join(ROOT, "test/keys/validity");
const DRIVER = join(VALIDITY, "driver.ts");
const FORMAT = "src/core/keys/key-format.ts";

/** The format version both bundles hold, and the pin table they drop. */
export function pinFormat(text: string): string {
  return text
    .replace(/KEY_FORMAT_VERSION = \d+;/, "KEY_FORMAT_VERSION = 0;")
    .replace(/(KEY_SOURCES_HASHES[^=]*=) \{[^}]*\};/, "$1 {};");
}

export interface Bundle {
  /** The emitted code, esbuild's `// path` module markers blanked so trees at other paths compare alike. */
  readonly text: string;
  /** Its source map (version 3), `sources` absolute. */
  readonly map: SourceMap;
  /** The packages it imports, by name. */
  readonly packages: readonly string[];
}

export interface SourceMap {
  readonly sources: readonly string[];
  readonly sourcesContent?: readonly string[];
  readonly mappings: string;
}

const under = (path: string, dir: string) => path === dir || path.startsWith(`${dir}${sep}`);

/**
 * Harness modules a tree that predates a move reads in their place (task
 * 011-37 section 3): while the tree lacks `needs`, or `needs` exports no
 * function `exports`, its bundle reads `before`, which asks the same of the
 * code where it was. Each goes once the last release carries the move.
 */
const BEFORE_MOVES: readonly {
  module: string;
  needs: string;
  exports?: string;
  before: string;
}[] = [
  {
    module: "harness/accept-rule.ts",
    needs: "src/core/scheduler/accept.ts",
    before: "harness/accept-rule-ledger.ts",
  },
  {
    module: "harness/store.ts",
    needs: "src/core/scheduler/store-decision.ts",
    before: "harness/store-traced.ts",
  },
  {
    module: "harness/barrier.ts",
    needs: "src/core/scheduler/stability.ts",
    exports: "barredByTouch",
    before: "harness/barrier-scheduler.ts",
  },
];

/** The harness module `tree` reads for `target`, when a move it predates replaces it. */
function beforeMove(tree: string, target: string): string | undefined {
  const ts = target.replace(/\.js$/, ".ts");
  const move = BEFORE_MOVES.find((m) => join(VALIDITY, m.module) === ts);
  if (move === undefined) return undefined;
  const needs = join(tree, move.needs);
  const exported = new RegExp(`^export function ${move.exports}\\b`, "m");
  const moved =
    existsSync(needs) && (move.exports === undefined || exported.test(readFileSync(needs, "utf8")));
  return moved ? undefined : join(VALIDITY, move.before);
}

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
        const before = beforeMove(tree, target);
        if (before !== undefined) return { path: before };
        if (!under(target, join(ROOT, "src"))) return undefined;
        return { path: inTree(tree, target) };
      });
      b.onLoad({ filter: /\.ts$/ }, (args) => {
        if (!under(args.path, tree) || under(args.path, VALIDITY)) return undefined;
        const path = relative(tree, args.path).split(sep).join("/");
        const text = overlay[path] ?? (path === FORMAT ? readFileSync(args.path, "utf8") : null);
        if (text === null) return undefined;
        return { contents: path === FORMAT ? pinFormat(text) : text, loader: "ts" };
      });
    },
  };
}

/** Blanks esbuild's `// path` markers, keeping every line where it is. */
export function normalized(text: string): string {
  return text.replace(/^\/\/ \S+\.(?:ts|js|mjs|cjs|json)$/gm, "");
}

/** The driver bundled against `tree`, with `overlay`'s texts in place of its files. */
export async function bundleDriver(tree: string, outfile: string, overlay: Overlay = {}) {
  const { platform, format, target } = bundleOptions(join(tree, "dist"));
  if (platform === undefined || format === undefined || target === undefined) {
    throw new Error("the shipped build names no platform, format or target");
  }
  const result = await build({
    absWorkingDir: ROOT,
    entryPoints: [DRIVER],
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
  const files = result.outputFiles ?? [];
  const js = files.find((f) => !f.path.endsWith(".map"));
  const mapFile = files.find((f) => f.path.endsWith(".map"));
  if (js === undefined || mapFile === undefined) throw new Error("esbuild wrote no bundle");
  const map = JSON.parse(mapFile.text) as SourceMap;
  const imports = Object.values(result.metafile?.outputs ?? {}).flatMap((o) => o.imports);
  return {
    text: normalized(js.text),
    map: { ...map, sources: map.sources.map((s) => resolve(dirname(outfile), s)) },
    packages: [
      ...new Set(
        imports.filter((i) => i.external && !isBuiltin(i.path)).map((i) => packageOf(i.path)),
      ),
    ].sort(),
  } satisfies Bundle;
}
