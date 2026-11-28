import { readFileSync } from "node:fs";
import { join } from "node:path";
import { worktreeIdFor } from "../../core/fs/git-layout.js";
import { namedLintOf, namedLintWaits } from "../../core/lint/surface/named.js";
import { lintStoreSource } from "../../core/lint/surface/source.js";
import { isBusy } from "../../core/store/connection.js";
import type {
  AbsolutePath,
  EpochMs,
  RelativePath,
  RevisionNumber,
} from "../../core/types/common.js";
import type { NamedLint } from "../../core/types/lint-delivery.js";
import type { Store } from "../../core/types/store.js";
import { folderPath, worktreePath } from "../named-selection.js";
import { readBound } from "./presence.js";
import type { Decided } from "./status-table.js";

/*
 * Row 017-37 (gh-238): the named wait's read of the lint of its paths
 * (`namedLintOf`). A named file picks its own checks, a named folder those
 * of every file below it. Lint off reads as no lint. Review 0.1.666 B1: a
 * saved verdict counts only once its tool keyed the worktree's latest
 * revision and was judged at the file's bytes now (`NamedLintAt`); a lint
 * store busy, damaged or not made yet is told as `unavailable`, and a busy
 * one keeps the wait reading.
 */

/** Which worktree paths the named paths pick, resolved once per wait. */
export interface NamedPicker {
  has(path: RelativePath): boolean;
  /** The paths named as files, not folders. */
  readonly files: readonly RelativePath[];
}

export function namedPicker(
  root: AbsolutePath,
  cwd: AbsolutePath,
  paths: readonly string[],
): NamedPicker {
  const files = new Set<RelativePath>();
  const folders: string[] = [];
  for (const path of paths) {
    const folder = folderPath(root, cwd, path);
    if (folder !== null) folders.push(folder === "" ? "" : `${folder}/`);
    else {
      const file = worktreePath(root, cwd, path);
      if (file !== null) files.add(file);
    }
  }
  return {
    has: (path) => files.has(path) || folders.some((f) => path.startsWith(f)),
    files: [...files],
  };
}

/** One read of the named paths' lint, and whether it is worth reading again soon (a busy store). */
export interface NamedLintRead {
  /** `null` with no lint to tell: lint off, or no named path it includes. */
  readonly lint: NamedLint | null;
  readonly retry: boolean;
}

const unavailable = (reason: string, retry: boolean): NamedLintRead => ({
  lint: { done: 0, pending: 0, failing: 0, unknown: 0, files: [], unavailable: reason },
  retry,
});

/** One read of the named paths' lint at `revision`, the worktree's latest. */
export function readNamedLint(
  root: AbsolutePath,
  commonDir: AbsolutePath,
  named: NamedPicker,
  revision: RevisionNumber,
  now: EpochMs,
  busyTimeoutMs: number,
): NamedLintRead {
  let access: ReturnType<ReturnType<typeof lintStoreSource>["open"]> = null;
  try {
    access = lintStoreSource(commonDir, root, { busyTimeoutMs }).open();
    if (access === null) return { lint: null, retry: false };
    if (access === "missing") return unavailable("no daemon has made the lint store yet", false);
    if ("unreadable" in access) return unavailable(access.unreadable, false);
    const bytes = (path: RelativePath) => bytesOf(root, path);
    const at = { revision, bytes, files: named.files };
    const { store } = access;
    // Review 0.1.666-r2 B1-R: the states, the cursor and the facts beside them from one snapshot.
    const lint = store.read(() =>
      namedLintOf(store, worktreeIdFor(root), (p) => named.has(p), now, at),
    );
    return { lint, retry: false };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return isBusy(error)
      ? unavailable(`lint store busy: ${reason}`, true)
      : unavailable(reason, false);
  } finally {
    if (access !== null && access !== "missing" && "store" in access) access.store.close();
  }
}

function bytesOf(root: AbsolutePath, path: RelativePath): Uint8Array | null {
  try {
    return readFileSync(join(root, path));
  } catch {
    return null;
  }
}

/** A wait's read of its paths' lint at the store's latest revision, in the wait's busy bound. */
export type NamedLintReader = (
  root: AbsolutePath,
  commonDir: AbsolutePath,
  store: Pick<Store, "revisions">,
) => NamedLintRead;

/** A wait's reads of its paths' lint, the picker resolved at the first. */
export function namedLintReads(
  cwd: AbsolutePath,
  paths: readonly string[],
  deadline: number,
  now: () => EpochMs,
): NamedLintReader {
  let named: NamedPicker | undefined;
  return (root, commonDir, store) => {
    named ??= namedPicker(root, cwd, paths);
    const revision = (store.revisions.latest(worktreeIdFor(root))?.number ?? 0) as RevisionNumber;
    const { busyTimeoutMs } = readBound(deadline, now);
    return readNamedLint(root, commonDir, named, revision, now(), busyTimeoutMs);
  };
}

/**
 * Row 017-37: a read the test files decided waits on while the pass lints a
 * named path or has not keyed it (`namedLintWaits`), or the lint store is
 * busy, with the daemon alive and before the deadline. A `--check` wait's
 * focused answer is left as it was. At the deadline the test files decide
 * alone; the lint read tells where it stood, `pending` or `unknown`.
 */
export function lintDecided(
  tested: Decided | null,
  final: boolean,
  alive: boolean,
  read: () => NamedLintRead,
): { readonly decided: Decided | null; readonly lint: NamedLint | null | undefined } {
  if (tested === null || tested === "focused" || final || !alive) {
    return { decided: tested, lint: undefined };
  }
  const { lint, retry } = read();
  return { decided: retry || namedLintWaits(lint) > 0 ? null : tested, lint };
}

/** The end's `lint` field: the read a decision made, else one now; none when there is no lint. */
export function lintField(
  lint: NamedLint | null | undefined,
  read: () => NamedLintRead,
): { readonly lint?: NamedLint } {
  const last = lint === undefined ? read().lint : lint;
  return last === null ? {} : { lint: last };
}
