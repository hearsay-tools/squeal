import { readdirSync, readFileSync, realpathSync, rmdirSync, rmSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { runGit } from "../fs/git.js";
import { lstatOrNull, worktreeIdOfRealPath } from "../fs/git-layout.js";
import type { AbsolutePath } from "../types/common.js";
import { stopRecordedGroup } from "./checkout.js";
import { endLeftUnder, leftUnderNote } from "./left-under.js";
import { gitCheckoutsDir } from "./location.js";
import { type CheckoutMarker, readMarker } from "./marker.js";

/*
 * Review wave-22 B1 (spec 023 D4.2, D7.1, D7.2): what makes a folder a
 * commit worktree, for read, claim and removal alike. A marker beside a
 * tree is not enough: a copied or stale one can lie beside a user's
 * repository. The tree must be the worktree Squeal made:
 *
 * - its folder is named for the marker's commit and fingerprint;
 * - the folder lies in one of the repository's checkout locations (D4.2):
 *   the git folder's, or a cache dir named for the repository;
 * - the tree is a linked worktree of the marker's repository, not its
 *   main worktree: its `.git` is a file naming `<common dir>/worktrees/<id>`,
 *   which names the tree back;
 * - git holds it locked with the reason `squeal`, as `addCheckout` locks it.
 *
 * Removal then deletes only what Squeal made in the folder.
 */

/** The folder name of the commit worktree at `commit` for `fingerprint`, in its repository's dir. */
export function commitFolderName(commit: string, fingerprint: string): string {
  return `commit-${commit}-${fingerprint}`;
}

/** A commit worktree that passed the identity check; real paths. */
export interface CommitIdentity {
  readonly tree: AbsolutePath;
  readonly folder: AbsolutePath;
  readonly marker: CheckoutMarker & { readonly fingerprint: string };
}

/** The identity of the commit worktree at `tree`, or `null` when it is not one Squeal made. */
export function commitIdentity(tree: AbsolutePath): CommitIdentity | null {
  try {
    return identityOf(tree);
  } catch {
    return null;
  }
}

function identityOf(given: AbsolutePath): CommitIdentity | null {
  if (basename(given) !== "tree" || lstatOrNull(given)?.isDirectory() !== true) return null;
  const tree = realpathSync(given);
  const folder = dirname(tree);
  const marker = readMarker(folder);
  if (marker?.fingerprint === undefined) return null;
  const { commonDir, commit, fingerprint } = marker;
  if (basename(folder) !== commitFolderName(commit, fingerprint)) return null;
  if (!isCheckoutLocation(dirname(folder), commonDir)) return null;
  if (!isSqueals(tree, commonDir)) return null;
  return { tree, folder, marker: { ...marker, fingerprint } };
}

/** D4.2: the git folder's checkouts dir, or a cache dir named for the repository. */
export function isCheckoutLocation(dir: AbsolutePath, commonDir: AbsolutePath): boolean {
  return dir === gitCheckoutsDir(commonDir) || basename(dir) === worktreeIdOfRealPath(commonDir);
}

/** The tree is a linked worktree of `commonDir` that names it back, locked by Squeal. */
function isSqueals(tree: AbsolutePath, commonDir: AbsolutePath): boolean {
  const dotGit = join(tree, ".git");
  if (lstatOrNull(dotGit)?.isFile() !== true) return false;
  const line = /^gitdir: (.+)$/m.exec(readFileSync(dotGit, "utf8"))?.[1]?.trim();
  if (line === undefined) return false;
  const admin = realpathSync(isAbsolute(line) ? line : resolve(tree, line));
  if (dirname(admin) !== join(commonDir, "worktrees")) return false;
  const back = readFileSync(join(admin, "gitdir"), "utf8").trim();
  if (realpathSync(isAbsolute(back) ? back : resolve(admin, back)) !== realpathSync(dotGit))
    return false;
  return readFileSync(join(admin, "locked"), "utf8").trim() === "squeal";
}

const GIT = { okCodes: [0, 1, 128], timeoutMs: 120_000 };

/**
 * D7.2, D6: removes a commit worktree that passed `commitIdentity`, for a
 * caller that holds the checkout lock. The install group and the processes
 * left under the folder end first, then git removes the tree, then the
 * folder's own files go. Anything else in the folder stays, and `note`
 * names it.
 */
export async function removeCommitFolder(
  identity: CommitIdentity,
  note?: (text: string) => void,
): Promise<void> {
  const { tree, folder, marker } = identity;
  const { commonDir } = marker;
  if (marker.group !== undefined) await stopRecordedGroup(marker.group).catch(() => {});
  const left = leftUnderNote(
    await endLeftUnder(folder).catch((error: unknown) =>
      error instanceof Error ? error : new Error(String(error)),
    ),
  );
  if (left !== null) note?.(left);
  await runGit(commonDir, ["worktree", "unlock", tree], GIT).catch(() => "");
  await runGit(commonDir, ["worktree", "remove", "--force", tree], GIT).catch(() => "");
  await runGit(commonDir, ["worktree", "prune"], GIT).catch(() => "");
  if (lstatOrNull(tree) !== null) {
    note?.(`squeal: kept ${tree}: git did not remove the worktree`);
    return;
  }
  for (const name of entries(folder).filter(ownFile))
    rmSync(join(folder, name), { recursive: true, force: true, maxRetries: 3 });
  const rest = entries(folder);
  if (rest.length === 0) rmdirSync(folder);
  else note?.(`squeal: kept ${folder}: it holds files Squeal did not make: ${rest.join(", ")}`);
}

/** The files a commit worktree's folder holds beside its tree: marker, run folder, install lock. */
function ownFile(name: string): boolean {
  return (
    name === "marker.json" ||
    /^marker\.json\.\d+$/.test(name) ||
    name === "run" ||
    /^install\.lock(-journal|-wal|-shm)?$/.test(name)
  );
}

function entries(folder: AbsolutePath): string[] {
  try {
    return readdirSync(folder).sort();
  } catch {
    return [];
  }
}
