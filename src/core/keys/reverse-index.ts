import { posix } from "node:path";
import type { RelativePath, TestFileRef } from "../types/index.js";
import { compare } from "./closure.js";

/** Map key of a test file. NUL cannot occur in a project name or a path. */
export function testFileId(ref: TestFileRef): string {
  return `${ref.project}\0${ref.path}`;
}

/** Directory of a relative path; `""` for the worktree root. */
export function directoryOf(path: RelativePath): string {
  const dir = posix.dirname(path);
  return dir === "." ? "" : dir;
}

/**
 * `path -> test files` over closures, with a directory index for add and
 * delete handling.
 *
 * Spec 001 D3: "a reverse index `path -> test files`, and re-computation only
 * of the keys that reference a changed path."
 */
export class ReverseIndex {
  private readonly refs = new Map<string, TestFileRef>();
  private readonly pathsOf = new Map<string, readonly RelativePath[]>();
  private readonly byPath = new Map<RelativePath, Set<string>>();
  private readonly byDirectory = new Map<string, Set<RelativePath>>();

  get size(): number {
    return this.refs.size;
  }

  /** Replaces the closure paths of `testFile`. */
  set(testFile: TestFileRef, paths: readonly RelativePath[]): void {
    const id = testFileId(testFile);
    this.unlink(id);
    this.refs.set(id, testFile);
    this.pathsOf.set(id, paths);
    for (const path of paths) {
      let ids = this.byPath.get(path);
      if (!ids) {
        ids = new Set();
        this.byPath.set(path, ids);
        const dir = directoryOf(path);
        let members = this.byDirectory.get(dir);
        if (!members) {
          members = new Set();
          this.byDirectory.set(dir, members);
        }
        members.add(path);
      }
      ids.add(id);
    }
  }

  remove(testFile: TestFileRef): void {
    const id = testFileId(testFile);
    this.unlink(id);
    this.refs.delete(id);
  }

  testFiles(): TestFileRef[] {
    return this.sorted(this.refs.keys());
  }

  /** Test files whose closure contains any of `paths`. */
  referencing(paths: Iterable<RelativePath>): TestFileRef[] {
    const ids = new Set<string>();
    for (const path of paths) {
      for (const id of this.byPath.get(path) ?? []) ids.add(id);
    }
    return this.sorted(ids);
  }

  /** Test files with a closure path directly in `dir` (`""` is the root). */
  inDirectory(dir: string): TestFileRef[] {
    return this.referencing(this.byDirectory.get(dir) ?? []);
  }

  /** Test files with a closure path anywhere below `dir`. */
  below(dir: string): TestFileRef[] {
    const prefix = `${dir}/`;
    const paths: RelativePath[] = [];
    for (const [directory, members] of this.byDirectory) {
      if (directory === dir || directory.startsWith(prefix)) paths.push(...members);
    }
    return this.referencing(paths);
  }

  private unlink(id: string): void {
    for (const path of this.pathsOf.get(id) ?? []) {
      const ids = this.byPath.get(path);
      if (!ids) continue;
      ids.delete(id);
      if (ids.size > 0) continue;
      this.byPath.delete(path);
      const dir = directoryOf(path);
      const members = this.byDirectory.get(dir);
      members?.delete(path);
      if (members?.size === 0) this.byDirectory.delete(dir);
    }
    this.pathsOf.delete(id);
  }

  private sorted(ids: Iterable<string>): TestFileRef[] {
    return [...ids]
      .sort(compare)
      .map((id) => this.refs.get(id))
      .filter((ref): ref is TestFileRef => ref !== undefined);
  }
}
