import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runGit, splitNul } from "../fs/git.js";
import { isRecord } from "../fs/json.js";
import { createDeclaredInputs } from "../keys/closure.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import type { Policy } from "../types/policy.js";
import type { CommitSide, Difference } from "./at-keys-fast.js";
import { committedBlobs, LS_TREE_TIMEOUT_MS } from "./tree.js";

/*
 * Spec 023 D2 as amended (row 023-16): what the fast path compares, read
 * from git: the commit's tree, this worktree's files as they are now (a
 * dirty tree included), and what differs between them.
 */

/** The fields of a `package.json` that steer module resolution (`keys-by-walk.md` 4, condition 7). */
const RESOLUTION_FIELDS = ["imports", "exports", "main", "module", "browser", "type", "name"];

/** The commit's blobs and entry names. */
export async function commitSide(root: AbsolutePath, commit: string): Promise<CommitSide> {
  const blobs = await committedBlobs(root, commit);
  return { blobs, names: entryNames(blobs.keys()) };
}

/**
 * Each folder's entry names of the files in this worktree that git does not
 * ignore and that are present: tracked files, less those deleted, and
 * untracked ones. A listing's key reads these names (`Listings`).
 */
export async function hereNames(root: AbsolutePath): Promise<Map<RelativePath, Set<string>>> {
  const list = async (args: string[]) =>
    splitNul(await runGit(root, ["ls-files", "-z", ...args], { timeoutMs: LS_TREE_TIMEOUT_MS }));
  const deleted = new Set(await list(["--deleted"]));
  const tracked = (await list(["--cached"])).filter((path) => !deleted.has(path));
  const untracked = await list(["--others", "--exclude-standard"]);
  return entryNames([...tracked, ...untracked]);
}

/**
 * What differs between `commit` and this worktree now, under the worktree's
 * `policy`, with `files` the commit's: its declared inputs are matched there.
 */
export async function differenceAt(
  root: AbsolutePath,
  commit: string,
  policy: Policy,
  files: Iterable<RelativePath>,
): Promise<Difference> {
  const args = ["diff", "--name-status", "--no-renames", "-z", commit, "--"];
  const fields = splitNul(await runGit(root, args, { timeoutMs: LS_TREE_TIMEOUT_MS }));
  const changed = new Set<RelativePath>();
  const addedOrDeleted = new Set<RelativePath>();
  for (let at = 0; at + 1 < fields.length; at += 2) {
    const [status, path] = [fields[at] as string, fields[at + 1] as RelativePath];
    changed.add(path);
    if (status !== "M" && status !== "T") addedOrDeleted.add(path);
  }
  const others = ["ls-files", "-z", "--others", "--exclude-standard"];
  for (const path of splitNul(await runGit(root, others, { timeoutMs: LS_TREE_TIMEOUT_MS }))) {
    changed.add(path);
    addedOrDeleted.add(path);
  }
  const manifests = new Set<RelativePath>();
  for (const path of changed) {
    if (!/(^|\/)package\.json$/.test(path)) continue;
    if (await resolutionDiffers(root, commit, path)) manifests.add(path);
  }
  return {
    changed,
    addedOrDeleted,
    manifests,
    declared: createDeclaredInputs(policy.inputs, files).for,
  };
}

/** Each folder's entry names: its files and the subfolders that hold one. */
export function entryNames(paths: Iterable<RelativePath>): Map<RelativePath, Set<string>> {
  const names = new Map<RelativePath, Set<string>>();
  for (const path of paths) {
    let folder = "";
    for (const name of path.split("/")) {
      const held = names.get(folder) ?? new Set<string>();
      held.add(name);
      names.set(folder, held);
      folder = folder === "" ? name : `${folder}/${name}`;
    }
  }
  return names;
}

/** Whether the manifest at `path` steers resolution otherwise at `commit` than on disk now. */
async function resolutionDiffers(
  root: AbsolutePath,
  commit: string,
  path: RelativePath,
): Promise<boolean> {
  const there = parsed(
    await runGit(root, ["show", `${commit}:${path}`], {
      okCodes: [0, 128],
      timeoutMs: LS_TREE_TIMEOUT_MS,
    }),
  );
  let here: Record<string, unknown> | null;
  try {
    here = parsed(readFileSync(join(root, path), "utf8"));
  } catch {
    here = null;
  }
  if (there === null || here === null) return true;
  return RESOLUTION_FIELDS.some((f) => JSON.stringify(there[f]) !== JSON.stringify(here[f]));
}

function parsed(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}
