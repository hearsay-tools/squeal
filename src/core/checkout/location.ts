import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { isMissing } from "../fs/errors.js";
import { worktreeIdOfRealPath } from "../fs/git-layout.js";
import type { AbsolutePath } from "../types/common.js";

/*
 * Spec 023 D4.2 (row 023-05): where a temporary checkout lives. The user's
 * cache folder keeps it away from any project's `node_modules`, which Node
 * would load from a parent folder (`temp-checkout.md` 3). It is used only on
 * the filesystem of the package store: elsewhere pnpm cannot hard link from
 * the store and downloads every package again (`temp-checkout.md` 1). Else
 * the repository's git folder holds it, with one warning line (human,
 * 2026-11-16).
 */

type Env = Readonly<Record<string, string | undefined>>;

/** The checkout folders of every repository under the cache: `<cache>/squeal/checkouts`. */
export function cacheCheckoutsRoot(
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
): AbsolutePath {
  return join(cacheHome(env, platform), "squeal", "checkouts");
}

/** `$XDG_CACHE_HOME` when absolute; else `~/Library/Caches` on macOS and `~/.cache` elsewhere. */
export function cacheHome(env: Env, platform: NodeJS.Platform): AbsolutePath {
  const xdg = env.XDG_CACHE_HOME;
  if (xdg !== undefined && xdg !== "" && isAbsolute(xdg)) return xdg;
  const home = env.HOME !== undefined && env.HOME !== "" ? env.HOME : homedir();
  return platform === "darwin" ? join(home, "Library", "Caches") : join(home, ".cache");
}

/** The checkout folder of the repository whose common dir is `commonDir`, in the git folder. */
export function gitCheckoutsDir(commonDir: AbsolutePath): AbsolutePath {
  return join(commonDir, "squeal", "checkouts");
}

/** The checkout folder of that repository under the cache: one folder per repository. */
export function cacheCheckoutsDir(cacheRoot: AbsolutePath, commonDir: AbsolutePath): AbsolutePath {
  return join(cacheRoot, worktreeIdOfRealPath(commonDir));
}

export interface CheckoutLocation {
  readonly dir: AbsolutePath;
  /** One line when the git folder holds the checkout; `null` in the cache. */
  readonly warning: string | null;
}

export interface LocateOptions {
  readonly commonDir: AbsolutePath;
  /** `cacheCheckoutsRoot()` by default. */
  readonly cacheRoot?: AbsolutePath;
  /** The package store, or `null` when unknown: the user's tree stands in for it. */
  readonly store: AbsolutePath | null;
  /** The user's worktree, on the filesystem of its own install. */
  readonly root: AbsolutePath;
}

/** D4.2: the cache when it shares the store's filesystem (`st_dev`); else the git folder. */
export function locateCheckouts(options: LocateOptions): CheckoutLocation {
  const cacheRoot = options.cacheRoot ?? cacheCheckoutsRoot();
  const reference = options.store ?? options.root;
  const cacheDevice = deviceOf(cacheRoot);
  const storeDevice = deviceOf(reference);
  if (cacheDevice !== null && cacheDevice === storeDevice)
    return { dir: cacheCheckoutsDir(cacheRoot, options.commonDir), warning: null };
  const dir = gitCheckoutsDir(options.commonDir);
  return {
    dir,
    warning: `squeal: the checkout lies in ${dir}, since ${cacheRoot} is not on the filesystem of the package store ${reference}; packages in its parent folders can load`,
  };
}

/** The device of `path`, or of its nearest folder that exists; `null` when none can be read. */
export function deviceOf(path: AbsolutePath): number | null {
  let current = path;
  for (;;) {
    try {
      return statSync(current).dev;
    } catch (error) {
      if (!isMissing(error)) return null;
      const parent = dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

/**
 * The package store the user's tree installs from: `pnpm store path` for a
 * pnpm project; `null` for the others and when it cannot be read, so the
 * user's tree stands in.
 */
export function packageStore(root: AbsolutePath, command: string): Promise<AbsolutePath | null> {
  if (!command.startsWith("pnpm ")) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile("pnpm", ["store", "path"], { cwd: root, timeout: 10_000 }, (error, stdout) => {
      const path = stdout.trim();
      resolve(error === null && isAbsolute(path) ? path : null);
    });
  });
}
