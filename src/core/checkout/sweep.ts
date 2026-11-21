import { readdirSync } from "node:fs";
import { join } from "node:path";
import { isMissing } from "../fs/errors.js";
import type { AbsolutePath } from "../types/common.js";
import { removeTree, withCheckoutLock } from "./checkout.js";
import { commitIdentity, removeCommitFolder, treelessCommitFolder } from "./commit-identity.js";
import {
  type CheckoutMarker,
  type OwnerState,
  ownerState,
  readMarker,
  treePath,
} from "./marker.js";

/*
 * Spec 023 D6 (row 023-05): list the temporary checkouts and sweep the dead
 * ones. A checkout is dead when its marker names an owner that is gone:
 * its pid free or held by a process with another start time. A folder with
 * no marker that the sweep finds while it holds the checkout lock is one a
 * create left half made, since a create writes the marker under that lock.
 */

export interface ListedCheckout {
  readonly folder: AbsolutePath;
  readonly tree: AbsolutePath;
  /** `null` when the folder holds no readable marker. */
  readonly marker: CheckoutMarker | null;
  /** `unknown` without a marker. */
  readonly owner: OwnerState;
}

/** The checkout folders in each of `dirs`, by path; a missing dir holds none. */
export function listCheckouts(dirs: readonly AbsolutePath[]): ListedCheckout[] {
  const listed: ListedCheckout[] = [];
  for (const dir of dirs) {
    for (const name of entriesOf(dir)) {
      const folder = join(dir, name);
      const marker = readMarker(folder);
      listed.push({
        folder,
        tree: treePath(folder),
        marker,
        owner: marker === null ? "unknown" : ownerState(marker),
      });
    }
  }
  return listed.sort((a, b) => a.folder.localeCompare(b.folder));
}

/**
 * The checkout dirs of every repository under the cache root
 * (`<root>/<repository id>`), for `squeal ps`.
 */
export function cacheRepositoryDirs(cacheRoot: AbsolutePath): AbsolutePath[] {
  return entriesOf(cacheRoot).map((name) => join(cacheRoot, name));
}

export interface SweepOptions {
  /** The repository whose checkouts are swept: its lock is taken. */
  readonly commonDir: AbsolutePath;
  /** Its checkout dirs: the cache's and the git folder's. */
  readonly dirs: readonly AbsolutePath[];
  readonly lockWaitMs?: number;
  /** Row 023-31 (D6): told which processes left under a swept checkout were ended. */
  readonly note?: ((text: string) => void) | undefined;
}

/** D6: removes the checkouts of `dirs` whose owner is dead, and folders with no marker. */
export async function sweepCheckouts(options: SweepOptions): Promise<ListedCheckout[]> {
  return withCheckoutLock(
    options.commonDir,
    async () => {
      const swept: ListedCheckout[] = [];
      for (const listed of listCheckouts(options.dirs)) {
        const { marker, owner } = listed;
        if (marker !== null && owner !== "dead") continue;
        // A marker of another repository's checkout is left to that repository's sweep.
        if (marker !== null && marker.commonDir !== options.commonDir) continue;
        // Review wave-22 B1: a commit worktree loses only what Squeal made in its folder.
        // Review wave-22 N2: so does one whose tree a removal took, keeping what Squeal did not make.
        const commit =
          marker?.fingerprint === undefined
            ? null
            : (commitIdentity(listed.tree) ?? treelessCommitFolder(listed.folder, marker));
        if (commit !== null) await removeCommitFolder(commit, options.note);
        else await removeTree({ ...listed, commonDir: options.commonDir }, options.note);
        swept.push(listed);
      }
      return swept;
    },
    options.lockWaitMs,
  );
}

function entriesOf(dir: AbsolutePath): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    if (isMissing(error) || (error as NodeJS.ErrnoException).code === "ENOTDIR") return [];
    throw error;
  }
}
