import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { AbsolutePath } from "../../../core/types/index.js";

/** A run's own prefix left by a process that died is removed by a later run after this long. */
const ABANDONED_MS = 24 * 60 * 60 * 1000;

export interface RunBytecode {
  /** The run's `PYTHONPYCACHEPREFIX`. */
  readonly prefix: AbsolutePath;
  /** Removes the prefix, the shared bytecode it links to left in place. */
  remove(): void;
}

/**
 * The bytecode prefix of one run (task 007-29). CPython and pytest's assertion
 * rewriter both accept a cached `.pyc` whose source has the same whole-second
 * mtime and size, so bytecode kept across runs can run an edit's previous code.
 * Each run gets a prefix of its own under `<cacheDir>/pycache-runs/`, removed
 * after it, so the worktree's sources compile once per run; `kept`, the
 * environment, the interpreter and `squeal_pytest`, which no revision edits, link to
 * `<cacheDir>/pycache/` and stay warm. A kept directory holding the root is
 * not kept; the worktree's bytecode an earlier version shared is removed.
 */
export function runBytecode(
  cacheDir: AbsolutePath,
  root: AbsolutePath,
  kept: readonly AbsolutePath[],
): RunBytecode {
  const shared = join(cacheDir, "pycache");
  const runs = join(cacheDir, "pycache-runs");
  mkdirSync(runs, { recursive: true });
  sweep(runs);
  const prefix = mkdtempSync(join(runs, "run-")) as AbsolutePath;
  const links = linkPoints(root, kept);
  prune(shared, root, links);
  for (const link of links) {
    mkdirSync(join(shared, link), { recursive: true });
    mkdirSync(dirname(join(prefix, link)), { recursive: true });
    symlinkSync(join(shared, link), join(prefix, link));
  }
  return { prefix, remove: () => rmSync(prefix, { recursive: true, force: true }) };
}

/**
 * Where each kept directory links: a directory inside the root links itself;
 * one outside links at its first component off the root's path, so nothing
 * that holds the root is shared. A link inside another is dropped.
 */
export function linkPoints(root: AbsolutePath, kept: readonly AbsolutePath[]): readonly string[] {
  const points = kept.flatMap((dir) => {
    const fromRoot = relative(root, dir);
    if (fromRoot === "") return [];
    if (!fromRoot.startsWith(`..${sep}`) && fromRoot !== "..") return [dir];
    const parts = dir.split(sep);
    const rootParts = root.split(sep);
    const common = parts.findIndex((part, i) => part !== rootParts[i]);
    return common === -1 ? [] : [parts.slice(0, common + 1).join(sep)];
  });
  const unique = [...new Set(points)].sort();
  return unique.filter((p) => !unique.some((q) => q !== p && p.startsWith(`${q}${sep}`)));
}

/** The environment and the interpreter's installation, from `<env>/bin/python`'s real path. */
export function keptDirs(env: AbsolutePath, python: AbsolutePath): readonly AbsolutePath[] {
  try {
    return [env, dirname(dirname(realpathSync(python))) as AbsolutePath];
  } catch {
    return [env];
  }
}

/** Removes the shared mirror of the root but for the kept directories inside it. */
function prune(shared: string, root: AbsolutePath, links: readonly string[]): void {
  const mirror = join(shared, root);
  if (!existsSync(mirror)) return;
  const kept = new Set(links.map((link) => relative(root, link).split(sep)[0]));
  for (const name of readdirSync(mirror)) {
    if (!kept.has(name)) rmSync(join(mirror, name), { recursive: true, force: true });
  }
}

function sweep(runs: string): void {
  for (const name of readdirSync(runs)) {
    const path = join(runs, name);
    try {
      if (Date.now() - statSync(path).mtimeMs > ABANDONED_MS) {
        rmSync(path, { recursive: true, force: true });
      }
    } catch {
      // Removed by another run's sweep.
    }
  }
}
