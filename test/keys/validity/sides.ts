import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
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

/** A driver's command line, its options, and the file it writes its outputs to. */
interface Invocation {
  readonly args: readonly string[];
  readonly options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv };
  readonly outFile: string;
  readonly failed: (stderr: string) => Error;
}

/**
 * The driver of `side` in `mode` over `cases`, its cases written to a file
 * of its `label`, so drivers of one side can run at once (row 011-179).
 */
function invocation(
  work: string,
  side: Side,
  mode: "run" | "decide",
  cases: readonly Case[],
  other: string,
  label: string,
  env: Readonly<Record<string, string>>,
): Invocation {
  const home = join(work, "home");
  const casesFile = join(side.dir, `${label}.cases.json`);
  const outFile = join(side.dir, `${label}.json`);
  writeFileSync(casesFile, JSON.stringify(cases));
  return {
    args: [side.file, mode, casesFile, outFile, join(side.dir, label), other],
    options: {
      cwd: side.dir,
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
    },
    outFile,
    failed: (stderr) => new Error(`the ${side.name} driver (${label}) failed:\n${stderr}`),
  };
}

const outputsOf = (run: Invocation) =>
  JSON.parse(readFileSync(run.outFile, "utf8")) as Record<string, CaseOutput>;

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
  const run = invocation(work, side, mode, cases, other, label, env);
  const child = spawnSync(process.execPath, run.args, { ...run.options, encoding: "utf8" });
  if (child.status !== 0) throw run.failed(child.stderr);
  return outputsOf(run);
}

/** `execute` without blocking, so the comparison runs several drivers at once (row 011-179). */
export function launch(
  work: string,
  side: Side,
  mode: "run" | "decide",
  cases: readonly Case[],
  other: string,
  label: string = mode,
  env: Readonly<Record<string, string>> = {},
): Promise<Record<string, CaseOutput>> {
  const run = invocation(work, side, mode, cases, other, label, env);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, run.args, run.options);
    let stderr = "";
    child.stdout.resume();
    child.stderr.setEncoding("utf8").on("data", (text: string) => {
      stderr += text;
    });
    child.on("error", reject);
    child.on("close", (status) => {
      if (status !== 0) reject(run.failed(stderr));
      else resolve(outputsOf(run));
    });
  });
}

/**
 * Each promise's value once every one has settled, else the first one's
 * error, so no driver outlives the comparison that started it (row 011-179).
 */
export async function allEnded<T extends readonly unknown[]>(
  promises: {
    readonly [K in keyof T]: Promise<T[K]>;
  },
): Promise<T> {
  const ended = await Promise.allSettled(promises);
  const failed = ended.find((end) => end.status === "rejected");
  if (failed !== undefined) throw failed.reason;
  return ended.map((end) => (end as PromiseFulfilledResult<unknown>).value) as unknown as T;
}

/**
 * Drivers per side's run (row 011-179): a side's cases dealt round robin
 * among them, both sides at once, so the cases of a kind spread over
 * `2 * SHARDS` drivers that run in parallel and each runs its share in turn.
 */
const SHARDS = 2;

/**
 * Runs `cases` at `side` in `SHARDS` drivers at once. A share's case `j`
 * writes under `run-<share>/<j>`; once all end it moves to `run/<i>`, `i`
 * its place in `cases`, where a decision reads its store (`storedFor`,
 * `compare-refs.ts`).
 */
export async function runSide(
  work: string,
  side: Side,
  cases: readonly Case[],
  pythons: Readonly<Record<string, string>>,
): Promise<Record<string, CaseOutput>> {
  const shares = Array.from({ length: SHARDS }, (_, share) =>
    [...cases.entries()].filter(([at]) => at % SHARDS === share),
  ).filter((share) => share.length > 0);
  const runtime = runtimeDir(side, RUNTIME);
  const outputs = await allEnded(
    shares.map((share, k) =>
      launch(
        work,
        side,
        "run",
        share.map(([, c]) => c),
        runtime,
        `run-${k}`,
        pythons,
      ),
    ),
  );
  mkdirSync(join(side.dir, "run"), { recursive: true });
  for (const [k, share] of shares.entries()) {
    for (const [j, [at]] of share.entries()) {
      renameSync(join(side.dir, `run-${k}`, String(j)), join(side.dir, "run", String(at)));
    }
  }
  return Object.fromEntries(outputs.flatMap((output) => Object.entries(output)));
}

/** The block ranges each run of the side recorded for `file`, one list per process. */
export function coverageAt(side: Side, file: string): Range[][] {
  const dir = join(side.dir, "coverage");
  return existsSync(dir) ? coverageOf(dir, pathToFileURL(file).href) : [];
}
