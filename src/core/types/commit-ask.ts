import type { AbsolutePath, PayloadSchemaVersion, RelativePath } from "./common.js";
import type { TestFileRef } from "./keys.js";

/*
 * Spec 023 D7.3 as amended 2026-11-21 (row 023-40c, the human: "A: daemon
 * owns setup"): what a `status --at --run` call asks of a commit daemon
 * and what it reads back. The call sends the change (the paths `git diff
 * <commit>..HEAD` and the working tree's changes name), the paths it names
 * and `--all-missing`; the daemon installs, keys, selects the files with
 * no result at the commit (D4.5, named files first), queues them and keeps
 * the ask, so a later call or `--wait` reads it. A read answers the setup
 * and, per ask, the files it queued; their live keys and pending marks are
 * the daemon's rows in the shared store, which the caller reads with their
 * results, so a file whose run observed new inputs reads at its completed
 * key. The daemon's socket thread answers from the last snapshot its main
 * thread sent (`CommitSnapshot`).
 */

/** One call's ask of a commit daemon. Answered at once; the work goes on in the daemon. */
export interface CommitAskRequest {
  readonly type: "commit-ask";
  /** The call's own id: its narrow runs' owner, and the ask's id for reads. */
  readonly owner: string;
  /** D4.5's selection input: the paths the change names, relative to the root. */
  readonly changed: readonly RelativePath[];
  /** The paths the call names: their test files run whether the change selects them or not. */
  readonly named: readonly RelativePath[];
  /** `--all-missing`: every file with no result at the commit runs. */
  readonly allMissing: boolean;
  /**
   * D4.9: the caller's worktree, where an input generated there and not
   * tracked at its HEAD counts as one git does not hold. Absent: none.
   */
  readonly root?: AbsolutePath;
}

export interface CommitAskResponse {
  readonly schemaVersion: PayloadSchemaVersion;
  readonly ok: true;
  readonly type: "commit-ask";
  readonly owner: string;
}

/** Reads the setup and the asks `owners` names; every kept ask without it. */
export interface CommitReadRequest {
  readonly type: "commit-read";
  readonly owners?: readonly string[];
}

/** Where the commit daemon's setup is: its install, its start (keys), done, or failed with its text. */
export type CommitSetup =
  | { readonly phase: "install" }
  | { readonly phase: "starting" }
  | { readonly phase: "ready" }
  | { readonly phase: "failed"; readonly text: string }
  /**
   * Row 023-40c (row 023-07's whole-checkout check): the tree does not
   * hold `path` as the commit does, made so by git's own checkout rules
   * (found before the install) or by the install. Nothing runs there: no
   * result of it would be the commit's.
   */
  | { readonly phase: "changed"; readonly path: RelativePath; readonly by: "git" | "install" };

/** One kept ask. */
export interface CommitAskState {
  readonly owner: string;
  /** `waiting`: for the setup; `selecting`: keyed, choosing; `queued`: its files are queued (or done); `failed`. */
  readonly phase: "waiting" | "selecting" | "queued" | "failed";
  /** Why it failed. */
  readonly text?: string;
  /** The files it queued, named files first; empty until `queued`. */
  readonly files: readonly TestFileRef[];
  /** Per named path that is no test file: the test files the commit's key index says read it. */
  readonly readers: Readonly<Record<RelativePath, readonly TestFileRef[]>>;
  /** Per group whose request failed: why. */
  readonly problems: readonly string[];
  /** D4.9: chosen files that do not run, with why (`needs <path>`); absent when none. */
  readonly refused?: readonly CommitRefusal[];
}

/** D4.9: a file the commit daemon does not run: its closure reads a path git does not hold there. */
export interface CommitRefusal {
  readonly ref: TestFileRef;
  readonly reason: string;
}

/** What the main thread tells the socket thread, at each change. */
export interface CommitSnapshot {
  readonly setup: CommitSetup;
  readonly asks: readonly CommitAskState[];
  /**
   * Row 023-35 (T2): per node:test project, its test files whose static
   * closure is incomplete, once its adapter told them. A project absent
   * here does not tell (Vitest), or has not yet.
   */
  readonly incomplete?: Readonly<Record<string, readonly RelativePath[]>>;
}

export interface CommitReadResponse extends CommitSnapshot {
  readonly schemaVersion: PayloadSchemaVersion;
  readonly ok: true;
  readonly type: "commit-read";
}
