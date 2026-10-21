/**
 * Identifiers and small value types shared by every interface in spec 001.
 *
 * These are plain aliases, not branded types. They document intent at the
 * signature level; mixing them up is caught in review and tests, not by tsc.
 */

/** An absolute filesystem path, as resolved by the daemon (realpath). */
export type AbsolutePath = string;

/**
 * A path relative to the worktree root, using `/` separators.
 *
 * Spec 001 D3: "Results are keyed by what produced them, never by where or
 * when." Relative paths keep keys stable across worktrees at other locations.
 */
export type RelativePath = string;

/**
 * Stable id of one worktree: the `<worktree-hash>` used in lock and socket
 * names.
 *
 * Spec 001 D1: "`locks/<worktree-hash>.sqlite`: one exclusive-lock database
 * per worktree" and "`<runtime dir>/squeal-<worktree-hash>.sock`". The hash
 * function is chosen by the store task (001-10).
 */
export type WorktreeId = string;

/**
 * Squeal's monotonic workspace generation for one worktree. Not a git SHA.
 *
 * Spec 001 D2: "If anything remains, the worktree's **revision** increments
 * by one".
 */
export type RevisionNumber = number;

/** A git commit SHA, or `null` when `HEAD` is unborn. Provenance only, never part of a key. */
export type CommitSha = string | null;

/** Milliseconds since the Unix epoch. */
export type EpochMs = number;

/** Name of a Vitest project; `""` when the config defines no projects (research, vitest-internals Q4). */
export type ProjectName = string;

/** Version of every versioned, machine-readable payload defined here. Styleguide: "Every emitted event and status payload is a versioned, machine-readable shape." */
export const PAYLOAD_SCHEMA_VERSION = 1;
export type PayloadSchemaVersion = typeof PAYLOAD_SCHEMA_VERSION;

/** A position in a source file, 1-based line and column. */
export interface SourceLocation {
  readonly path: RelativePath;
  readonly line: number;
  readonly column: number;
}

/**
 * The first frame of a failure's stack in its check's own test file, shown
 * beside a `location` in another file (011 C5 as amended 2026-10-21, gh-67).
 * Read from the stored stack when shown, never stored. pytest's tracebacks
 * name no column.
 */
export interface TestFileFrame {
  readonly path: RelativePath;
  readonly line: number;
  readonly column?: number;
}
