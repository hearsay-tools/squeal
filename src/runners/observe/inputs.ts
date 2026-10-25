import { statSync } from "node:fs";
import { dirname } from "node:path";
import { compare } from "../../core/fs/index.js";
import type { WorktreePaths } from "../../core/fs/worktree-paths.js";
import { testFileId } from "../../core/keys/index.js";
import type {
  AbsolutePath,
  ObservedInputs,
  RelativePath,
  TestFileRef,
} from "../../core/types/index.js";
import type { RecordedFile } from "./read.js";

/**
 * What each of `completed` was observed to read (spec 001 D3, D4), from the
 * recorder's files: project paths outside `node_modules`, a path the run
 * wrote left out, a directory that was only stat'ed or opened left out (its
 * content is no file to hash) except the worktree's `.git`, keyed by kind,
 * and a listed directory kept as a listing, a recursive one among
 * `recursive` too. `written` names the directories the run wrote, created
 * (`mkdtemp` too) or removed that hold a kept path or listing, for the core's
 * written-directory bound (spec 016 D4).
 * Files of two projects at one path share their observations: the recorder
 * attributes by path.
 */
export function observedInputs(
  recorded: ReadonlyMap<AbsolutePath, RecordedFile>,
  completed: readonly TestFileRef[],
  paths: WorktreePaths,
): ObservedInputs[] {
  const out: ObservedInputs[] = [];
  const git = paths.toAbsolute(".git");
  const directories = new Map<AbsolutePath, boolean>();
  const isDirectory = (abs: AbsolutePath) => {
    let known = directories.get(abs);
    if (known === undefined) {
      known = statSync(abs, { throwIfNoEntry: false })?.isDirectory() === true;
      directories.set(abs, known);
    }
    return known;
  };
  for (const testFile of completed) {
    const entry = recorded.get(paths.toAbsolute(testFile.path));
    if (entry === undefined) continue;
    const relative = (set: Iterable<AbsolutePath>, keep: (abs: AbsolutePath) => boolean) => {
      const kept = new Set<RelativePath>();
      for (const abs of set) {
        if (entry.written.has(abs) || !paths.isProjectFile(abs) || !keep(abs)) continue;
        const path = paths.toRelative(abs);
        if (path !== null) kept.add(path);
      }
      return [...kept].sort(compare);
    };
    // The worktree's `.git` keys by its kind, a directory too (task 001-262).
    const read = relative(entry.paths, (abs) => abs === git || !isDirectory(abs));
    const listed = relative(entry.listed, () => true);
    const recursive = relative(entry.recursive, () => true);
    if (read.length > 0 || listed.length > 0) {
      const written = writtenAbove([...read, ...listed], entry.written, paths);
      out.push({
        testFile,
        paths: read,
        directories: listed,
        ...(recursive.length > 0 ? { recursive } : {}),
        ...(written.length > 0 ? { written } : {}),
      });
    }
  }
  return out;
}

/** The written paths of `written` that are directories above one of `kept`, worktree-relative and sorted. */
function writtenAbove(
  kept: readonly RelativePath[],
  written: ReadonlySet<AbsolutePath>,
  paths: WorktreePaths,
): RelativePath[] {
  if (written.size === 0) return [];
  const root = paths.toAbsolute("");
  const out = new Set<RelativePath>();
  for (const path of kept) {
    for (let dir = dirname(paths.toAbsolute(path)); dir.length > root.length; dir = dirname(dir)) {
      if (!written.has(dir)) continue;
      const relative = paths.toRelative(dir);
      if (relative !== null) out.add(relative);
    }
  }
  return [...out].sort(compare);
}

/**
 * A warm-up's reads (task 001-312, with spec 005): `observed` with an empty
 * entry for each of `completed` it lacks, so every file the recorder
 * watched is named and a file without one was not observed.
 */
export function readsOfEvery(
  observed: readonly ObservedInputs[],
  completed: readonly TestFileRef[],
): ObservedInputs[] {
  const named = new Set(observed.map((o) => testFileId(o.testFile)));
  const empty = completed
    .filter((testFile) => !named.has(testFileId(testFile)))
    .map((testFile) => ({ testFile, paths: [], directories: [] }));
  return [...observed, ...empty];
}
