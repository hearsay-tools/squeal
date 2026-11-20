import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { mapConcurrent } from "../fs/concurrency.js";
import { hashFile, type ObjectFormat } from "../hash/blob.js";
import { gitHead } from "../status/git-head.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import type { FileHash } from "../types/keys.js";
import { committedInputs, hereOf, type InputEvidence } from "./inputs.js";
import { ownMap } from "./own-map.js";

/*
 * Spec 018 D30 and D32 (row 018-57): `squeal ci record` hashes the checkout
 * in its own process before it starts the command and after the command
 * exited, as a key holds each path (`hereOf`): a file by its blob id
 * (`null`: no file), a listing path by the names on disk. It hashes every
 * path `HEAD`'s tree holds, each file and the listing of each directory,
 * also when the path is gone from the disk: only a path the commit holds can
 * be certified by its hashes (D33.3), and the export reads such a path that
 * is in neither `stable` nor `unstable` as the commit's content at both
 * ends. One `git ls-tree` before the command; no `git status`, no program
 * after it. A path git does not track is not hashed.
 */

/** What the hashes before the command hold, for `endpointsAfter`. */
export interface EndpointsBefore {
  readonly root: AbsolutePath;
  readonly format: ObjectFormat;
  readonly commit: string;
  readonly paths: readonly RelativePath[];
  readonly at: (path: RelativePath) => FileHash | null;
  readonly hashes: readonly (FileHash | null)[];
  readonly ms: number;
}

/** A format 6 part's endpoint fields (`Part.stable`, `Part.unstable`), and the time both ends took. */
export interface Endpoints {
  readonly stable: InputEvidence;
  readonly unstable: readonly RelativePath[];
  readonly ms: number;
}

/** The hashes of `root` before the command; why none when it has no commit. */
export async function endpointsBefore(
  root: AbsolutePath,
  format: ObjectFormat,
): Promise<EndpointsBefore | string> {
  const start = performance.now();
  const commit = await gitHead(root);
  if (commit === null) return "the checkout has no commit, so no input is certified by its hashes";
  const { paths, at } = await committedInputs(root, commit);
  const hashes = await hashAll(root, format, paths);
  return { root, format, commit, paths, at, hashes, ms: performance.now() - start };
}

/**
 * The hashes after the command, against `before`: `stable` holds each path
 * whose two hashes are equal and differ from the commit (`atCommit`), with
 * that hash; `unstable` each path whose two hashes differ. Why none when
 * `HEAD` moved during the command: the part names another commit.
 */
export async function endpointsAfter(before: EndpointsBefore): Promise<Endpoints | string> {
  const start = performance.now();
  const { root, format, commit, paths, at, hashes } = before;
  const head = await gitHead(root);
  if (head !== commit) return `HEAD moved during the command (${commit} to ${head ?? "none"})`;
  const after = await hashAll(root, format, paths);
  const stable: [RelativePath, FileHash | null][] = [];
  const unstable: RelativePath[] = [];
  paths.forEach((path, index) => {
    const hash = hashes[index] ?? null;
    if (hash !== (after[index] ?? null)) unstable.push(path);
    else if (hash !== at(path)) stable.push([path, hash]);
  });
  return {
    stable: ownMap(stable),
    unstable,
    ms: before.ms + performance.now() - start,
  };
}

function hashAll(
  root: AbsolutePath,
  format: ObjectFormat,
  paths: readonly RelativePath[],
): Promise<(FileHash | null)[]> {
  const here = hereOf(root, (path) => hashFile(join(root, path), format));
  return mapConcurrent(paths, async (path) => await here(path));
}
