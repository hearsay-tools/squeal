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
  /**
   * One inline project object of `config`'s `projects` array (review
   * 0.1.646 B2): its `displayName` when that is unique among the inline
   * objects and does not start with `#`, else `#<index>`, 0-based among the
   * inline objects only. Absent means `config` itself is the project.
   */
  readonly project?: string;
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
  /**
   * Spec 028 D7.2: the resident memory, in MiB, above which a warm Jest
   * worker is replaced after its batch. Absent means `min(1024, 10% of the
   * machine's memory)`, at least 256. It changes no outcome, so no key.
   */
  readonly warmMemoryLimitMb?: number;
  /** Spec 027: the container target the project runs in. Absent means the host. */
  readonly container?: string;
}

/** A `jest` entry as `squeal.config.json` holds it: the keys with a default are optional. */
export type JestProjectFile = Omit<JestProject, "include" | "exclude" | "args" | "env"> &
  Partial<Pick<JestProject, "include" | "exclude" | "args" | "env">>;
