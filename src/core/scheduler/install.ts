import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { isMissing } from "../fs/index.js";
import { findInstalledLockfile } from "../keys/index.js";
import {
  type AbsolutePath,
  awaitingInstallMetaKey,
  awaitingInstallValue,
  type CandidateBatch,
  type RelativePath,
} from "../types/index.js";
import { reconcileBatch } from "./batch.js";
import type { SchedulerContext } from "./context.js";
import type { Ledger } from "./ledger.js";
import { persistedNoteTexts } from "./notes.js";
import {
  declaresOwnDependencies,
  expandWorkspaces,
  readManifest,
  workspacePatterns,
} from "./workspaces.js";

/** The reason every test file is `unknown` while the daemon waits for an install. */
export const AWAITING_INSTALL_REASON = "no dependencies are installed in this worktree";

const AWAITING_INSTALL_NOTE = `${AWAITING_INSTALL_REASON}; Squeal lists and runs no tests until an install`;

/** What still waits for an install: workspace directories, or none named. */
export interface MissingInstall {
  /**
   * Workspaces that declare dependencies and have none installed, while
   * others have theirs; empty when nothing is installed at the root or in
   * any workspace (review wave 11, N2).
   */
  readonly workspaces: readonly RelativePath[];
}

/**
 * Whether the daemon of `root` waits for an install (`missingInstall`).
 * The rule holds for every runner, Vitest or `node:test`.
 */
export async function awaitsInstall(root: AbsolutePath): Promise<boolean> {
  return (await missingInstall(root)) !== null;
}

/**
 * What `root` waits for, or `null` when it does not wait: the root
 * `package.json` declares dependencies and nothing is installed for it.
 *
 * Spec 001 D5 as amended (task 001-100, lessons defect 18; task 001-107):
 * until then every result is environment noise, discarded at the install. A
 * `workspaces` entry counts as a declaration, since its packages are linked
 * only by an install. A manifest that is missing or does not parse declares
 * nothing: the project validates as before, and the runner reports what it
 * finds. Installed means an installed lockfile at the root (`installedIn`),
 * never one above it, so a parent checkout's `node_modules` does not count;
 * or, with none there, one in every workspace that declares dependencies.
 */
export async function missingInstall(root: AbsolutePath): Promise<MissingInstall | null> {
  const manifest = await readManifest(root);
  const patterns = workspacePatterns(manifest);
  if (!declaresOwnDependencies(manifest) && patterns.length === 0) return null;
  if (await installedIn(root)) return null;
  const declaring: RelativePath[] = [];
  for (const dir of await expandWorkspaces(root, patterns)) {
    if (declaresOwnDependencies(await readManifest(join(root, dir)))) declaring.push(dir);
  }
  const missing: RelativePath[] = [];
  for (const dir of declaring) if (!(await installedIn(join(root, dir)))) missing.push(dir);
  if (declaring.length > 0 && missing.length === 0) return null;
  return { workspaces: missing.length === declaring.length ? [] : missing };
}

/**
 * Whether `dir` holds an install: an installed lockfile of D3's list in
 * `dir` itself. A lockfile a repository commits is not one on its own
 * (review wave 11, S3): `bun.lock` and `bun.lockb` count only beside a
 * `node_modules` directory, `.pnp.cjs` and `.pnp.js` only beside Yarn's
 * `.yarn/install-state.gz`. `yarn.lock`, `pnpm-lock.yaml` and
 * `package-lock.json` are not on the list.
 */
async function installedIn(dir: AbsolutePath): Promise<boolean> {
  const found = await findInstalledLockfile(dir, dir);
  if (found === null) return false;
  const name = basename(found.path);
  if (BUN_LOCKFILES.has(name)) return isDirectory(join(dir, "node_modules"));
  if (PNP_LOADERS.has(name)) return exists(join(dir, ".yarn", "install-state.gz"));
  return true;
}

const BUN_LOCKFILES = new Set(["bun.lock", "bun.lockb"]);
const PNP_LOADERS = new Set([".pnp.cjs", ".pnp.js"]);

async function isDirectory(path: AbsolutePath): Promise<boolean> {
  return (await statOrNull(path))?.isDirectory() ?? false;
}

async function exists(path: AbsolutePath): Promise<boolean> {
  return (await statOrNull(path)) !== null;
}

async function statOrNull(path: AbsolutePath): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch (error) {
    if (isMissing(error) || (error as NodeJS.ErrnoException).code === "ENOTDIR") return null;
    throw error;
  }
}

/**
 * Starts the wait, after the stat cache's bootstrap and before any runner
 * call. The test files an earlier daemon listed become `unknown` with
 * `AWAITING_INSTALL_REASON`; nothing is listed, keyed or queued. One note,
 * unless an earlier start persisted it. The header says so from the meta key.
 */
export function startWaiting(
  context: SchedulerContext,
  ledger: Ledger,
  missing: MissingInstall,
): void {
  const { store, worktreeId } = context;
  const files = store.testFileKeys.list(worktreeId).map((row) => ledger.addFile(row.testFile));
  ledger.markUnknown(
    files.map((file) => ({ file, key: null })),
    AWAITING_INSTALL_REASON,
  );
  store.transaction(() => {
    store.meta.set(awaitingInstallMetaKey(worktreeId), awaitingInstallValue(missing.workspaces));
    ledger.commit({ refined: ledger.revision.number });
  });
  if (!persistedNoteTexts(store, worktreeId).has(AWAITING_INSTALL_NOTE)) {
    context.note(AWAITING_INSTALL_NOTE);
  }
}

/**
 * A batch while waiting: its revision is recorded with nothing left for the
 * runner, so no header counts a runner part as pending. Returns whether the
 * wait goes on. When it ends, the ledger forgets the files `startWaiting`
 * added, so the baseline retires the ones a listing no longer holds; the
 * caller runs it, as today's recreate starts validation after an install.
 */
export async function reconcileWaiting(
  context: SchedulerContext,
  ledger: Ledger,
  batch: CandidateBatch,
): Promise<boolean> {
  const applied = await reconcileBatch(context, ledger, batch);
  if (applied !== null) ledger.commit({ refined: applied.revision.number });
  const missing = await missingInstall(context.root);
  if (missing !== null) {
    const { store, worktreeId } = context;
    store.meta.set(awaitingInstallMetaKey(worktreeId), awaitingInstallValue(missing.workspaces));
    return true;
  }
  ledger.files.clear();
  return false;
}

/** Ends the wait in the store; the caller runs the baseline next. */
export function stopWaiting(context: Pick<SchedulerContext, "store" | "worktreeId">): void {
  context.store.meta.set(awaitingInstallMetaKey(context.worktreeId), "false");
}
