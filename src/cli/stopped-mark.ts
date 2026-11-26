import { existsSync } from "node:fs";
import { join } from "node:path";
import { POLICY_FILE } from "../core/daemon/policy.js";
import { treePrint } from "../core/delivery/stopped.js";
import { resolveCommonDir, worktreeIdFor } from "../core/fs/git-layout.js";
import { clearStopped } from "../core/presence/events.js";
import { removeStopFile, writeStopFile } from "../core/presence/lock-events.js";
import { readStopFile, stopMarkOf } from "../core/presence/marks.js";
import { type StopMark, stoppedMetaKey } from "../core/presence/stored.js";
import { isStoreOpenFailure, openReadOnly, openStore } from "../core/store/open.js";
import { lockFileFor, storePaths } from "../core/store/paths.js";
import { SCHEMA_VERSION } from "../core/store/schema.js";
import type { AbsolutePath, EpochMs, WorktreeId } from "../core/types/common.js";
import { CLI_SOCKET_TIMEOUT_MS } from "./daemon-access.js";
import { writeWithin } from "./store-writes.js";

/** How long `squeal stop` gives git to print the tree it leaves. */
const STOP_TREE_TIMEOUT_MS = 10_000;

/** The tree as git prints it when `squeal stop` is asked, before the daemon goes. */
export function stopTree(root: AbsolutePath): Promise<string | null> {
  return treePrint(root, STOP_TREE_TIMEOUT_MS);
}

/** What `leaveStoppedMark` did: the error, or whether the mark it left is `untilStart`. */
export interface StopMarkResult {
  readonly error: string | null;
  readonly untilStart: boolean;
}

/**
 * Task 011-08: `squeal stop` leaves the worktree's stopped mark, with `tree`
 * printed when the stop was asked (`stopTree`), so no hook boundary starts a
 * daemon until the next edit or `squeal start`; an edit made while the daemon
 * shut down clears it. Row 011-254: with `untilStart` (`--until-start`), or
 * over such a mark, only `squeal start` ends it. A plain stop writes nothing
 * without a store: no daemon ran there. `untilStart` creates the store where
 * the worktree has a policy file, since SessionStart spawns a daemon there
 * when no store exists (the coordinator, 2026-10-26); without one no hook
 * starts any, and a store would make the hooks read the repository as using
 * Squeal (`usesSqueal`).
 *
 * Row 021-39 (#285): the mark is a file beside the worktree's lock file
 * (`writeStopFile`), never a `store.sqlite` write, so another worktree's
 * daemon holding the store's write lock neither delays nor drops it. A file
 * that cannot be written is the error. `busyBoundMs` bounds the store's
 * creation alone.
 */
export async function leaveStoppedMark(
  root: AbsolutePath,
  at: number,
  tree: string | null,
  untilStart = false,
  busyBoundMs?: number,
): Promise<StopMarkResult> {
  const commonDir = resolveCommonDir(root);
  if (commonDir === null) return { error: null, untilStart };
  const id = worktreeIdFor(root);
  const lockFile = lockFileFor(commonDir, id);
  const database = storePaths(commonDir).database;
  if (!existsSync(database)) {
    // Without a store or a policy file no hook starts a daemon: `squeal start` alone does.
    if (!untilStart || !existsSync(join(root, POLICY_FILE))) return { error: null, untilStart };
    const error = createStore(commonDir, busyBoundMs);
    if (error !== null) return { error, untilStart: false };
  }
  const until =
    untilStart ||
    readStopFile(lockFile)?.untilStart === true ||
    legacyStop(database, id)?.untilStart === true;
  const mark: StopMark = { at: at as EpochMs, tree, ...(until ? { untilStart: true } : {}) };
  try {
    writeStopFile(lockFile, mark);
  } catch (error) {
    return { error: (error as Error).message, untilStart: false };
  }
  return { error: null, untilStart: until };
}

/**
 * `squeal start` clears the stopped mark; the error when it could not, else
 * `null`. Row 021-39: the file beside the lock file, with no store write; a
 * legacy `meta` mark only, an earlier release's, is cleared in the store,
 * through the serving daemon (spec 021 D15) and asked again while the store
 * is busy until `busyBoundMs` (spec 021 D1, #108).
 */
export async function clearStoppedMark(
  root: AbsolutePath,
  busyBoundMs?: number,
): Promise<string | null> {
  const commonDir = resolveCommonDir(root);
  if (commonDir === null) return null;
  const id = worktreeIdFor(root);
  try {
    removeStopFile(lockFileFor(commonDir, id));
  } catch (error) {
    return (error as Error).message;
  }
  if (legacyStop(storePaths(commonDir).database, id) === null) return null;
  const written = await writeWithin(
    root,
    (store, worktreeId) => store.transaction(() => clearStopped(store, worktreeId)),
    { boundMs: busyBoundMs },
  );
  return "not" in written && written.not !== "none" ? written.why : null;
}

/**
 * The legacy `meta` stopped mark in the store at `database`, read through a
 * read-only connection that takes no write lock; `null` with none, or with a
 * store that cannot be read.
 */
function legacyStop(database: AbsolutePath, id: WorktreeId): StopMark | null {
  const db = openReadOnly(database, SCHEMA_VERSION);
  if (db === null || db === "missing") return null;
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(stoppedMetaKey(id));
    const value = row?.value;
    return typeof value === "string" ? stopMarkOf(JSON.parse(value)) : null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

/**
 * Creates the empty store under `commonDir`, so SessionStart opens it and
 * reports the stop instead of spawning a daemon; the error, else `null`.
 */
function createStore(commonDir: AbsolutePath, busyBoundMs: number | undefined): string | null {
  const busyTimeoutMs =
    busyBoundMs === undefined ? CLI_SOCKET_TIMEOUT_MS : Math.max(1, busyBoundMs);
  try {
    const store = openStore(commonDir, { create: true, busyTimeoutMs });
    if (isStoreOpenFailure(store)) return `the store could not be opened (${store.reason})`;
    store.close();
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}
