/*
 * Row 017-20 (`lessons.md` L2): the files a project tracks that an install
 * changes. Kept free of imports: the worker's bundle and the pass read it.
 */

/** The lockfiles a project tracks, at its root or in a project below it. */
export const TRACKED_LOCKFILES: ReadonlySet<string> = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
]);

/**
 * The root's files whose change may let a config that did not load load:
 * its manifest, and the lockfiles an install writes.
 */
export const INSTALL_INPUTS: readonly string[] = ["package.json", ...TRACKED_LOCKFILES];
