import type { Dirent } from "node:fs";
import { readdir, realpath } from "node:fs/promises";
import {
  hasGitEntry,
  isMissing,
  mapConcurrent,
  runGit,
  splitNul,
  toAbsolute,
} from "../fs/index.js";
import type { AbsolutePath, RelativePath } from "../types/index.js";
import { holdsRoot, inOtherRepository } from "../watcher/candidates.js";
import { ignoredLinks } from "../watcher/git.js";
import { isLinkedDir, SymlinkProbe } from "../watcher/links.js";
import { selfAndAncestors } from "../watcher/paths.js";
import { createInputMatcher } from "./glob.js";

/** Installed packages enter keys through the environment hash (D3), never as declared inputs. */
const INSTALLED = ":(exclude,glob)**/node_modules/**";

/**
 * The gitignored files under `root` that policy input `globs` select, sorted:
 * a build output a declaration names, which no tracked file stands for
 * (spec 004 D6, lessons defect 7). Git walks only the literal directory each
 * glob starts with; a glob that starts with a wildcard walks the worktree.
 * Nothing under a `node_modules` directory is returned.
 *
 * Git lists a symlinked directory as one entry and never what is beyond it,
 * so the files beyond an ignored link the globs select are found by walking
 * the link, under the paths the declaration names (`dist -> real-build`
 * gives `dist/index.js`; reviews/wave-4.md B3).
 */
export async function ignoredInputs(
  root: AbsolutePath,
  globs: readonly string[],
): Promise<RelativePath[]> {
  if (globs.length === 0) return [];
  const prefixes = [...new Set(globs.map(literalPrefix))];
  const pathspecs = prefixes.includes("") ? ["."] : prefixes.map((p) => `:(literal)${p}`);
  const list = async (ignored: boolean) =>
    splitNul(
      await runGit(root, [
        "ls-files",
        "-z",
        "--others",
        ...(ignored ? ["--ignored"] : []),
        "--exclude-standard",
        "--",
        ...pathspecs,
        INSTALLED,
      ]),
    );
  const listed = await list(true);
  const matches = createInputMatcher(globs);
  const links = await linkedDirs(root, [
    ...listed,
    // A link git ignores only as a directory (`dist/`) is listed as not ignored.
    ...(await list(false)),
    // A link at or above a glob's literal part, which git refuses to list beyond.
    ...prefixes.flatMap((prefix) => (prefix === "" ? [] : [...selfAndAncestors(prefix)])),
  ]);
  const files = listed.filter((path) => !links.has(path));
  for (const link of links) files.push(...(await filesBeyond(root, link)));
  return [...new Set(files.filter((path) => matches(path) && !installed(path)))].sort();
}

/** The leading segments of `glob` that hold no wildcard, joined; `""` when the first one does. */
export function literalPrefix(glob: string): string {
  const segments = (glob.startsWith("./") ? glob.slice(2) : glob).split("/");
  const wild = segments.findIndex((segment) => /[*?[{]/.test(segment));
  return (wild === -1 ? segments : segments.slice(0, wild)).join("/");
}

/**
 * Among `paths`, the symlinked directories whose files `checkIgnored` counts
 * as ignored, beyond no other link and outside `node_modules`, with the
 * watcher's limits: no target holding the root, so no walk loops, and none
 * in another repository.
 */
async function linkedDirs(
  root: AbsolutePath,
  paths: readonly RelativePath[],
): Promise<Set<RelativePath>> {
  const resolvedRoot = await realpath(root);
  const probe = new SymlinkProbe(root);
  const candidates = [...new Set(paths)].filter((path) => !installed(path));
  const kept = await mapConcurrent(candidates, async (path) => {
    const abs = toAbsolute(root, path);
    if (!(await isLinkedDir(abs)) || (await probe.linkAbove(path)) !== null) return null;
    const target = await realpath(abs).catch(() => null);
    if (target === null || holdsRoot(resolvedRoot, target)) return null;
    return (await inOtherRepository(resolvedRoot, target)) ? null : path;
  });
  const links = kept.filter((path): path is RelativePath => path !== null);
  return ignoredLinks(root, links);
}

/**
 * The files under the linked directory `link`, by worktree-relative paths
 * through it. Links within are not followed and count as files only when
 * their target is not a directory; `.git`, `node_modules` and nested
 * repositories are skipped.
 */
async function filesBeyond(root: AbsolutePath, link: RelativePath): Promise<RelativePath[]> {
  const files: RelativePath[] = [];
  const pending = [link];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    let entries: Dirent[];
    try {
      entries = await readdir(toAbsolute(root, next), { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const rel = `${next}/${entry.name}`;
      const abs = toAbsolute(root, rel);
      if (entry.isDirectory()) {
        if (!(await hasGitEntry(abs))) pending.push(rel);
      } else if (entry.isFile() || (entry.isSymbolicLink() && !(await isLinkedDir(abs)))) {
        files.push(rel);
      }
    }
  }
  return files;
}

function installed(path: RelativePath): boolean {
  return path.split("/").includes("node_modules");
}
