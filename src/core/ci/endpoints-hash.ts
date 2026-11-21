import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { mapConcurrent } from "../fs/concurrency.js";
import type { ObjectFormat } from "../hash/blob.js";
import { ABSENT_LISTING, listedDirectory, namesHash } from "../keys/observed.js";
import { gitHead } from "../status/git-head.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import type { FileHash } from "../types/keys.js";
import { committedInputs, hereOf } from "./inputs.js";

/*
 * Spec 018 D30: the work of one end of `ci record`'s endpoint hashing, in
 * whichever process does it (row 018-67: a child of `ci record`'s, by
 * default). Its input and its result are plain data, so they cross to a
 * child and back.
 */

/** What one end hashes: before the command, `HEAD`'s tree; after it, the same paths of the same commit. */
export type EndWork =
  | { readonly root: AbsolutePath; readonly format: ObjectFormat; readonly commit: null }
  | {
      readonly root: AbsolutePath;
      readonly format: ObjectFormat;
      readonly commit: string;
      readonly paths: readonly RelativePath[];
    };

/** The hashes one end took, by `paths`' index; before the command, also the commit's own. */
export interface EndHashes {
  readonly commit: string;
  readonly paths: readonly RelativePath[];
  /** Each path's hash at the commit (`atCommit`); only before the command. */
  readonly committed?: readonly (FileHash | null)[];
  readonly hashes: readonly (FileHash | null)[];
}

/** A file's blob id (`null`: no file), by its absolute path. */
export type ReadFile = (path: AbsolutePath, format: ObjectFormat) => Promise<FileHash | null>;

/** What one end's hashing tells its limit (row 018-61), and whether the limit passed. */
export interface Clock {
  /** The hashing of `total` paths begins. */
  begin(total: number): void;
  /** `count` more paths are hashed. */
  hashed(count: number): void;
  readonly over: boolean;
}

/**
 * One end's hashes, or why none: before the command, when the checkout has
 * no commit; after it, when `HEAD` moved during the command, since the part
 * names another commit. Once `clock` is over, no further path is read.
 */
export async function hashEnd(
  work: EndWork,
  read: ReadFile,
  clock: Clock,
): Promise<EndHashes | string> {
  const { root, format } = work;
  const head = await gitHead(root);
  if (work.commit === null) {
    if (head === null) return "the checkout has no commit, so no input is certified by its hashes";
    const { paths, at } = await committedInputs(root, head);
    const hashes = await hashAll(root, format, paths, read, clock);
    return { commit: head, paths, committed: paths.map(at), hashes };
  }
  const { commit, paths } = work;
  if (head !== commit) return `HEAD moved during the command (${commit} to ${head ?? "none"})`;
  return { commit, paths, hashes: await hashAll(root, format, paths, read, clock) };
}

async function hashAll(
  root: AbsolutePath,
  format: ObjectFormat,
  paths: readonly RelativePath[],
  read: ReadFile,
  clock: Clock,
): Promise<(FileHash | null)[]> {
  const here = hereOf(root, (path) => read(join(root, path) as AbsolutePath, format));
  clock.begin(paths.length);
  return mapConcurrent(paths, async (path) => {
    if (clock.over) return null;
    const directory = listedDirectory(path);
    // A listing is read like a file, without blocking the limit's timer (`listingHash`'s rule).
    const hash = directory === null ? await here(path) : await listingOf(root, directory);
    clock.hashed(1);
    return hash;
  });
}

/** `listingHash`, read asynchronously. */
async function listingOf(root: AbsolutePath, directory: RelativePath): Promise<FileHash> {
  try {
    return namesHash(await readdir(join(root, directory)));
  } catch {
    return ABSENT_LISTING;
  }
}
