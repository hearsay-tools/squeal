import { lstatSync, readdirSync, readFileSync, realpathSync, rmdirSync, rmSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { isMissing } from "../fs/errors.js";
import { runGit } from "../fs/git.js";
import { lstatOrNull, worktreeIdOfRealPath } from "../fs/git-layout.js";
import type { AbsolutePath } from "../types/common.js";
import { stopRecordedGroup } from "./checkout.js";
import { endLeftUnder, leftUnderNote } from "./left-under.js";
import { gitCheckoutsDir } from "./location.js";
import { type CheckoutMarker, readMarker, treePath, writeMarker } from "./marker.js";

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

/** What a removal left: the tree gone, the tree still there, or a tree it could not read. */
export type CommitRemoval = "removed" | "kept" | "unknown";

/**
 * Review wave-22 N3: whether `path` is gone, by `lstat`'s error code, not
 * `existsSync`: a path whose parent cannot be searched (EACCES and the like)
 * is `unknown`, never gone.
 */
export function pathState(path: AbsolutePath): CommitRemoval {
  try {
    lstatSync(path);
    return "kept";
  } catch (error) {
    return isMissing(error) ? "removed" : "unknown";
  }
}

/** The parts of a commit worktree's folder that removal reads. */
export interface CommitFolder {
  readonly tree: AbsolutePath;
  readonly folder: AbsolutePath;
  readonly marker: CheckoutMarker;
}

/**
 * D7.2, D6: removes a commit worktree that passed `commitIdentity`, for a
 * caller that holds the checkout lock. The install group and the processes
 * left under the folder end first, then git removes the tree, then the
 * folder's own files go. Anything else in the folder stays, and `note`
 * names it. Review wave-22 N2: the marker then stays too, so the folder
 * stays recognisably Squeal's and a later sweep keeps what it kept. The
 * same call clears such a folder once its tree is gone. It never throws:
 * an error goes to `note`, and the result says what is left of the tree.
 */
export async function removeCommitFolder(
  identity: CommitFolder,
  note?: (text: string) => void,
): Promise<CommitRemoval> {
  try {
    return await clearFolder(identity, note);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    note?.(`squeal: could not remove ${identity.tree}: ${text}`);
    return pathState(identity.tree);
  }
}

async function clearFolder(
  { tree, folder, marker }: CommitFolder,
  note?: (text: string) => void,
): Promise<CommitRemoval> {
  const { commonDir } = marker;
  if (marker.group !== undefined) await stopRecordedGroup(marker.group).catch(() => {});
  const left = leftUnderNote(
    await endLeftUnder(folder).catch((error: unknown) =>
      error instanceof Error ? error : new Error(String(error)),
    ),
  );
  if (left !== null) note?.(left);
  if (lstatOrNull(tree) !== null) {
    await runGit(commonDir, ["worktree", "unlock", tree], GIT).catch(() => "");
    await runGit(commonDir, ["worktree", "remove", "--force", tree], GIT).catch(() => "");
    await runGit(commonDir, ["worktree", "prune"], GIT).catch(() => "");
    if (lstatOrNull(tree) !== null) {
      note?.(`squeal: kept ${tree}: git did not remove the worktree`);
      return "kept";
    }
  }
  const names = readdirSync(folder);
  const rest = names.filter((name) => !ownFile(name));
  for (const name of names.filter(
    (name) => ownFile(name) && (rest.length === 0 || !isMarker(name)),
  ))
    rmSync(join(folder, name), { recursive: true, force: true, maxRetries: 3 });
  if (rest.length === 0) {
    rmdirSync(folder);
    return "removed";
  }
  // Review wave-22 N2: the marker stays beside what Squeal did not make, without the ended group.
  const { group: _ended, installed: _gone, ...kept } = marker;
  writeMarker(folder, kept);
  note?.(`squeal: kept ${folder}: it holds files Squeal did not make: ${rest.sort().join(", ")}`);
  return "removed";
}

/**
 * Review wave-23 N1: what the sweep says of a commit worktree's folder it
 * keeps whole, since its tree failed the identity check.
 */
export function identityFailedNote(folder: AbsolutePath): string {
  return `squeal: kept ${folder}: its tree is not a commit worktree Squeal made; check it and remove it by hand`;
}

/** The files a commit worktree's folder holds beside its tree: marker, run folder, install lock. */
function ownFile(name: string): boolean {
  return isMarker(name) || name === "run" || /^install\.lock(-journal|-wal|-shm)?$/.test(name);
}

function isMarker(name: string): boolean {
  return name === "marker.json" || /^marker\.json\.\d+$/.test(name);
}

/**
 * Review wave-22 N2: a commit worktree's folder of `commonDir` whose tree
 * is gone: a removal kept files Squeal did not make, or a create stopped
 * before git added the tree. `removeCommitFolder` clears it and keeps
 * what Squeal did not make; a recursive removal would delete that.
 */
export function treelessCommitFolder(
  folder: AbsolutePath,
  marker: CheckoutMarker,
): CommitFolder | null {
  if (marker.fingerprint === undefined) return null;
  if (basename(folder) !== commitFolderName(marker.commit, marker.fingerprint)) return null;
  if (!isCheckoutLocation(dirname(folder), marker.commonDir)) return null;
  const tree = treePath(folder);
  return pathState(tree) === "removed" ? { tree, folder, marker } : null;
}
