import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { isMissing } from "../fs/index.js";
import { findInstalledLockfile, isInstalledLockfile } from "../keys/index.js";
import {
  type AbsolutePath,
  awaitingInstallMetaKey,
  awaitingInstallValue,
  type CandidateBatch,
  installCommandMetaKey,
  type RelativePath,
} from "../types/index.js";
import { awaitingInstallNote } from "./awaiting-install.js";
import { reconcileBatch } from "./batch.js";
import type { UnseenChanges } from "./bootstrap.js";
import type { SchedulerContext } from "./context.js";
import { installCommand } from "./install-command.js";
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

/** Why a daemon exits when the install goes under it (task 001-113). */
export const REINSTALL_NOTE =
  "dependencies were removed under a running daemon (a reinstall); this daemon exits and the next session starts a fresh one";

/**
 * Why a daemon exits when its own runtime goes (row 011-106): a plugin
 * upgrade or a cache cleanup removed the directory its code runs from.
 */
export function runtimeGoneNote(dir: AbsolutePath): string {
  return (
    `Squeal's own files at ${dir} were removed under its running daemon (an upgrade or a cache cleanup); ` +
    "this daemon starts no tier and exits, and its queued test files stay queued: " +
    "`squeal start` runs them with the installed Squeal"
  );
}

/** What still waits for an install: workspace directories, or none named. */
export interface MissingInstall {
  /**
   * Workspaces that declare dependencies and have none installed, while
   * others have theirs; empty when nothing is installed at the root or in
   * any workspace (review wave 11, N2).
   */
  readonly workspaces: readonly RelativePath[];
  /** The command that installs them, from the root's lockfile (`installCommand`, task 001-410). */
  readonly command: string;
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
  const declaring = await declaringWorkspaces(root, patterns);
  const missing: RelativePath[] = [];
  for (const dir of declaring) if (!(await installedIn(join(root, dir)))) missing.push(dir);
  if (declaring.length > 0 && missing.length === 0) return null;
  return {
    workspaces: missing.length === declaring.length ? [] : missing,
    command: await installCommand(root, manifest),
  };
}

/**
 * The directories whose install `missingInstall` reads, relative to `root`
 * (`""` for the root): the root, and while it holds no install, every
 * workspace that declares dependencies (review wave 11c, S1).
 */
export async function installDirs(root: AbsolutePath): Promise<RelativePath[]> {
  if (await installedIn(root)) return [""];
  const patterns = workspacePatterns(await readManifest(root));
  return ["", ...(await declaringWorkspaces(root, patterns))];
}

async function declaringWorkspaces(
  root: AbsolutePath,
  patterns: readonly string[],
): Promise<RelativePath[]> {
  const declaring: RelativePath[] = [];
  for (const dir of await expandWorkspaces(root, patterns)) {
    if (declaresOwnDependencies(await readManifest(join(root, dir)))) declaring.push(dir);
  }
  return declaring;
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
 * call. Only a daemon's start waits: one whose install goes while it runs
 * exits instead (task 001-113), so no runner is open during a wait. The test
 * files an earlier daemon listed become `unknown` with
 * `AWAITING_INSTALL_REASON`; nothing is listed, keyed or queued, and the
 * open checkpoint is abandoned. One note, the header's sentence, unless an
 * earlier start persisted it. The header says so from the meta keys.
 */
export function startWaiting(
  context: SchedulerContext,
  ledger: Ledger,
  missing: MissingInstall,
): void {
  const { store, worktreeId } = context;
  ledger.checkpoints.finish("abandoned");
  ledger.queue.clear();
  ledger.files.clear();
  const files = store.testFileKeys.list(worktreeId).map((row) => ledger.addFile(row.testFile));
  ledger.markUnknown(
    files.map((file) => ({ file, key: null })),
    AWAITING_INSTALL_REASON,
    { cause: "install" },
  );
  store.transaction(() => {
    recordWait(store, worktreeId, missing);
    ledger.commit({ refined: ledger.revision.number });
  });
  const note = awaitingInstallNote(missing.workspaces, missing.command);
  if (!persistedNoteTexts(store, worktreeId).has(note)) context.note(note);
}

/**
 * A batch while waiting: its revision is recorded with nothing left for the
 * runner, so no header counts a runner part as pending, and its paths are
 * added to `unseen` as one revision's, which the baseline reads as edits
 * (review wave 11, S2; review wave 5, B3). Returns whether the wait goes on. When it ends, the ledger forgets the files `startWaiting`
 * added, so the baseline retires the ones a listing no longer holds; the
 * caller runs it, as today's recreate starts validation after an install.
 */
export async function reconcileWaiting(
  context: SchedulerContext,
  ledger: Ledger,
  batch: CandidateBatch,
  unseen: UnseenChanges,
): Promise<boolean> {
  const { applied } = await reconcileBatch(context, ledger, batch);
  if (applied !== null) {
    ledger.commit({ refined: applied.revision.number });
    unseen.push(new Set(applied.revision.changes.map((change) => change.path)));
  }
  const missing = await missingInstall(context.root);
  if (missing !== null) {
    recordWait(context.store, context.worktreeId, missing);
    return true;
  }
  ledger.files.clear();
  return false;
}

/** The wait in the store: what it waits for, and the command a header names. */
function recordWait(
  store: SchedulerContext["store"],
  worktreeId: SchedulerContext["worktreeId"],
  missing: MissingInstall,
): void {
  store.meta.set(awaitingInstallMetaKey(worktreeId), awaitingInstallValue(missing.workspaces));
  store.meta.set(installCommandMetaKey(worktreeId), missing.command);
}

/**
 * Whether a revision's change to `path` can end the install of the root: an
 * installed lockfile (D3), a workspace's included, or the root
 * `package.json`. The scheduler then checks the install again, and exits
 * when it went (task 001-113).
 */
export function touchesInstall(path: RelativePath): boolean {
  return path === "package.json" || isInstalledLockfile(path);
}

/** Ends the wait in the store; the caller runs the baseline next. */
export function stopWaiting(context: Pick<SchedulerContext, "store" | "worktreeId">): void {
  context.store.meta.set(awaitingInstallMetaKey(context.worktreeId), "false");
}
