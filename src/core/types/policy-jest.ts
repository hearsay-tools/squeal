/**
 * One Jest project (spec 028 D1). Its identity is `(runner "jest", name)`.
 * Wave 2 (row 028-05) adds `jest: readonly JestProject[]` to `Policy`.
 */
export interface JestProject {
  /** Unique among the repository's projects of every runner. */
  readonly name: string;
  /**
   * Relative to the worktree root: the Jest config file Jest reads with
   * `--config`, or a `package.json` with a `jest` key.
   */
  readonly config: string;
  /** Relative to the worktree root; absent means the config file's directory. Jest runs from here. */
  readonly cwd?: string;
  /** Test-file globs relative to `cwd` that narrow what Jest lists. Default `[]`: every file Jest lists. */
  readonly include: readonly string[];
  /** Globs relative to `cwd` removed from what Jest lists. Default `[]`. */
  readonly exclude: readonly string[];
  /** Arguments the project's own command passes that change semantics. Default `[]`. */
  readonly args: readonly string[];
  /** Merged over the run environment, never replacing it. Default `{}`. */
  readonly env: Readonly<Record<string, string>>;
  /** Spec 004 D1: every file the project lists is a slow file. Absent means `false`. */
  readonly slow?: boolean;
  /** Spec 028 D4: test files per Jest process. Absent means 5. */
  readonly batchSize?: number;
  /** Spec 027: the container target the project runs in. Absent means the host. */
  readonly container?: string;
}

/** A `jest` entry as `squeal.config.json` holds it: the keys with a default are optional. */
export type JestProjectFile = Omit<JestProject, "include" | "exclude" | "args" | "env"> &
  Partial<Pick<JestProject, "include" | "exclude" | "args" | "env">>;
