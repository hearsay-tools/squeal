import { compare } from "../fs/compare.js";
import { testFileId } from "../keys/reverse-index.js";
import type { RelativePath } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import { namesakesOf } from "./namesakes.js";

/*
 * 011 C4 step 4's edit work (task 011-25, 011-116, 016 D4) as one pure rule
 * (row 026-21): the daemon's `editWork` and `squeal run <group> --base`
 * (019 D6, spec 026 D4) read it from their ledger and the worktree's keys;
 * `squeal code --base --narrow` (spec 026 D5.2) reads it from the runner's
 * `affected` and the stores. So both keep the same files for one diff.
 */

/** A file the rule can keep: a `FileState` has these. */
export interface SelectableFile {
  readonly id: string;
  readonly ref: TestFileRef;
  /** Its last-known duration; `null` when unknown, which sorts last. */
  readonly durationMs: number | null;
}

/** Of a revision's changed sources, the namesakes it reaches and the fallback of the others. */
export interface NamesakeCut {
  /** Each source the revision changed that a closure holds, with its namesakes' `testFileId`s. */
  readonly namesakes: ReadonlyMap<RelativePath, readonly string[]>;
  /** The sources none of whose namesakes the revision reached. */
  readonly bare: ReadonlySet<RelativePath>;
  /** `testFileId`s of the runner's direct importers of `bare`. */
  readonly fallback: ReadonlySet<string>;
}

/**
 * The namesakes and bare sources of `paths` (`fetchEditCut`): a source is a
 * changed path that is no test file of `testFiles` and that `held` says a
 * closure holds; it is bare when no namesake of it is among `reached`.
 */
export function namesakeCut(
  testFiles: Iterable<TestFileRef>,
  paths: readonly RelativePath[],
  reached: ReadonlySet<string>,
  held: (path: RelativePath) => boolean,
): { namesakes: Map<RelativePath, readonly string[]>; bare: Set<RelativePath> } {
  const byPath = new Map<RelativePath, string[]>();
  for (const ref of testFiles)
    byPath.set(ref.path, [...(byPath.get(ref.path) ?? []), testFileId(ref)]);
  const namesakes = new Map<RelativePath, readonly string[]>();
  const bare = new Set<RelativePath>();
  for (const path of new Set(paths)) {
    if (byPath.has(path) || !held(path)) continue;
    const ids = namesakesOf(path, byPath.keys()).flatMap((name) => byPath.get(name) ?? []);
    namesakes.set(path, ids);
    if (!ids.some((id) => reached.has(id))) bare.add(path);
  }
  return { namesakes, bare };
}

/** What `selectEditWork` reads; every id is a `testFileId`. */
export interface EditSelectionInput {
  /** The files it can keep, in the order a changed test file is kept. */
  readonly files: ReadonlyMap<string, SelectableFile>;
  /** The paths whose own test files are kept: the changed paths, and a gate's `--test` files. */
  readonly named: ReadonlySet<RelativePath>;
  /** Every file the changed paths reach. */
  readonly reached: ReadonlySet<string>;
  readonly cut: NamesakeCut;
  /** The runner's direct importers of the changed paths. */
  readonly direct: ReadonlySet<string>;
  /** The files only stored direct marks reach (016 D4), `direct` left out. */
  readonly observedDirect: ReadonlySet<string>;
  /** The files that import a changed path through other modules, or whose runs read it. */
  readonly reads: (id: string) => boolean;
  /** `runner.tierSize`: how many other importers and readers it keeps. */
  readonly tierSize: number;
  /** Keeps the work among some files only, as a narrow run keeps it among one group's. */
  readonly within: (id: string) => boolean;
}

/**
 * The files an edit keeps (`editWork`): those `named`; each source's
 * namesakes it reached, or for a source with none its fallback (a bare
 * source's) or the direct importers; then the `tierSize` shortest by
 * last-known duration, unknown last, of the other direct importers (stored
 * direct marks among them), then of the other reached files that `reads`.
 * Only files `within` are kept.
 */
export function selectEditWork(input: EditSelectionInput): Set<string> {
  const { files, named, reached, cut, direct, within } = input;
  const importers = new Set([...direct, ...input.observedDirect]);
  const kept = new Set<string>();
  for (const file of files.values()) {
    if (named.has(file.ref.path) && within(file.id)) kept.add(file.id);
  }
  for (const [source, ids] of cut.namesakes) {
    const own = ids.filter((id) => reached.has(id) && within(id));
    // A source whose namesake the closures reached only once the runner part applied them.
    const fallback = cut.bare.has(source) ? cut.fallback : direct;
    for (const id of own.length > 0 ? own : fallback) if (within(id)) kept.add(id);
  }
  const rest = [...reached].filter((id) => !kept.has(id) && !importers.has(id) && within(id));
  const others = [
    ...shortest(
      files,
      [...importers].filter((id) => !kept.has(id) && within(id)),
    ),
    ...shortest(files, rest.filter(input.reads)),
  ];
  for (const file of others.slice(0, input.tierSize)) kept.add(file.id);
  return kept;
}

/** The files of `ids` that `files` knows, shortest last-known duration first, unknown last. */
function shortest(
  files: ReadonlyMap<string, SelectableFile>,
  ids: readonly string[],
): SelectableFile[] {
  return ids
    .map((id) => files.get(id))
    .filter((file): file is SelectableFile => file !== undefined)
    .sort(shortestFirst);
}

function shortestFirst(a: SelectableFile, b: SelectableFile): number {
  const x = a.durationMs ?? Number.POSITIVE_INFINITY;
  const y = b.durationMs ?? Number.POSITIVE_INFINITY;
  return x === y ? compare(a.id, b.id) : x < y ? -1 : 1;
}
