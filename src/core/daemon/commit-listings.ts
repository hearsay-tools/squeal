import { readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { listedDirectory } from "../keys/observed.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import type { FileHash } from "../types/keys.js";

/*
 * Row 023-64 (spec 023 D4.9 in the commit daemon; dogfood round 8 X1; the
 * coordinator chose "A", request 8e1fb238): a folder read, a listing path
 * (`dir/`, `./` for the root), is held at the commit when the commit
 * worktree lists on disk exactly the names the commit tracks in that folder.
 * A listing's key hashes the tracked names only (`Listings.hashOf`), so a
 * result from a listing with more names (ignored, untracked, written by the
 * install) would stand for the commit's (review 0.1.597 B1); when the names
 * on disk equal the tracked ones, the commit daemon's own run reads the
 * commit's listing. The folder resolves through links on disk (`realpath`)
 * and must stay inside the worktree. It resolves name by name, so a `..`
 * after a link steps out of the link's target, as the file system reads it,
 * not out of the link's spelling (review 0.1.610 S1).
 */

/** Whether the commit worktree `root` lists `listing` as the commit `blobs` track it. */
export type ListingHeld = (listing: RelativePath) => boolean;

/** `ListingHeld` over the worktree `root` at the commit whose blobs are `blobs`. */
export function listingsHeld(
  root: AbsolutePath,
  blobs: ReadonlyMap<RelativePath, FileHash>,
): ListingHeld {
  let tracked: Map<RelativePath, Set<string>> | undefined;
  let top: string | null | undefined;
  return (listing) => {
    const directory = listedDirectory(listing);
    if (directory === null) return false;
    top ??= real(root);
    const at = top === null ? null : walk(top, directory);
    if (top === null || at === null) return false;
    const inside = relative(top, at);
    if (inside.startsWith("..") || isAbsolute(inside)) return false;
    tracked ??= namesOf(blobs);
    const names = tracked.get(inside.split(sep).join("/"));
    if (names === undefined) return false;
    let onDisk: string[];
    try {
      onDisk = readdirSync(at);
    } catch {
      return false;
    }
    return onDisk.length === names.size && onDisk.every((name) => names.has(name));
  };
}

/** `directory` under the real folder `top`, one name at a time, each step resolved on disk. */
function walk(top: string, directory: string): string | null {
  let at = top;
  for (const name of directory.split("/")) {
    if (name === "" || name === ".") continue;
    const next = name === ".." ? dirname(at) : real(join(at, name));
    if (next === null) return null;
    at = next;
  }
  return at;
}

function real(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/** Per folder, `""` the root, the names of its blobs and of its subfolders that hold one. */
function namesOf(blobs: ReadonlyMap<RelativePath, FileHash>): Map<RelativePath, Set<string>> {
  const out = new Map<RelativePath, Set<string>>();
  for (const path of blobs.keys()) {
    let folder = "";
    for (const name of path.split("/")) {
      const names = out.get(folder) ?? new Set<string>();
      names.add(name);
      out.set(folder, names);
      folder = folder === "" ? name : `${folder}/${name}`;
    }
  }
  return out;
}
