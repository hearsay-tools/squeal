import { posix } from "node:path";
import { runGit, splitNul } from "../fs/git.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import type { FileHash } from "../types/keys.js";
import { LS_TREE_TIMEOUT_MS, lsTreeArgs } from "./tree.js";

/*
 * Spec 023 D4.9 (row 023-48, round 6 V1): which paths git holds at a
 * commit, a path under a tracked symlink included. `git ls-tree` lists a
 * tracked directory symlink as one blob (mode 120000) and nothing under
 * it, so `.agents/skills/a/SKILL.md` read through the link
 * `.agents/skills/a -> ../../.ai/skills/a` is in no listing, though the
 * commit holds it as `.ai/skills/a/SKILL.md`. The link is resolved at the
 * commit's tree, from the link's own blob: a target that leaves the
 * repository, an absolute one, or one the commit does not hold is not held.
 * Components resolve in file-system order, so `bridge/..` first follows
 * `bridge` (review 0.1.599 B1).
 */

/** A commit's tree as D4.9 reads it. */
export interface HeldTree {
  /** Each blob the commit lists, by path (`committedBlobs`). */
  readonly blobs: ReadonlyMap<RelativePath, FileHash>;
  /** Whether the commit holds `path`, as listed or through its tracked symlinks. */
  readonly has: (path: RelativePath) => boolean;
}

/** Bounds a chain of links, so a loop reads as not held. */
const MAX_HOPS = 40;
const SYMLINK_MODE = "120000";

/** The tree `commit` holds in `root`'s repository, its symlinks resolved. */
export async function heldAt(
  root: AbsolutePath,
  commit: string,
  timeoutMs = LS_TREE_TIMEOUT_MS,
): Promise<HeldTree> {
  const by = Date.now() + timeoutMs;
  const out = await runGit(root, lsTreeArgs(commit), { timeoutMs });
  const blobs = new Map<RelativePath, FileHash>();
  const linkBlobs = new Map<RelativePath, string>();
  for (const entry of splitNul(out)) {
    // `<mode> SP <type> SP <object> TAB <path>`
    const tab = entry.indexOf("\t");
    const [mode, type, object] = entry.slice(0, tab).split(" ");
    if (tab <= 0 || type !== "blob" || object === undefined) continue;
    const path = entry.slice(tab + 1);
    blobs.set(path, object);
    if (mode === SYMLINK_MODE) linkBlobs.set(path, object);
  }
  // Both git reads end by `timeoutMs` together (row 023-42, review 0.1.597 B3).
  const left = Math.max(1, by - Date.now());
  const links = linkBlobs.size === 0 ? new Map() : await targets(root, linkBlobs, left);
  let folders: Set<RelativePath> | undefined;
  const foldersOnce = () => {
    folders ??= foldersOf(blobs);
    return folders;
  };
  return { blobs, has: (path) => holds(blobs, links, foldersOnce, path) };
}

/** Each link's target text, read from its blob with one `git cat-file --batch`. */
async function targets(
  root: AbsolutePath,
  links: ReadonlyMap<RelativePath, string>,
  timeoutMs: number,
): Promise<Map<RelativePath, string>> {
  const objects = [...new Set(links.values())];
  const out = await runGit(root, ["cat-file", "--batch"], {
    input: `${objects.join("\n")}\n`,
    timeoutMs,
  });
  const texts = parseBatch(Buffer.from(out, "utf8"));
  const byPath = new Map<RelativePath, string>();
  for (const [path, object] of links) {
    const text = texts.get(object);
    if (text !== undefined) byPath.set(path, text);
  }
  return byPath;
}

/** `git cat-file --batch` output: `<object> SP <type> SP <size> LF <content> LF`, repeated. */
export function parseBatch(out: Buffer): Map<string, string> {
  const texts = new Map<string, string>();
  let at = 0;
  while (at < out.length) {
    const end = out.indexOf(0x0a, at);
    if (end < 0) break;
    const [object, type, size] = out.subarray(at, end).toString("utf8").split(" ");
    const bytes = Number(size);
    if (object === undefined || type === "missing" || !Number.isInteger(bytes)) {
      at = end + 1;
      continue;
    }
    texts.set(object, out.subarray(end + 1, end + 1 + bytes).toString("utf8"));
    at = end + 1 + bytes + 1;
  }
  return texts;
}

/**
 * Whether `path` is listed, or reaches a listed blob inside the repository,
 * resolved one component at a time in file-system order (review 0.1.599 B1):
 * a tracked link on the way is replaced by its target, read relative to the
 * link's folder, before any `..` after it applies. Not held: a `..` past the
 * root, an absolute target, a component before more components that is no
 * folder of the commit (missing, a file, or a link that resolves to neither),
 * or more than `MAX_HOPS` links. The last component, a link included, is held
 * when the commit lists it.
 */
function holds(
  blobs: ReadonlyMap<RelativePath, FileHash>,
  links: ReadonlyMap<RelativePath, string>,
  folders: () => ReadonlySet<RelativePath>,
  path: RelativePath,
): boolean {
  if (blobs.has(path)) return true;
  if (links.size === 0 || posix.isAbsolute(path)) return false;
  const pending = path.split("/");
  const resolved: string[] = [];
  let hops = 0;
  while (pending.length > 0) {
    const part = pending.shift() as string;
    const last = pending.length === 0;
    if (part === "" || part === ".") {
      if (last) return false; // `dir/` or `dir/.`: a folder, never a blob
      continue;
    }
    if (part === "..") {
      if (resolved.length === 0) return false; // leaves the repository
      resolved.pop();
      if (last) return false;
      continue;
    }
    const at = [...resolved, part].join("/");
    if (last && blobs.has(at)) return true;
    const target = links.get(at);
    if (target !== undefined) {
      hops += 1;
      if (hops > MAX_HOPS || target === "" || posix.isAbsolute(target)) return false;
      pending.unshift(...target.split("/"));
      continue;
    }
    if (last || !folders().has(at)) return false;
    resolved.push(part);
  }
  return false;
}

/** Each folder the commit lists a blob under. */
function foldersOf(blobs: ReadonlyMap<RelativePath, FileHash>): Set<RelativePath> {
  const folders = new Set<RelativePath>();
  for (const path of blobs.keys()) {
    for (let at = path.lastIndexOf("/"); at > 0; at = path.lastIndexOf("/", at - 1)) {
      const folder = path.slice(0, at);
      if (folders.has(folder)) break;
      folders.add(folder);
    }
  }
  return folders;
}
