import { runGit, splitNul } from "../fs/git.js";
import { listedDirectory } from "../keys/observed.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import type { FileHash } from "../types/keys.js";
import { LS_TREE_TIMEOUT_MS } from "./tree.js";

/*
 * Row 023-03 after fix A (row 023-13; re-review of wave 1 B1): a glob
 * (`import.meta.glob`, a template `import()`) reads its folder's file set,
 * not only the files the list names. Fix A keys a glob module's closure with
 * the folder's listing (`dir/`, from the shared `globListings.<project>`),
 * so equal blobs of the listed files no longer prove the target run:
 *
 * - a listed folder that holds, at the target, a name it does not hold here
 *   may give the target run a file the list lacks: unless the list holds it,
 *   the key is not determined;
 * - a module with a glob call that no walk recorded folders for has no
 *   listing in the list, and one that changed may glob other folders at the
 *   target: both leave the key not determined.
 */

/** A glob call in a module's text, as fix A's walk reads it. */
export const GLOB_CALL = /import\.meta\.glob(?:Eager)?\s*\(|\bimport\s*\(\s*`/;
/** `GLOB_CALL` as a POSIX extended expression, for `git grep -E`. */
const GLOB_CALL_ERE =
  "import\\.meta\\.glob(Eager)?[[:space:]]*\\(|import[[:space:]]*\\([[:space:]]*`";

/** Paths per git call. */
const CHUNK = 2_000;

/** The paths among `paths` whose file in this worktree holds a glob call (`git grep`). */
export async function globCallsHere(
  root: AbsolutePath,
  paths: Iterable<RelativePath>,
): Promise<Set<RelativePath>> {
  const files = [...new Set(paths)].filter((path) => listedDirectory(path) === null);
  const out = new Set<RelativePath>();
  for (let at = 0; at < files.length; at += CHUNK) {
    const specs = files.slice(at, at + CHUNK).map((path) => `:(literal)${path}`);
    const args = ["grep", "-l", "-z", "--untracked", "-E", "-e", GLOB_CALL_ERE, "--", ...specs];
    // Exit 1: no file matches.
    const listed = await runGit(root, args, { okCodes: [0, 1], timeoutMs: LS_TREE_TIMEOUT_MS });
    for (const path of splitNul(listed)) out.add(path);
  }
  return out;
}

/** Each directory's entry names: its files and the subdirectories that hold one. */
export function entryNames(paths: Iterable<RelativePath>): Map<RelativePath, Set<string>> {
  const names = new Map<RelativePath, Set<string>>();
  for (const path of paths) {
    let directory = "";
    for (const name of path.split("/")) {
      const held = names.get(directory) ?? new Set<string>();
      held.add(name);
      names.set(directory, held);
      directory = directory === "" ? name : `${directory}/${name}`;
    }
  }
  return names;
}

/**
 * Why a listed folder of `closure` may give the target run a file the list
 * lacks: a name the target's folder holds and this worktree's does not,
 * which the list does not hold as a file. `null` when there is none.
 */
export function listingGap(
  closure: readonly RelativePath[],
  list: ReadonlySet<RelativePath>,
  names: {
    readonly target: () => Map<RelativePath, Set<string>>;
    readonly here: () => Map<RelativePath, Set<string>>;
  },
): string | null {
  for (const path of closure) {
    const directory = listedDirectory(path);
    if (directory === null) continue;
    const there = names.target().get(directory) ?? new Set<string>();
    const ours = names.here().get(directory) ?? new Set<string>();
    for (const name of there) {
      if (ours.has(name)) continue;
      const entry = directory === "" ? name : `${directory}/${name}`;
      if (!list.has(entry))
        return `${entry} at the commit is in the listed folder ${path}, not in the list`;
    }
  }
  return null;
}

/** Lazily built entry names of the target's and this worktree's files. */
export function namesOf(
  blobs: ReadonlyMap<RelativePath, FileHash>,
  here: ReadonlyMap<RelativePath, FileHash>,
): {
  readonly target: () => Map<RelativePath, Set<string>>;
  readonly here: () => Map<RelativePath, Set<string>>;
} {
  let target: Map<RelativePath, Set<string>> | null = null;
  let ours: Map<RelativePath, Set<string>> | null = null;
  return {
    target: () => {
      target ??= entryNames(blobs.keys());
      return target;
    },
    here: () => {
      ours ??= entryNames(here.keys());
      return ours;
    },
  };
}
