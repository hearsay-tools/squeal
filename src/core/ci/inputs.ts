import { createHash } from "node:crypto";
import { type Dirent, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { compare } from "../fs/compare.js";
import { runGit, splitNul } from "../fs/git.js";
import type { Hasher } from "../hash/hasher.js";
import {
  ABSENT_LISTING,
  GIT_ENTRY,
  listedDirectory,
  listingPath,
  namesHash,
} from "../keys/observed.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import type { FileHash } from "../types/keys.js";
import type { PartFile, PartObserved } from "./parts.js";

/*
 * Spec 018 D8 and D9 (2026-11-09, review of 0.1.421 B1): the evidence that
 * ties a shard's result to content. `squeal ci record` hashes, after the
 * run, every input each test file read, and records the checkout's state;
 * `squeal ci export` keys a file only when every input of its closure has,
 * in the export's checkout, the content the part certifies for it. A shared
 * commit alone certifies no ignored or untracked file.
 */

/** Per input path, its content: a file's blob id (`null`: none), a listing path's `listingHash`. */
export type InputHashes = Readonly<Record<RelativePath, FileHash | null>>;

/** What a part says about its checkout beside the commit (`PartHeader`). */
export interface CheckoutState {
  readonly clean: boolean;
  readonly untracked: readonly RelativePath[];
}

/** The names `directory` holds on disk, hashed; a marker when it is absent. */
export function listingHash(root: AbsolutePath, directory: RelativePath): FileHash {
  try {
    return namesHash(readdirSync(join(root, directory)));
  } catch {
    return ABSENT_LISTING;
  }
}

/** The worktree's `.git` by its kind, as a key holds it (`gitEntryByKind`); `null` when absent. */
export function gitEntryHash(root: AbsolutePath): FileHash | null {
  const entry = statSync(join(root, GIT_ENTRY), { throwIfNoEntry: false });
  if (entry === undefined) return null;
  const kind = entry.isDirectory() ? "directory" : "file";
  return createHash("sha1").update(`.git ${kind}`).digest("hex");
}

/**
 * `files` with each one's `inputs`: every path it read and every directory
 * it listed, hashed in `root` now, as the stat cache hashes a file
 * (`hasher`). A recursive listing hashes each directory below it too, as
 * the export keys it. `seen` holds the hashes across files.
 */
export async function withInputs(
  root: AbsolutePath,
  hasher: Hasher,
  files: readonly PartFile[],
  seen: Map<RelativePath, FileHash | null> = new Map(),
): Promise<PartFile[]> {
  const out: PartFile[] = [];
  for (const file of files) {
    if (file.observed === undefined) out.push(file);
    else out.push({ ...file, inputs: await inputsOf(root, hasher, file.observed, seen) });
  }
  return out;
}

async function inputsOf(
  root: AbsolutePath,
  hasher: Hasher,
  observed: PartObserved,
  seen: Map<RelativePath, FileHash | null>,
): Promise<InputHashes> {
  const listings = new Set(observed.directories.map(listingPath));
  for (const directory of observed.recursive ?? []) {
    for (const below of directoriesBelow(root, directory)) listings.add(listingPath(below));
  }
  const inputs: Record<RelativePath, FileHash | null> = {};
  for (const path of [...observed.paths, ...listings]) {
    let hash = seen.get(path);
    if (hash === undefined) {
      hash = await hashInput(root, hasher, path);
      seen.set(path, hash);
    }
    inputs[path] = hash;
  }
  return inputs;
}

async function hashInput(
  root: AbsolutePath,
  hasher: Hasher,
  path: RelativePath,
): Promise<FileHash | null> {
  const directory = listedDirectory(path);
  if (directory !== null) return listingHash(root, directory);
  if (path === GIT_ENTRY) return gitEntryHash(root);
  return (await hasher.stat(path)) === null ? null : hasher.hash(path);
}

/** Every directory on disk below `directory`, `.git` and `node_modules` aside. */
function directoriesBelow(root: AbsolutePath, directory: RelativePath): RelativePath[] {
  const out: RelativePath[] = [];
  const walk = (dir: RelativePath) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(join(root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === ".git" || entry.name === "node_modules") continue;
      const below = dir === "" ? entry.name : `${dir}/${entry.name}`;
      out.push(below);
      walk(below);
    }
  };
  walk(directory);
  return out;
}

/** A checkout git could not read: it certifies no input the part did not hash. */
const UNREAD: CheckoutState = { clean: false, untracked: [] };

/**
 * The checkout's state now: whether a tracked file differs from `HEAD`,
 * staged or not, and the untracked and ignored entries git reports, sorted,
 * an ignored or untracked directory once (`--ignored=matching`). Never
 * throws, since the project's command runs whatever Squeal reads (D16): a
 * failed git reads as `UNREAD`.
 */
export async function readCheckout(root: AbsolutePath): Promise<CheckoutState> {
  let status: string;
  try {
    status = await runGit(root, [
      "--no-optional-locks",
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=normal",
      "--ignored=matching",
      "--ignore-submodules=all",
    ]);
  } catch {
    return UNREAD;
  }
  const entries = splitNul(status);
  let clean = true;
  const untracked: RelativePath[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] ?? "";
    const code = entry.slice(0, 2);
    if (code === "??" || code === "!!") untracked.push(entry.slice(3));
    else {
      clean = false;
      // A rename or copy's source follows it as a field of its own.
      if (/[RC]/.test(code)) i += 1;
    }
  }
  return { clean, untracked: untracked.sort(compare) };
}

/** `a` and `b` as one state: clean when both are, every entry of either. */
export function joinCheckouts(a: CheckoutState, b: CheckoutState): CheckoutState {
  return {
    clean: a.clean && b.clean,
    untracked: [...new Set([...a.untracked, ...b.untracked])].sort(compare),
  };
}

/**
 * Spec 018 D9: the inputs among `paths`, a keyed file's closure, whose
 * content `here` (this checkout's, as its key holds it) the part does not
 * certify. A recorded input must equal; an unrecorded one counts only in a
 * clean checkout, as the commit's blob when the commit tracks it, else as no
 * file when no untracked or ignored entry covers it. A listing or `.git`
 * not recorded is never certified. Empty: the file's result is of this
 * content.
 */
export function uncertified(
  paths: readonly RelativePath[],
  recorded: InputHashes | undefined,
  checkout: CheckoutState,
  committed: ReadonlyMap<RelativePath, FileHash>,
  here: (path: RelativePath) => FileHash | null | undefined,
): RelativePath[] {
  const covered = coveredBy(checkout.untracked);
  return paths.filter((path) => {
    const now = here(path);
    if (now === undefined) return true;
    if (recorded !== undefined && Object.hasOwn(recorded, path)) return recorded[path] !== now;
    if (!checkout.clean || listedDirectory(path) !== null || path === GIT_ENTRY) return true;
    const blob = committed.get(path);
    if (blob !== undefined) return blob !== now;
    return covered(path) || now !== null;
  });
}

/** Whether a path is one of `entries` or below one of its directories. */
function coveredBy(entries: readonly RelativePath[]): (path: RelativePath) => boolean {
  const exact = new Set(entries);
  return (path) => {
    if (exact.has(path)) return true;
    for (let at = path.indexOf("/"); at >= 0; at = path.indexOf("/", at + 1)) {
      if (exact.has(path.slice(0, at + 1))) return true;
    }
    return false;
  };
}
