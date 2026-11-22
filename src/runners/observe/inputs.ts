import { statSync } from "node:fs";
import { dirname } from "node:path";
import { compare } from "../../core/fs/compare.js";
import type { WorktreePaths } from "../../core/fs/worktree-paths.js";
import { testFileId } from "../../core/keys/reverse-index.js";
import type { AbsolutePath, RelativePath } from "../../core/types/common.js";
import type { TestFileRef } from "../../core/types/keys.js";
import type { ObservedInputs } from "../../core/types/runner.js";
import type { RecordedFile } from "./read.js";

/**
 * What each of `completed` was observed to read (spec 001 D3, D4), from the
 * recorder's files: project paths outside `node_modules`, a path the run
 * wrote left out, a directory that was only stat'ed or opened left out (its
 * content is no file to hash) except the worktree's `.git`, keyed by kind,
 * and a listed directory kept as a listing, a recursive one among
 * `recursive` too. `written` names the directories the run wrote, created
 * (`mkdtemp` too) or removed that hold a kept path or listing, for the core's
 * written-directory bound (spec 016 D4). `direct` names the kept paths a
 * process the test file started loaded, which put the file in `direct`
 * (spec 016 D4, row 016-22). `rewritten` names the paths the run read and
 * also wrote, which `paths` leaves out, whatever stands there after the run,
 * for the core to key the ones git tracks as files (row 023-47).
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
    const rewritten = rewrittenOf(entry, paths);
    if (read.length > 0 || listed.length > 0 || rewritten.length > 0) {
      const written = writtenAbove([...read, ...listed], entry.written, paths);
      const direct = read.filter((path) => entry.direct.has(paths.toAbsolute(path)));
      const modules = read.filter((path) => entry.modules.has(paths.toAbsolute(path)));
      out.push({
        testFile,
        paths: read,
        directories: listed,
        ...(recursive.length > 0 ? { recursive } : {}),
        ...(written.length > 0 ? { written } : {}),
        ...(rewritten.length > 0 ? { rewritten } : {}),
        ...(direct.length > 0 ? { direct } : {}),
        ...(modules.length > 0 ? { modules } : {}),
      });
    }
  }
  return out;
}

/**
 * Row 023-47: the project paths `entry` both read and wrote, created or
 * removed, worktree-relative and sorted. Whether the read came before the
 * write is not recorded, nor what kind the path was when read: a file the
 * run read, removed and replaced with a directory is a directory now (review
 * 0.1.598 B1), so what stands there after the run decides nothing. The core
 * keys the ones git tracks as files; a directory the run stat'ed and wrote
 * is none, a listing is not here.
 */
function rewrittenOf(entry: RecordedFile, paths: WorktreePaths): RelativePath[] {
  const out = new Set<RelativePath>();
  for (const abs of entry.paths) {
    if (!entry.written.has(abs) || !paths.isProjectFile(abs)) continue;
    const path = paths.toRelative(abs);
    if (path !== null) out.add(path);
  }
  return [...out].sort(compare);
}

/**
 * The paths of `written` that are directories above one of `kept`,
 * worktree-relative and sorted: what the core's written-directory bound
 * reads (spec 016 D4).
 */
export function writtenAbove(
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
