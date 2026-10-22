import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Bundle } from "./bundle.js";
import type { Case, CaseOutput } from "./case.js";
import type { Component } from "./components.js";
import { coverageOf, type Range } from "./coverage.js";
import type { Overlay } from "./trees.js";

/*
 * One side of the comparison (task 011-37 section 3): a tree's driver bundle
 * and the runtimes it runs, written under the work directory as the shipped
 * `dist/` holds them, so the code that finds a runtime beside its bundle
 * finds this side's, and run in a child Node under V8 coverage, with HOME
 * and XDG_* inside the work directory.
 */

/**
 * The recorder's runtime (011 C12): CommonJS that runs inside test processes,
 * out of esbuild's reach, so it is compared and covered as text (section 2).
 */
export const RUNTIME = "src/runners/observe";

/** The pytest runtime (007 D6, row 011-48): Python that runs inside pytest, covered by `python/squeal_validity_trace.py`. */
export const PYTEST_RUNTIME = "src/runners/pytest/runtime";

/** Each runtime a side copies, and the directory of `dist/` that holds it. */
const RUNTIMES: readonly { readonly path: string; readonly dir: string }[] = [
  { path: RUNTIME, dir: "observe" },
  { path: PYTEST_RUNTIME, dir: "pytest" },
];

/** The pytest graph's grammar, which the build copies beside the runtime (`src/harness/build.ts`). */
const GRAMMAR = "src/runners/pytest/graph/tree-sitter-python.wasm";

/** A side's driver under `dir`, where a shipped CLI sits under its plugin. */
export const driverFile = (dir: string) => join(dir, "dist", "cli", "driver.mjs");

/** A side's copy of the runtime at `path`, tree-relative: the directory beside its driver. */
export const runtimeDir = (side: Side, path: string) =>
  join(side.dir, "dist", RUNTIMES.find((r) => r.path === path)?.dir ?? "");

export type SideName = "baseline" | "candidate";

export interface Side {
  readonly name: SideName;
  readonly tree: string;
  readonly dir: string;
  readonly bundle: Bundle;
  /** The driver as run. */
  readonly file: string;
  /** Each runtime file, tree-relative, at its copy in `dir`. */
  readonly runtime: ReadonlyMap<string, string>;
}

/**
 * The tree's files `texts` names, tree-relative, with `overlay`'s texts in
 * place: a component's files out of esbuild's reach, compared as text.
 */
export function textsOf(
  tree: string,
  texts: Component["texts"],
  overlay: Overlay = {},
): Map<string, string> {
  const found = new Map<string, string>();
  for (const { path: dir, suffixes } of texts) {
    const holds = (name: string) => suffixes.some((suffix) => name.endsWith(suffix));
    const names = existsSync(join(tree, dir)) ? readdirSync(join(tree, dir)) : [];
    for (const name of names.filter(holds)) {
      found.set(`${dir}/${name}`, readFileSync(join(tree, dir, name), "utf8"));
    }
    for (const [path, text] of Object.entries(overlay)) {
      if (path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes("/") && holds(path)) {
        found.set(path, text);
      }
    }
  }
  return found;
}

/**
 * Writes a side's driver under `work/<name>/dist/cli` and, of `texts` (the
 * side's component texts), each runtime file in its directory of `dist/`,
 * with the tree's grammar beside the pytest runtime.
 */
export function prepare(
  work: string,
  name: SideName,
  tree: string,
  bundle: Bundle,
  texts: ReadonlyMap<string, string>,
): Side {
  const dir = join(work, name);
  const file = driverFile(dir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bundle.text);
  const copies = new Map<string, string>();
  for (const runtime of RUNTIMES) {
    mkdirSync(join(dir, "dist", runtime.dir), { recursive: true });
    for (const [path, text] of texts) {
      if (!path.startsWith(`${runtime.path}/`)) continue;
      const copy = join(dir, "dist", runtime.dir, path.slice(runtime.path.length + 1));
      writeFileSync(copy, text);
      copies.set(path, copy);
    }
  }
  if (existsSync(join(tree, GRAMMAR))) {
    copyFileSync(join(tree, GRAMMAR), join(dir, "dist", "pytest", "tree-sitter-python.wasm"));
  }
  return { name, tree, dir, bundle, file, runtime: copies };
}

/**
 * Runs the side's driver in `mode` over `cases`; `other` is the runtime for
 * a run, the scratch a run stored under for a decision; `env` adds to its
 * environment. Python's coverage of the side's pytest runtime joins V8's
 * (`python/squeal_validity_trace.py`). Throws with the driver's stderr when
 * it fails.
 */
export function execute(
  work: string,
  side: Side,
  mode: "run" | "decide",
  cases: readonly Case[],
  other: string,
  label: string = mode,
  env: Readonly<Record<string, string>> = {},
): Record<string, CaseOutput> {
  const home = join(work, "home");
  const casesFile = join(side.dir, "cases.json");
  const outFile = join(side.dir, `${label}.json`);
  writeFileSync(casesFile, JSON.stringify(cases));
  const args = [side.file, mode, casesFile, outFile, join(side.dir, label), other];
  const child = spawnSync(process.execPath, args, {
    cwd: side.dir,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_CACHE_HOME: join(home, ".cache"),
      XDG_DATA_HOME: join(home, ".local/share"),
      XDG_STATE_HOME: join(home, ".local/state"),
      NODE_V8_COVERAGE: join(side.dir, "coverage"),
      SQUEAL_VALIDITY_COVERAGE: join(side.dir, "coverage"),
      SQUEAL_VALIDITY_TRACED: runtimeDir(side, PYTEST_RUNTIME),
      ...env,
    },
  });
  if (child.status !== 0)
    throw new Error(`the ${side.name} driver (${label}) failed:\n${child.stderr}`);
  return JSON.parse(readFileSync(outFile, "utf8")) as Record<string, CaseOutput>;
}

/** The block ranges each run of the side recorded for `file`, one list per process. */
export function coverageAt(side: Side, file: string): Range[][] {
  const dir = join(side.dir, "coverage");
  return existsSync(dir) ? coverageOf(dir, pathToFileURL(file).href) : [];
}
