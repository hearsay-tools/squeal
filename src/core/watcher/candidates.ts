import type { Dirent, Stats } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import { dirname } from "node:path";
import { hasGitEntry, isMissing, mapConcurrent, toAbsolute, toRelative } from "../fs/index.js";
import type { AbsolutePath, CandidatePath, FileStat, RelativePath } from "../types/index.js";
import type { Exclusions } from "./exclusions.js";
import { checkIgnored, ignoredLinks } from "./git.js";
import { isLinkedDir, SymlinkProbe } from "./links.js";
import { isGitMetadata, selfAndAncestors } from "./paths.js";

/** What the assembly needs to know about the worktree at the time of one batch. */
export interface CandidateContext {
  readonly root: AbsolutePath;
  readonly exclusions: Exclusions;
  /** Relative extra files: ignored, but watched because a closure references them. */
  readonly extraFiles: ReadonlySet<RelativePath>;
  /** The caller's tracked paths (the stat cache). Read only when a batch needs it. */
  readonly trackedPaths: () => Iterable<RelativePath>;
}

export interface HintCandidates {
  readonly paths: CandidatePath[];
  /** Directories that appeared and are ignored: the watch spec should exclude them. */
  readonly ignoredDirs: RelativePath[];
  /** Paths of the batch that are symlinks to directories below the root. */
  readonly linkedDirs: RelativePath[];
}

export interface ReconcileCandidates {
  readonly paths: CandidatePath[];
  /** Symlinked directories observed like project directories, with the realpath of each target. */
  readonly linkedDirs: ReadonlyMap<RelativePath, AbsolutePath>;
  /** Every symlinked directory among the candidates, observed or not, with its target's realpath. */
  readonly links: ReadonlyMap<RelativePath, AbsolutePath>;
}

/**
 * Turns the paths of one debounced batch into candidates.
 *
 * Paths under `.git`, under an excluded path, or inside a nested repository
 * are dropped. The rest go through one `git check-ignore`. A surviving
 * directory is expanded into the files under it, which go through a second
 * `check-ignore` when there are any; the hint itself said nothing about them.
 * A path that no longer exists is reported with a `null` stat, together with
 * every tracked path under it, so a deleted or renamed-away directory reports
 * the files that went with it.
 */
export async function candidatesFromHints(
  ctx: CandidateContext,
  absPaths: Iterable<AbsolutePath>,
): Promise<HintCandidates> {
  const nested = new NestedRepoProbe(ctx.root);
  const relPaths = new Set<RelativePath>();
  for (const abs of absPaths) {
    const rel = toRelative(ctx.root, abs);
    if (rel === null || isGitMetadata(rel) || ctx.exclusions.excludes(abs)) continue;
    relPaths.add(rel);
  }
  const kept: RelativePath[] = [];
  for (const rel of relPaths) {
    if (!(await nested.isInside(rel))) kept.push(rel);
  }

  const ignored = await checkIgnored(
    ctx.root,
    kept.filter((p) => !ctx.extraFiles.has(p)),
  );
  const out = new Map<RelativePath, FileStat | null>();
  const ignoredDirs: RelativePath[] = [];
  const linkedDirs: RelativePath[] = [];
  const walked: RelativePath[] = [];
  let tracked: Set<RelativePath> | null = null;
  const trackedSet = () => {
    tracked ??= new Set(ctx.trackedPaths());
    return tracked;
  };

  for (const rel of kept) {
    const stats = await lstatOrNull(toAbsolute(ctx.root, rel));
    if (stats?.isDirectory()) {
      if (ignored.has(rel)) ignoredDirs.push(rel);
      else {
        if (trackedSet().has(rel)) out.set(rel, null);
        walked.push(...(await walkFiles(ctx, nested, rel)));
      }
      continue;
    }
    if (stats?.isSymbolicLink() && (await isLinkedDir(toAbsolute(ctx.root, rel)))) {
      linkedDirs.push(rel);
    }
    if (ignored.has(rel)) continue;
    out.set(rel, stats ? toFileStat(stats) : null);
    if (!stats) {
      for (const path of trackedSet()) {
        if (path.startsWith(`${rel}/`)) out.set(path, null);
      }
    }
  }

  const walkedIgnored = await checkIgnored(
    ctx.root,
    walked.filter((p) => !ctx.extraFiles.has(p)),
  );
  for (const rel of walked) {
    if (!walkedIgnored.has(rel)) out.set(rel, await statOrNull(ctx.root, rel));
  }
  // A path under a deleted directory may have reappeared since; re-stat it.
  for (const [rel, stat] of out) {
    if (stat === null) out.set(rel, await statOrNull(ctx.root, rel));
  }
  return { paths: sortCandidates(out), ignoredDirs, linkedDirs };
}

/**
 * Candidates for a reconciliation pass: what git status reports plus every
 * tracked path and extra file, re-stat'ed, plus every file under a symlinked
 * directory among them that git does not ignore, which git never lists. Only
 * `.git` metadata and paths inside nested repositories are dropped; git
 * status already leaves ignored files out, and the caller's tracked paths are
 * trusted.
 *
 * Spec 001 D2: "`git status --porcelain` plus a re-stat of every file in the
 * hash cache."
 */
export async function candidatesForReconcile(
  ctx: CandidateContext,
  statusPaths: Iterable<RelativePath>,
): Promise<ReconcileCandidates> {
  const nested = new NestedRepoProbe(ctx.root);
  const all = new Set<RelativePath>([...statusPaths, ...ctx.trackedPaths(), ...ctx.extraFiles]);
  const paths = [...all].filter((rel) => !isGitMetadata(rel));
  const stats = await mapConcurrent(paths, async (rel) => {
    const stats = await lstatOrNull(toAbsolute(ctx.root, rel));
    // Only a directory can hold a `.git` entry itself; for anything else, probe the ones above it.
    const probe = stats?.isDirectory() ? rel : parentDir(rel);
    if (probe !== null && (await nested.isInside(probe))) return undefined;
    return stats && !stats.isDirectory() ? toFileStat(stats) : null;
  });
  const out = new Map<RelativePath, FileStat | null>();
  paths.forEach((rel, i) => {
    const stat = stats[i];
    if (stat !== undefined) out.set(rel, stat);
  });
  const links = await topLinks(ctx.root, [...out.keys()]);
  const linkedDirs = await observedLinks(ctx, links);
  for (const link of linkedDirs.keys()) {
    for (const rel of await walkFiles(ctx, nested, link)) {
      out.set(rel, await statOrNull(ctx.root, rel));
    }
  }
  return { paths: sortCandidates(out), linkedDirs, links };
}

/** The symlinked directories among `paths` below the root and beyond no other link, with each target's realpath. */
async function topLinks(
  root: AbsolutePath,
  paths: readonly RelativePath[],
): Promise<Map<RelativePath, AbsolutePath>> {
  const probe = new SymlinkProbe(root);
  const links = new Map<RelativePath, AbsolutePath>();
  for (const rel of paths) {
    const abs = toAbsolute(root, rel);
    if (!(await isLinkedDir(abs)) || (await probe.linkAbove(rel)) !== null) continue;
    const target = await realpath(abs).catch(() => null);
    if (target !== null) links.set(rel, target);
  }
  return links;
}

/**
 * The links among `links` observed like project directories: git ignores
 * neither the link nor a directory at its path, the target is not in another
 * repository, and the target is neither the root nor a directory above it.
 * Links inside a target are not followed, so no walk loops.
 */
async function observedLinks(
  ctx: CandidateContext,
  links: ReadonlyMap<RelativePath, AbsolutePath>,
): Promise<Map<RelativePath, AbsolutePath>> {
  const observed = new Map<RelativePath, AbsolutePath>();
  for (const [rel, target] of links) {
    if (holdsRoot(ctx.root, target)) continue;
    if (!(await inOtherRepository(ctx.root, target))) observed.set(rel, target);
  }
  for (const link of await ignoredLinks(ctx.root, [...observed.keys()])) observed.delete(link);
  return observed;
}

/**
 * True when `target`, or a directory above it that does not also hold the
 * root, has a `.git` entry: the target belongs to a repository other than
 * the root's, at that repository's root or below it, whether that repository
 * is nested in this worktree or outside it. A repository enclosing both the
 * root and the target is not another one, so an ordinary directory beside a
 * worktree that lives inside a checkout is still observed.
 */
export async function inOtherRepository(
  root: AbsolutePath,
  target: AbsolutePath,
): Promise<boolean> {
  for (let dir = target; !holdsRoot(root, dir); dir = dirname(dir)) {
    if (await hasGitEntry(dir)) return true;
  }
  return false;
}

/** True when `dir` is the root or a directory above it. */
export function holdsRoot(root: AbsolutePath, dir: AbsolutePath): boolean {
  return root === dir || root.startsWith(dir.endsWith("/") ? dir : `${dir}/`);
}

/** Caches "does this directory hold a `.git` entry" for one batch. */
class NestedRepoProbe {
  private readonly cache = new Map<RelativePath, Promise<boolean>>();

  constructor(private readonly root: AbsolutePath) {}

  /** True when `rel`, or a directory above it below the root, holds a `.git` entry. */
  async isInside(rel: RelativePath): Promise<boolean> {
    for (const dir of selfAndAncestors(rel)) {
      let hit = this.cache.get(dir);
      if (!hit) {
        hit = hasGitEntry(toAbsolute(this.root, dir));
        this.cache.set(dir, hit);
      }
      if (await hit) return true;
    }
    return false;
  }
}

/** Files and symlinks under `dir`, skipping `.git`, excluded paths and nested repositories. */
async function walkFiles(
  ctx: CandidateContext,
  nested: NestedRepoProbe,
  dir: RelativePath,
): Promise<RelativePath[]> {
  const files: RelativePath[] = [];
  const pending = [dir];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    let entries: Dirent[];
    try {
      entries = await readdir(toAbsolute(ctx.root, next), { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const rel = `${next}/${entry.name}`;
      if (ctx.exclusions.excludes(toAbsolute(ctx.root, rel))) continue;
      if (entry.isDirectory()) {
        if (!(await nested.isInside(rel))) pending.push(rel);
      } else {
        files.push(rel);
      }
    }
  }
  return files;
}

async function lstatOrNull(abs: AbsolutePath): Promise<Stats | null> {
  try {
    return await lstat(abs);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/** `lstat` of a file or symlink; `null` when nothing, or a directory, is at the path. */
async function statOrNull(root: AbsolutePath, rel: RelativePath): Promise<FileStat | null> {
  const stats = await lstatOrNull(toAbsolute(root, rel));
  return stats && !stats.isDirectory() ? toFileStat(stats) : null;
}

function parentDir(rel: RelativePath): RelativePath | null {
  const slash = rel.lastIndexOf("/");
  return slash < 0 ? null : rel.slice(0, slash);
}

function toFileStat(stats: Stats): FileStat {
  return { mtimeMs: stats.mtimeMs, ctimeMs: stats.ctimeMs, size: stats.size, inode: stats.ino };
}

function sortCandidates(map: Map<RelativePath, FileStat | null>): CandidatePath[] {
  return [...map.keys()].sort().map((path) => ({ path, stat: map.get(path) ?? null }));
}
