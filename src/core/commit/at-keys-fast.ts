import { posix } from "node:path";
import { POLICY_FILE } from "../daemon/policy.js";
import { createInputMatcher } from "../keys/glob.js";
import { listedDirectory } from "../keys/observed.js";
import type { RelativePath } from "../types/common.js";
import type { FileHash } from "../types/keys.js";

/*
 * Spec 023 D2 as amended 2026-11-17 (row 023-16): the fast path. A test
 * file whose every key input is unchanged at the commit keeps its current
 * key, with no checkout. It computes no key at the commit: it checks the
 * premise a daemon restart relies on, that equal inputs import the same
 * files (`research/keys-by-walk.md` 4, its nine conditions). Every check
 * compares the commit's tree with this worktree's files as they are now, so
 * a dirty tree is compared by its current hashes, not by `HEAD`.
 */

/** The current key's inputs of one test file: `WorktreeKeys.stabilityPaths`. */
export interface CurrentInputs {
  readonly path: RelativePath;
  readonly paths: readonly RelativePath[];
}

/** The commit, from git objects. */
export interface CommitSide {
  /** Each file's blob (`committedBlobs`). */
  readonly blobs: ReadonlyMap<RelativePath, FileHash>;
  /** Each folder's entry names (`entryNames` of `blobs`). */
  readonly names: ReadonlyMap<RelativePath, ReadonlySet<string>>;
}

/** This worktree, as it is now. */
export interface HereSide {
  /** The stat cache's hash: `null` known absent, `undefined` unknown. */
  readonly hashOf: (path: RelativePath) => FileHash | null | undefined;
  /** Each folder's entry names, of the files present that git does not ignore. */
  readonly names: ReadonlyMap<RelativePath, ReadonlySet<string>>;
  /** Inputs read from a file git does not hold (`untrackedInputs`). */
  readonly untracked: ReadonlySet<RelativePath>;
}

/** What differs between the commit and this worktree. */
export interface Difference {
  /** Every path whose file differs, untracked files included. */
  readonly changed: ReadonlySet<RelativePath>;
  /** The changed paths that one side holds and the other does not. */
  readonly addedOrDeleted: ReadonlySet<RelativePath>;
  /** Changed `package.json` files whose resolution fields differ, or that one side lacks. */
  readonly manifests: ReadonlySet<RelativePath>;
  /** Whether a changed path is a declared input (`inputs` of the policy). */
  readonly declared: (path: RelativePath) => boolean;
}

/** Installed lockfiles and the committed lockfile each one is installed from. */
const INSTALLED: readonly { readonly installed: RegExp; readonly committed: string }[] = [
  { installed: /(^|\/)node_modules\/\.pnpm\/lock\.yaml$/, committed: "pnpm-lock.yaml" },
  { installed: /(^|\/)node_modules\/\.package-lock\.json$/, committed: "package-lock.json" },
];

/** A path that names files by pattern, not one file. */
const PATTERN = /[*?{[]/;
const MODULE = /\.[cm]?[jt]sx?$/;
const TSCONFIG = /(^|\/)tsconfig[^/]*\.json$/;
const MANIFEST = /(^|\/)package\.json$/;

/** The committed lockfile an installed one is installed from, or `null` for any other path. */
export function committedLockfile(path: RelativePath): RelativePath | null {
  for (const { installed, committed } of INSTALLED) {
    const found = installed.exec(path);
    if (found !== null) return `${path.slice(0, found.index)}${found[1]}${committed}`;
  }
  return null;
}

/**
 * Why `file` may not keep its current key at the commit: the first of the
 * nine conditions it fails, as a short reason; `null` when it keeps it.
 */
export function changedInput(
  file: CurrentInputs,
  commit: CommitSide,
  here: HereSide,
  diff: Difference,
): string | null {
  if (!commit.blobs.has(file.path)) return `${file.path} is absent at the commit`;
  const modules = new Set<string>();
  const folders = new Set<RelativePath>();
  for (const path of file.paths) {
    const why = inputChanged(path, commit, here, diff);
    if (why !== null) return why;
    if (listedDirectory(path) === null && !PATTERN.test(path)) {
      folders.add(folderOf(path));
      if (MODULE.test(path)) modules.add(`${folderOf(path)}\0${stem(path)}`);
    }
  }
  const inputs = new Set(file.paths);
  for (const path of diff.changed) {
    // The policy steers declared inputs and the environment's variables: its change moves keys
    // through paths the current inputs do not list.
    if (path === POLICY_FILE) return `${path} changed`;
    // 4: a changed path a declared pattern of the policy names.
    if (diff.declared(path)) return `${path} is a declared input and changed`;
    // 6: an added or deleted twin of an input module, which resolution may take instead.
    const twin = `${folderOf(path)}\0${stem(path)}`;
    if (diff.addedOrDeleted.has(path) && modules.has(twin) && !inputs.has(path))
      return `${path} was added or deleted beside an input module of the same name`;
    // 7, 8: a manifest's resolution fields, or a tsconfig, on the inputs' path.
    const onPath = (MANIFEST.test(path) && diff.manifests.has(path)) || TSCONFIG.test(path);
    if (onPath && above(folderOf(path), folders))
      return `${path} changed on the resolution path of the inputs`;
  }
  return null;
}

/** Conditions 1, 2, 3, 4, 5 and 9 for one input path. */
function inputChanged(
  path: RelativePath,
  commit: CommitSide,
  here: HereSide,
  diff: Difference,
): string | null {
  // 4: a pattern input, matched against every changed path.
  if (PATTERN.test(path)) {
    const matches = createInputMatcher([path]);
    for (const changed of diff.changed) {
      if (matches(changed)) return `${changed} matches the input pattern ${path}`;
    }
    return null;
  }
  // 5: an installed lockfile stands for its committed lockfile.
  const lockfile = committedLockfile(path);
  if (lockfile !== null) {
    const hash = here.hashOf(lockfile);
    if (typeof hash !== "string" || commit.blobs.get(lockfile) !== hash)
      return `${lockfile} differs at the commit`;
    return null;
  }
  // 9: an input git does not hold here says nothing of the commit.
  if (here.untracked.has(path)) return `${path} is not held by git here`;
  // 3: a listing holds the same entry names.
  const folder = listedDirectory(path);
  if (folder !== null) {
    const ours = here.names.get(folder);
    const theirs = commit.names.get(folder);
    if (ours === undefined || theirs === undefined || !sameNames(ours, theirs))
      return `${path} lists other names at the commit`;
    return null;
  }
  const hash = here.hashOf(path);
  if (hash === undefined) return `${path} has no hash here`;
  // 2: a path absent here (a resolution candidate) stays absent, as a file and as a folder.
  if (hash === null) {
    if (commit.blobs.has(path) || commit.names.has(path)) return `${path} exists at the commit`;
    return null;
  }
  // 1: the same blob.
  if (commit.blobs.get(path) !== hash) return `${path} differs at the commit`;
  return null;
}

/** Whether `folder` is `""`, or one of `folders` or a folder above one. */
function above(folder: RelativePath, folders: ReadonlySet<RelativePath>): boolean {
  if (folder === "") return true;
  for (const f of folders) if (f === folder || f.startsWith(`${folder}/`)) return true;
  return false;
}

function folderOf(path: RelativePath): RelativePath {
  const folder = posix.dirname(path);
  return folder === "." ? "" : folder;
}

function stem(path: RelativePath): string {
  return posix.basename(path).replace(/\.[^.]+$/, "");
}

function sameNames(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size === 0 || a.size !== b.size) return false;
  for (const name of a) if (!b.has(name)) return false;
  return true;
}
