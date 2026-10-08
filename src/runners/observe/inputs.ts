import { statSync } from "node:fs";
import { compare } from "../../core/fs/index.js";
import type { WorktreePaths } from "../../core/fs/worktree-paths.js";
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
 * content is no file to hash), and a listed directory kept as a listing.
 * Files of two projects at one path share their observations: the recorder
 * attributes by path.
 */
export function observedInputs(
  recorded: ReadonlyMap<AbsolutePath, RecordedFile>,
  completed: readonly TestFileRef[],
  paths: WorktreePaths,
): ObservedInputs[] {
  const out: ObservedInputs[] = [];
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
    const read = relative(entry.paths, (abs) => !isDirectory(abs));
    const listed = relative(entry.listed, () => true);
    if (read.length > 0 || listed.length > 0) {
      out.push({ testFile, paths: read, directories: listed });
    }
  }
  return out;
}
