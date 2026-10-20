import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Bundle } from "./bundle.js";
import type { Case, CaseOutput } from "./case.js";
import { coverageOf, type Range } from "./coverage.js";
import type { Overlay } from "./trees.js";

/*
 * One side of the comparison (task 011-37 section 3): a tree's driver bundle
 * and its recorder's runtime, written under the work directory and run in a
 * child Node under V8 coverage, with HOME and XDG_* inside the work directory.
 */

/**
 * The recorder's runtime (011 C12): CommonJS that runs inside test processes,
 * out of esbuild's reach, so it is compared and covered as text (section 2).
 */
export const RUNTIME = "src/runners/observe";

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

/** The tree's runtime files, tree-relative, with `overlay`'s texts in place. */
export function runtimeTexts(tree: string, overlay: Overlay = {}): Map<string, string> {
  const texts = new Map<string, string>();
  const names = existsSync(join(tree, RUNTIME)) ? readdirSync(join(tree, RUNTIME)) : [];
  for (const name of names.filter((n) => n.endsWith(".cjs"))) {
    texts.set(`${RUNTIME}/${name}`, readFileSync(join(tree, RUNTIME, name), "utf8"));
  }
  for (const [path, text] of Object.entries(overlay)) {
    if (path.startsWith(`${RUNTIME}/`) && path.endsWith(".cjs")) texts.set(path, text);
  }
  return texts;
}

/** Writes a side's driver and runtime under `work/<name>`. */
export function prepare(
  work: string,
  name: SideName,
  tree: string,
  bundle: Bundle,
  runtime: ReadonlyMap<string, string>,
): Side {
  const dir = join(work, name);
  mkdirSync(join(dir, "observe"), { recursive: true });
  const file = join(dir, "driver.mjs");
  writeFileSync(file, bundle.text);
  const copies = new Map<string, string>();
  for (const [path, text] of runtime) {
    const copy = join(dir, "observe", path.slice(RUNTIME.length + 1));
    writeFileSync(copy, text);
    copies.set(path, copy);
  }
  return { name, tree, dir, bundle, file, runtime: copies };
}

/**
 * Runs the side's driver in `mode` over `cases`; `other` is the runtime for
 * a run, the scratch a run stored under for a decision. Throws with the
 * driver's stderr when it fails.
 */
export function execute(
  work: string,
  side: Side,
  mode: "run" | "decide",
  cases: readonly Case[],
  other: string,
  label: string = mode,
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
