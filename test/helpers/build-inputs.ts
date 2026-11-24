import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Metafile } from "esbuild";

/*
 * Row 011-141 (011 C12, "Not seen"): the compiler and esbuild are native
 * binaries, so the recorder sees none of the files they read, and a test that
 * builds the CLI or a bundle keyed only part of what it built
 * (`research/cli-build-inputs.md`). These stat, from the test's own process,
 * each worktree file the builder lists, so the recorder keeps them among the
 * test's observed inputs. They import nothing from `src/`, so a run under the
 * recorder observes only what they stat.
 */

const ROOT = resolve(import.meta.dirname, "../..");
/** Spec 010 D13 (ADR 0005): the pinned tsrs compiler, run with `TSRS_ARGS`. */
export const TSRS = resolve(ROOT, "node_modules/tsrs/bin/tsrs");
/** Fast mode, as the repository's `build` and `typecheck` scripts run it. */
export const TSRS_ARGS = ["--fast"] as const;

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

/** A compiler diagnostic line: `file(line,col): error TS1234: …`. */
const DIAGNOSTIC = /\(\d+,\d+\): (?:error|warning|message) TS\d+/;

/**
 * The lines of `--listFiles` output that name a listed file: absolute
 * paths. A diagnostic beside them is no path, and one longer than a file name
 * can be made `statSync` throw (review 0.1.277 B2).
 */
function listedPaths(stdout: string): string[] {
  return stdout.split("\n").filter((line) => isAbsolute(line) && !DIAGNOSTIC.test(line));
}

/**
 * Runs tsrs in fast mode with `args` and `--listFiles` in the worktree, then
 * stats what it compiled, also when it fails: the compiler prints the list
 * beside its errors, and the edit that fixes them must re-key the test. A
 * failed compile throws its own error.
 */
export function compileObserved(args: readonly string[]): string[] {
  let listed: string;
  try {
    listed = execFileSync(process.execPath, [TSRS, ...TSRS_ARGS, ...args, "--listFiles"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: "pipe",
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    try {
      observeBuildInputs(listedPaths(String((error as { stdout?: unknown }).stdout ?? "")));
    } catch {
      // The compile error is what the test reports, whatever a stat threw.
    }
    throw error;
  }
  return observeBuildInputs(listedPaths(listed));
}

/*
 * Row 010-36: one build per run, not one per test file. The first test file
 * that builds `name` builds it into `<runDir>/_shared-<name>/<id>/dist`
 * under a lock; every call links that `dist` (hard links, copies where the
 * file system has none) into its own `target`, so a daemon still runs from
 * the test file's own build directory and the global teardown still names
 * the file that leaked it. Each call stats the build's inputs, so the
 * recorder keys every test file by them, and reads them: a Vitest that
 * lives across edits (under a Squeal daemon) rebuilds once an input, or the
 * recipe, no longer matches what the kept build was made from.
 */

export interface SharedBuild {
  /** The run's directory the build is kept in; `null` builds into each target alone. */
  readonly runDir: string | null;
  /** Names the build in the run's directory: `_shared-<name>`. */
  readonly name: string;
  /** What else the output depends on, such as the compiler's options. */
  readonly recipe: string;
  /** Builds into `outdir`; returns the worktree inputs it observed, as `observeBuildInputs` does. */
  readonly build: (outdir: string) => readonly string[];
}

/** The longest a call waits for another process's build before it fails. */
const SHARED_WAIT_MS = 600_000;

/** How long before a build began its inputs must have been last written for it to be kept. */
const SETTLED_MS = 1_000;

/** Kept beside each build: its inputs, and their digest when it can be reused. */
interface Stamp {
  readonly inputs: readonly string[];
  readonly digest: string | null;
}

/** Puts the output of `spec` in `target`, building it once per run and recipe (row 010-36). */
export function sharedBuild(spec: SharedBuild, target: string, root: string = ROOT): void {
  if (spec.runDir === null) {
    spec.build(target);
    return;
  }
  const home = join(spec.runDir, `_shared-${spec.name}`);
  mkdirSync(home, { recursive: true });
  const deadline = Date.now() + SHARED_WAIT_MS;
  for (;;) {
    const kept = current(home, spec.recipe, root);
    if (kept !== null) {
      observeBuildInputs(kept.inputs, root);
      linkTree(join(home, kept.id, "dist"), target);
      return;
    }
    const lock = join(home, "lock");
    if (takeLock(lock)) {
      let built: string;
      try {
        built = current(home, spec.recipe, root)?.id ?? publish(home, spec, root);
      } finally {
        rmSync(lock, { force: true });
      }
      linkTree(join(home, built, "dist"), target);
      return;
    }
    if (Date.now() > deadline) throw new Error(`sharedBuild: ${lock} held past the wait`);
    pause(100);
  }
}

/** The kept build whose inputs and recipe still match, or `null`. */
function current(
  home: string,
  recipe: string,
  root: string,
): { id: string; inputs: readonly string[] } | null {
  try {
    const id = readFileSync(join(home, "latest"), "utf8");
    const stamp = JSON.parse(readFileSync(join(home, id, "stamp.json"), "utf8")) as Stamp;
    if (stamp.digest === null || stamp.digest !== digest(recipe, stamp.inputs, root)) return null;
    return { id, inputs: stamp.inputs };
  } catch {
    return null;
  }
}

/**
 * Builds into a new entry of `home`. A build none of whose inputs changed
 * while it ran becomes `latest` and the builds before the one it replaces
 * go; another serves only this call.
 */
function publish(home: string, spec: SharedBuild, root: string): string {
  const id = randomUUID();
  const tmp = join(home, `.tmp-${id}`);
  const started = Date.now();
  let inputs: readonly string[];
  try {
    inputs = spec.build(join(tmp, "dist"));
  } catch (error) {
    rmSync(tmp, { recursive: true, force: true });
    throw error;
  }
  // File times lag the clock by up to a tick: an input written in the second
  // before the build counts as changed while it ran.
  const settled = inputs.every(
    (path) =>
      (statSync(resolve(root, path), { throwIfNoEntry: false })?.mtimeMs ?? started) <
      started - SETTLED_MS,
  );
  const stamp: Stamp = { inputs, digest: settled ? digest(spec.recipe, inputs, root) : null };
  writeFileSync(join(tmp, "stamp.json"), JSON.stringify(stamp));
  renameSync(tmp, join(home, id));
  if (!settled) return id;
  let previous = "";
  try {
    previous = readFileSync(join(home, "latest"), "utf8");
  } catch {
    // The first build of the run.
  }
  writeFileSync(join(home, `.latest-${id}`), id);
  renameSync(join(home, `.latest-${id}`), join(home, "latest"));
  for (const entry of readdirSync(home)) {
    // A `.tmp-` entry is another builder's, after a lock it took as stale.
    if ([id, previous, "latest", "lock"].includes(entry) || entry.startsWith(".tmp-")) continue;
    rmSync(join(home, entry), { recursive: true, force: true });
  }
  return id;
}

/** One digest of `recipe` and the content of each input, read now. */
function digest(recipe: string, inputs: readonly string[], root: string): string {
  const hash = createHash("sha256").update(recipe).update("\0");
  for (const path of inputs) {
    hash.update(path).update("\0");
    try {
      hash.update(readFileSync(resolve(root, path)));
    } catch {
      hash.update("\0missing");
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** Takes `lock` for this process, or clears it when the process that held it is gone. */
function takeLock(lock: string): boolean {
  try {
    const fd = openSync(lock, "wx");
    writeSync(fd, String(process.pid));
    closeSync(fd);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  try {
    const holder = Number(readFileSync(lock, "utf8"));
    // A holder that has not written its pid yet reads as 0, which is alive.
    if (holder > 0 && !alive(holder)) rmSync(lock, { force: true });
  } catch {
    // Released between the open and the read.
  }
  return false;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Blocks this thread for `ms`: the builders are synchronous. */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Recreates the tree `from` at `to` of hard links to its files, copies where a link fails. */
export function linkTree(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    const dest = join(to, entry.name);
    if (entry.isDirectory()) {
      linkTree(source, dest);
      continue;
    }
    try {
      linkSync(source, dest);
    } catch {
      copyFileSync(source, dest);
    }
  }
}
