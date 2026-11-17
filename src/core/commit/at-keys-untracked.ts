import { runGit, splitNul } from "../fs/git.js";
import { listedDirectory } from "../keys/observed.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import { LS_TREE_TIMEOUT_MS } from "./tree.js";

/*
 * Spec 023 D2.4: a closure path git does not hold in this worktree, an
 * untracked or ignored file, leaves the key at a commit not determined: the
 * commit says nothing of it. For a file path, any untracked or ignored entry
 * at it or above it. For a listing (`dir/`), an untracked entry directly in
 * the directory, which its names hold; an ignored one counts only when the
 * listed directory, or a folder above it, is ignored as a whole, as the
 * listing then reads names on disk.
 */

/** Paths per git call, so no command line grows past the system's limit. */
const CHUNK = 2_000;

/** Each of `paths` whose content here comes from a file git does not hold, by `git status`. */
export async function untrackedInputs(
  root: AbsolutePath,
  paths: Iterable<RelativePath>,
): Promise<Set<RelativePath>> {
  const all = [...new Set(paths)];
  const out = new Set<RelativePath>();
  for (let at = 0; at < all.length; at += CHUNK) {
    const chunk = all.slice(at, at + CHUNK);
    const entries = await statusEntries(root, chunk);
    for (const path of chunk) if (untrackedBy(path, entries)) out.add(path);
  }
  return out;
}

/** One `git status` entry outside the index. */
export interface StatusEntry {
  readonly path: RelativePath;
  readonly ignored: boolean;
}

/** Whether `entries` make `path` an untracked input. */
export function untrackedBy(path: RelativePath, entries: readonly StatusEntry[]): boolean {
  const directory = listedDirectory(path);
  if (directory === null) {
    return entries.some(
      (e) => e.path === path || (e.path.endsWith("/") && path.startsWith(e.path)),
    );
  }
  const prefix = directory === "" ? "" : `${directory}/`;
  return entries.some((e) => {
    if (prefix !== "" && e.path.endsWith("/") && prefix.startsWith(e.path)) return true;
    if (e.ignored || !e.path.startsWith(prefix)) return false;
    const rest = e.path.slice(prefix.length);
    const slash = rest.indexOf("/");
    return slash < 0 || slash === rest.length - 1;
  });
}

/** The untracked (`??`) and ignored (`!!`) entries `git status` gives for `paths`. */
async function statusEntries(
  root: AbsolutePath,
  paths: readonly RelativePath[],
): Promise<StatusEntry[]> {
  const specs = paths.map((path) => {
    const directory = listedDirectory(path);
    if (directory === null) return `:(literal)${path}`;
    return directory === "" ? ":/" : `:(literal)${directory}/`;
  });
  const args = [
    "status",
    "--porcelain=v1",
    "-z",
    "--ignored=traditional",
    "--untracked-files=normal",
    "--no-renames",
    "--",
    ...specs,
  ];
  const out = await runGit(root, args, { timeoutMs: LS_TREE_TIMEOUT_MS });
  const entries: StatusEntry[] = [];
  for (const record of splitNul(out)) {
    const code = record.slice(0, 2);
    if (code === "??" || code === "!!") {
      entries.push({ path: record.slice(3), ignored: code === "!!" });
    }
  }
  return entries;
}
