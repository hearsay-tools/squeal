import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Metafile } from "esbuild";

/*
 * Row 011-141 (011 C12, "Not seen"): `tsc` and esbuild are native binaries, so
 * the recorder sees none of the files they read, and a test that builds the CLI
 * or a bundle keyed only part of what it built (`research/cli-build-inputs.md`).
 * These stat, from the test's own process, each worktree file the builder
 * lists, so the recorder keeps them among the test's observed inputs. They
 * import nothing from `src/`, so a run under the recorder observes only what
 * they stat.
 */

const ROOT = resolve(import.meta.dirname, "../..");
const TSC = resolve(ROOT, "node_modules/typescript/bin/tsc");

/**
 * Stats each of `paths`, resolved from `root`, that is a file in the worktree
 * outside `node_modules`; returns those, relative to `root` and sorted.
 */
export function observeBuildInputs(paths: Iterable<string>, root: string = ROOT): string[] {
  const kept = new Set<string>();
  for (const path of paths) {
    const rel = relative(root, resolve(root, path));
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) continue;
    if (rel.split(sep)[0] === "node_modules") continue;
    if (statSync(resolve(root, rel), { throwIfNoEntry: false })?.isFile() === true) {
      kept.add(rel.split(sep).join("/"));
    }
  }
  return [...kept].sort();
}

/** What an esbuild `metafile` lists as inputs, its keys relative to `workingDir`, stat'ed. */
export function observeMetafile(
  metafile: Metafile | undefined,
  workingDir: string = ROOT,
): string[] {
  if (metafile === undefined) throw new Error("esbuild returned no metafile: build with metafile");
  return observeBuildInputs(
    Object.keys(metafile.inputs).map((input) => resolve(workingDir, input)),
  );
}

/**
 * Runs `tsc` with `args` and `--listFiles` in the worktree, then stats what it
 * compiled, also when it fails: `tsc` prints the list beside its errors, and
 * the edit that fixes them must re-key the test.
 */
export function tscObserved(args: readonly string[]): string[] {
  let listed: string;
  try {
    listed = execFileSync(process.execPath, [TSC, ...args, "--listFiles"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: "pipe",
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    const stdout = (error as { stdout?: unknown }).stdout;
    observeBuildInputs(String(stdout ?? "").split("\n"));
    throw error;
  }
  return observeBuildInputs(listed.split("\n"));
}
