import { basename, extname } from "node:path";
import { isInstalledLockfile } from "../../keys/environment.js";
import type { RelativePath } from "../../types/index.js";
import type { Disagreement } from "./held.js";
import { MODULE_EXTENSIONS } from "./keys.js";
import type { LintDeclaration, LintRefresh, LintSnapshot } from "./provider.js";

/**
 * A flat config file at any depth: ESLint reads one per directory, and
 * `configFiles` lists only the root's (017-04, 2026-10-26).
 */
export function isFlatConfig(path: RelativePath): boolean {
  return /^eslint\.config\.[cm]?[jt]s$/.test(basename(path));
}

/**
 * Spec 017 D4: how a revision's changed paths refresh the worker. The
 * installed lockfile (011 C11) needs a new thread; a config file, nested
 * ones included, a new instance; another file the config loaded, a
 * tsconfig among them, a new thread; anything else none.
 */
export function refreshLevel(
  changed: readonly RelativePath[],
  declaration: LintDeclaration,
  closure: readonly RelativePath[],
): LintRefresh {
  const config = new Set(declaration.configFiles);
  const loaded = new Set(closure);
  let level: LintRefresh = "none";
  for (const path of changed) {
    if (isInstalledLockfile(path)) return "thread";
    if (isFlatConfig(path) || config.has(path)) level = "instance";
    else if (loaded.has(path)) return "thread";
  }
  return level;
}

/** D9: a change that may turn an off provider on: a flat config, a manifest or an install. */
export function mayTurnOn(path: RelativePath): boolean {
  return isFlatConfig(path) || basename(path) === "package.json" || isInstalledLockfile(path);
}

/**
 * The refresh a pass runs before it keys, or `null` for none: D4's level
 * over the revisions' paths and the loaded files the worker holds at other
 * bytes. A changed module file may move the program (D5, wave 1.5), and so
 * may a file the walk read at other bytes or a lookup whose state moved
 * (wave 1.7 Q3): `none` reads it again. A file the worker holds that is gone
 * needs a new thread: TypeScript's service keeps what it read (wave 1.6).
 */
export function refreshOf(
  paths: readonly RelativePath[],
  seen: Pick<Disagreement, "loaded" | "renew" | "walked" | "lookups">,
  snapshot: LintSnapshot,
): LintRefresh | null {
  if (seen.renew.length > 0) return "thread";
  const level = refreshLevel([...paths, ...seen.loaded], snapshot.declaration, snapshot.closure);
  if (level !== "none") return level;
  const module = (path: RelativePath) => MODULE_EXTENSIONS.has(extname(path));
  return seen.walked.length > 0 || seen.lookups || paths.some(module) ? "none" : null;
}

const LEVELS: readonly LintRefresh[] = ["none", "instance", "thread"];

/** The higher of two refreshes; `null` is none at all. */
export function higher(a: LintRefresh | null, b: LintRefresh | null): LintRefresh | null {
  if (a === null || b === null) return a ?? b;
  return LEVELS.indexOf(a) >= LEVELS.indexOf(b) ? a : b;
}
