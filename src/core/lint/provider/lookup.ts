import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { AbsolutePath } from "../../types/common.js";

/*
 * Spec 017 D3 step 4, row 017-24 (`lessons.md` L7): ESLint 9 lints every
 * file with the root config. With the flag `v10_config_lookup_from_file`,
 * each file uses its nearest `eslint.config.*`, as ESLint 10 and `nx lint`
 * do. With ESLint 9 and a nested config in the project, the worker adds the
 * flag to `ESLINT_FLAGS`, a keyed variable (D5).
 */

/** ESLint 9's flag for ESLint 10's config lookup. */
export const LOOKUP_FLAG = "v10_config_lookup_from_file";

/** A flat config's file name, as `pass/refresh.ts` `isFlatConfig` reads it. */
const FLAT_CONFIG = /^eslint\.config\.[cm]?[jt]s$/;

/** The daemon's own `ESLINT_FLAGS`, as the worker thread started with it. */
export const DAEMON_FLAGS = process.env.ESLINT_FLAGS;

/** What `lookupEslint` makes: ESLint's `hasFlag` tells whether the flag took. */
interface Flagged {
  hasFlag?(flag: string): boolean;
}

/**
 * Folders the walk skips by name: version control metadata and installed
 * dependencies. Other dot folders, as `.storybook`, hold tracked configs
 * (review 0.1.392 B2).
 */
const SKIPPED: ReadonlySet<string> = new Set([
  ".git",
  ".hg",
  ".svn",
  ".jj",
  "node_modules",
  "bower_components",
  ".pnpm-store",
  ".yarn",
]);

/**
 * Whether a flat config is in a folder below `root`. The walk reads the
 * disk, not the listing: a git-ignored folder counts too.
 */
export function hasNestedConfig(root: AbsolutePath): boolean {
  const found = (dir: string, nested: boolean): boolean => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        if (nested && FLAT_CONFIG.test(entry.name)) return true;
      } else if (!SKIPPED.has(entry.name) && found(join(dir, entry.name), true)) {
        return true;
      }
    }
    return false;
  };
  return found(root, false);
}

/** `flags`, ESLint's comma list, with `flag` added once. */
export function withFlag(flags: string | undefined, flag: string): string {
  const list = (flags ?? "")
    .split(",")
    .map((one) => one.trim())
    .filter((one) => one !== "");
  return list.includes(flag) ? (flags ?? flag) : [...list, flag].join(",");
}

/**
 * An `ESLint` from `make`, with `env.ESLINT_FLAGS` set first: `given`, and
 * `LOOKUP_FLAG` too when `nested`. ESLint reads the variable when it is
 * made. An ESLint 9 older than the flag refuses it as unknown, or one older
 * than the variable does not read it: either gets `given` alone, as before
 * row 017-24, so the key holds only flags in use.
 */
export function lookupEslint<T extends Flagged>(
  make: () => T,
  nested: boolean,
  given: string | undefined = DAEMON_FLAGS,
  env: Record<string, string | undefined> = process.env,
): T {
  const set = (flags: string | undefined) => {
    if (flags === undefined) delete env.ESLINT_FLAGS;
    else env.ESLINT_FLAGS = flags;
  };
  const flags = nested ? withFlag(given, LOOKUP_FLAG) : given;
  set(flags);
  if (flags === given) return make();
  try {
    const eslint = make();
    if (eslint.hasFlag?.(LOOKUP_FLAG) === true) return eslint;
  } catch {
    // "Unknown flag": made again without it below, where any other error surfaces.
  }
  set(given);
  return make();
}
