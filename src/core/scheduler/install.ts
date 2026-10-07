import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isMissing, isRecord } from "../fs/index.js";
import { findInstalledLockfile } from "../keys/index.js";
import { type AbsolutePath, awaitingInstallMetaKey, type CandidateBatch } from "../types/index.js";
import { reconcileBatch } from "./batch.js";
import type { SchedulerContext } from "./context.js";
import type { Ledger } from "./ledger.js";
import { persistedNoteTexts } from "./notes.js";

/** The reason every test file is `unknown` while the daemon waits for an install. */
export const AWAITING_INSTALL_REASON = "no dependencies are installed in this worktree";

const AWAITING_INSTALL_NOTE = `${AWAITING_INSTALL_REASON}; Squeal lists and runs no tests until an install`;

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"] as const;

/**
 * Whether the daemon of `root` waits for an install: the root `package.json`
 * declares dependencies and the root has no installed lockfile (D3; never
 * one above the root, so a parent checkout's `node_modules` does not count).
 *
 * Spec 001 D5 as amended (task 001-100, lessons defect 18): until then every
 * result is environment noise, discarded at the install. A `workspaces`
 * entry counts as a declaration, since its packages are linked only by an
 * install. A manifest that is missing or does not parse declares nothing:
 * the project validates as before, and the runner reports what it finds.
 * The rule holds for every runner, Vitest or `node:test`.
 */
export async function awaitsInstall(root: AbsolutePath): Promise<boolean> {
  if (!declaresDependencies(await readManifest(root))) return false;
  return (await findInstalledLockfile(root, root)) === null;
}

function declaresDependencies(manifest: unknown): boolean {
  if (!isRecord(manifest)) return false;
  if (DEPENDENCY_FIELDS.some((field) => nonEmpty(manifest[field]))) return true;
  const workspaces = manifest.workspaces;
  return nonEmpty(isRecord(workspaces) ? workspaces.packages : workspaces);
}

function nonEmpty(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return isRecord(value) && Object.keys(value).length > 0;
}

async function readManifest(root: AbsolutePath): Promise<unknown> {
  try {
    return JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  } catch (error) {
    if (isMissing(error) || error instanceof SyntaxError) return null;
    throw error;
  }
}

/**
 * Starts the wait, after the stat cache's bootstrap and before any runner
 * call. The test files an earlier daemon listed become `unknown` with
 * `AWAITING_INSTALL_REASON`; nothing is listed, keyed or queued. One note,
 * unless an earlier start persisted it. The header says so from the meta key.
 */
export function startWaiting(context: SchedulerContext, ledger: Ledger): void {
  const { store, worktreeId } = context;
  const files = store.testFileKeys.list(worktreeId).map((row) => ledger.addFile(row.testFile));
  ledger.markUnknown(
    files.map((file) => ({ file, key: null })),
    AWAITING_INSTALL_REASON,
  );
  store.transaction(() => {
    store.meta.set(awaitingInstallMetaKey(worktreeId), "true");
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
  if (await awaitsInstall(context.root)) return true;
  ledger.files.clear();
  return false;
}

/** Ends the wait in the store; the caller runs the baseline next. */
export function stopWaiting(context: Pick<SchedulerContext, "store" | "worktreeId">): void {
  context.store.meta.set(awaitingInstallMetaKey(context.worktreeId), "false");
}
