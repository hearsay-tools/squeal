import type { ProjectName, RelativePath } from "./common.js";

/**
 * Git blob id of a file's bytes, lowercase hex.
 *
 * Spec 001 D3: "**File hash**: the git blob id of the bytes on disk,
 * `sha1("blob <len>\0" + bytes)` (SHA-256 in `objectFormat=sha256`
 * repositories)."
 */
export type FileHash = string;

/** Hash of the environment inputs of one runner project in one worktree, lowercase hex sha256. */
export type EnvironmentHash = string;

/**
 * Content key of a test file's results, lowercase hex sha256.
 *
 * Spec 001 D3: "**Check key**, per test file: `sha256(envHash, projectName,
 * relative test path, sorted (path, fileHash) over the closure)`. All tests in
 * a file share its key."
 */
export type CheckKey = string;

/**
 * How a closure was assembled. One value in v1.
 *
 * Spec 001 D3: "status reports the closure method as \"static imports plus
 * declared inputs\"."
 */
export type ClosureMethod = "static imports plus declared inputs";

/** A test file within one runner project. Test files are the unit of keys and runs. */
export interface TestFileRef {
  readonly project: ProjectName;
  readonly path: RelativePath;
}

/**
 * The inputs of one test file's key.
 *
 * Spec 001 D3: "**Closure** of a test file: the test file, its transitive
 * static and dynamic project imports from Vitest's transform graph (D4), its
 * snapshot file(s), and any policy-declared `inputs` globs that match.
 * `node_modules` is excluded [...]. Every closure carries `complete: false` in
 * v1".
 */
export interface Closure {
  readonly testFile: TestFileRef;
  /** Sorted, unique, relative to the worktree root, `node_modules` excluded. */
  readonly paths: readonly RelativePath[];
  readonly complete: boolean;
  readonly method: ClosureMethod;
}

/**
 * Environment inputs that the core contributes to the environment hash. The
 * runner contributes `RunnerEnvironment` (runner.ts).
 *
 * Spec 001 D3: "Squeal version and runner-adapter version, Vitest and Node
 * versions, platform and arch, [...] the installed-dependency fingerprint
 * (installed lockfile metadata under `node_modules` plus `patches/`),
 * allow-listed environment variables, and extra inputs declared in policy."
 *
 * Policy `inputs` globs are applied to closures only (D3 closure, D11
 * "extra closure globs"), not here, so they are not counted twice.
 */
export interface CoreEnvironmentInputs {
  readonly squealVersion: string;
  readonly nodeVersion: string;
  readonly platform: string;
  readonly arch: string;
  /** Hash over installed lockfile metadata under `node_modules` plus `patches/`. */
  readonly installedDependencies: string;
  /** Only variables named in `env.allowlist`, sorted by name. */
  readonly env: Readonly<Record<string, string>>;
}
