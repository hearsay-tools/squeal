import type { RelativePath } from "../types/common.js";

/*
 * Spec 023 D5.2 as amended 2026-11-19 ("A: stop guessing"; row 023-21,
 * `reviews/wave-14-fifth.md` 2): the keyed closure a stop reads before the
 * runs misses inputs a run finds on its own: a computed `import()`, a file
 * read, a runner config. After the sides run, an unchanged named test's
 * inputs are what Squeal records for keys (its keyed closure and the
 * shared observed rows the runs merged), and every changed runner config
 * file. A changed one that the call did not name (named file, `--with`,
 * `--source`) makes the file not comparable, never `proven`. A side whose
 * reads are not recorded (a forced run stores and merges nothing) leaves
 * every changed file the call did not name unaccounted for.
 */

/**
 * Runner config files: Vitest's and Vite's configs and workspaces,
 * Squeal's own config (its node:test and pytest projects), pytest's
 * configs and conftest files. A changed one is an input of every test
 * file, read or not (`reviews/wave-14-fifth.md` 2: `test.env` in a Vitest
 * config).
 */
const RUNNER_CONFIG =
  /(?:^|\/)(?:(?:vitest|vite)\.(?:config|workspace)\.[^/]+|squeal\.config\.json|pytest\.ini|pyproject\.toml|setup\.cfg|tox\.ini|conftest\.py)$/;

export function isRunnerConfig(path: RelativePath): boolean {
  return RUNNER_CONFIG.test(path);
}

/** Why a named file reads not comparable after its runs: changed inputs the call did not name. */
export interface UnnamedInputs {
  readonly paths: readonly RelativePath[];
  /** The side's reads were not recorded, so every changed path the call did not name counts. */
  readonly unrecorded: string | null;
}

/**
 * The changed inputs among `inputs` (the recorded closure; `null` when it
 * was not recorded) and the changed runner configs that `settled` (named
 * files, `--with`, `--source`) does not hold; `null` when none.
 */
export function unnamedInputs(
  inputs: readonly RelativePath[] | null,
  changed: ReadonlySet<RelativePath>,
  settled: ReadonlySet<RelativePath>,
  unrecorded: string | null,
): UnnamedInputs | null {
  const candidates =
    inputs === null ? [...changed] : [...inputs, ...[...changed].filter(isRunnerConfig)];
  const paths = [...new Set(candidates)]
    .filter((path) => changed.has(path) && !settled.has(path))
    .sort();
  if (paths.length === 0) return null;
  return { paths, unrecorded: inputs === null ? unrecorded : null };
}

/** The verdict's reason for a file with unnamed changed inputs. */
export function unnamedReason(unnamed: UnnamedInputs): string {
  const list = unnamed.paths.join(", ");
  const named =
    unnamed.paths.length === 1
      ? `changed input ${list} was not named`
      : `changed inputs ${list} were not named`;
  return unnamed.unrecorded === null ? named : `${named}; ${unnamed.unrecorded}`;
}
