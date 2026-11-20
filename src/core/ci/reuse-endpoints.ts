import { ABSENT_LISTING, listedDirectory } from "../keys/observed.js";
import type { RelativePath } from "../types/common.js";
import type { FileHash } from "../types/keys.js";
import { type InputEvidence, type Uncertified, uncertifiedWhy } from "./inputs.js";
import { ownValue } from "./own-map.js";
import { PART_FORMAT, type Part } from "./parts.js";

/*
 * Spec 018 D33 (row 018-58): an input nothing touched. A part of format 6
 * holds the hash of every path git did not ignore, and of the listing of
 * each directory that holds one, taken by `ci record` before the command
 * and after it (D30): `stable` the paths equal at both ends that differ
 * from the commit, `unstable` the paths that differ between the ends, and
 * every other hashed path had the commit's content at both ends. It also
 * holds the paths a hooked process touched (D31). `FileReuse.evidence`
 * asks this rule only of an input the part holds no read-time evidence of:
 * such evidence decides alone (D9).
 *
 * D34: the risk the rule keeps is D8's condition. A program outside Node
 * changes an input and restores it within the command, and only a program
 * outside Node reads the changed content: both ends hash the restored
 * content, and the rule certifies it.
 */

/**
 * A path's hash in a commit's tree, as its key holds it (`hereOf`): a
 * file's blob id, a listing path's names hash; `null` when the tree holds
 * no such file, the absent-listing marker when it holds no such directory
 * (`atCommit`).
 */
export type AtCommit = (path: RelativePath) => FileHash | null;

/**
 * The hash `part`'s endpoint hashes give `path`, an input of a file it
 * holds, at both ends of its command (D33); `null` when the rule does not
 * certify it. `commit` is `part.header.commit`'s tree, `null` when not
 * known. All of these must hold: the part is of format 6 and took endpoint
 * hashes; no hooked process touched `path` (D33.1); its two hashes are
 * equal (D33.2); the commit holds it, so it is present and git does not
 * ignore it (D33.3); and it was present at both ends. That hash still has
 * to equal the content here (D33.4), which the caller compares.
 */
export function endpointHash(
  part: Part,
  path: RelativePath,
  commit: AtCommit | null,
): FileHash | null {
  const ends = endsOf(part);
  if (ends === null || commit === null) return null;
  if (ends.touched(path) || ends.unstable.has(path)) return null;
  const committed = commit(path);
  if (absent(committed)) return null;
  const { stable } = ends;
  const held = ownValue(stable, path);
  const hash = held === undefined ? committed : held;
  return hash === undefined || absent(hash) ? null : hash;
}

/**
 * Why an input is not certified: `uncertifiedWhy`'s reasons, or `ends`, its
 * endpoint hash is not its content here.
 */
export type InputWhy = Uncertified | "ends";

/**
 * The inputs among `inputs` neither `part`'s read-time evidence (D9) nor,
 * at `tree`, its endpoint hashes (D33) certify at `here`, in the order
 * given, each with why; and the inputs the endpoint rule certified. `here`
 * is read only for an input one of them holds.
 */
export async function inputsHere(
  part: Part,
  inputs: readonly RelativePath[],
  here: (path: RelativePath) => FileHash | null | undefined | Promise<FileHash | null | undefined>,
  tree: AtCommit | null,
): Promise<{
  readonly differ: readonly { readonly path: RelativePath; readonly why: InputWhy }[];
  readonly endpoints: readonly RelativePath[];
}> {
  const contents = new Map<RelativePath, FileHash | null | undefined>();
  const ends = new Map<RelativePath, FileHash>();
  for (const path of inputs) {
    if (!Object.hasOwn(part.evidence, path)) {
      const hash = tree === null ? null : endpointHash(part, path, tree);
      if (hash === null) continue;
      ends.set(path, hash);
    }
    contents.set(path, await here(path));
  }
  const differ = inputs.flatMap((path): { path: RelativePath; why: InputWhy }[] => {
    const hash = ends.get(path);
    if (hash === undefined) return uncertifiedWhy([path], part.evidence, (p) => contents.get(p));
    const now = contents.get(path);
    if (now === hash) return [];
    return [{ path, why: now === undefined ? "unknown" : "ends" }];
  });
  return { differ, endpoints: differ.length === 0 ? [...ends.keys()] : [] };
}

/** No file, or no directory: neither is certified by the rule (D33.3). */
const absent = (hash: FileHash | null): boolean => hash === null || hash === ABSENT_LISTING;

/** A format 6 part's endpoint fields, read once per part. */
interface Ends {
  readonly stable: InputEvidence;
  readonly unstable: ReadonlySet<RelativePath>;
  readonly touched: (path: RelativePath) => boolean;
}

const endsByPart = new WeakMap<Part, Ends | null>();

/** `part`'s `Ends`; `null` unless it is of format 6 with endpoint hashes and touched paths. */
function endsOf(part: Part): Ends | null {
  let ends = endsByPart.get(part);
  if (ends === undefined) {
    const { format, stable, unstable, touched } = part;
    const hashed = stable !== undefined || unstable !== undefined;
    ends =
      format !== PART_FORMAT || !hashed || touched === undefined
        ? null
        : { stable: stable ?? {}, unstable: new Set(unstable), touched: touchedTest(touched) };
    endsByPart.set(part, ends);
  }
  return ends;
}

/**
 * Whether a path, a file or a listing path, is touched (D31): `"all"`, or
 * `touched` holds it, or holds a tree path that is it or holds it; a
 * listing path is its directory's bare path too, `""` the root.
 */
function touchedTest(touched: readonly RelativePath[] | "all"): (path: RelativePath) => boolean {
  if (touched === "all") return () => true;
  const set = new Set(touched);
  if (set.has("")) return () => true;
  return (path) => {
    if (set.has(path)) return true;
    const bare = listedDirectory(path) ?? path;
    if (set.has(bare)) return true;
    for (let at = bare.indexOf("/"); at >= 0; at = bare.indexOf("/", at + 1)) {
      if (set.has(bare.slice(0, at))) return true;
    }
    return false;
  };
}
