import { sep } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { AbsolutePath, RelativePath, SourceLocation } from "../types/common.js";
import { toAbsolute, toRelative } from "./paths.js";

/**
 * Converts between a runner's absolute paths and Squeal's worktree-relative
 * paths. Everything outside the worktree root or under `node_modules` is not
 * a project file: the watcher does not see it and the environment hash
 * covers installed dependencies (D3).
 */
export class WorktreePaths {
  /** Row 011-414: each answer depends on the path and `root` only, so it is kept. */
  readonly #relative = new Map<AbsolutePath, RelativePath | null>();
  readonly #project = new Map<AbsolutePath, boolean>();

  constructor(readonly root: AbsolutePath) {}

  toAbsolute(path: RelativePath): AbsolutePath {
    return toAbsolute(this.root, path);
  }

  /** `null` when the path is the root itself or outside it. */
  toRelative(path: AbsolutePath): RelativePath | null {
    const held = this.#relative.get(path);
    if (held !== undefined) return held;
    const relative = toRelative(this.root, path);
    remember(this.#relative, path, relative);
    return relative;
  }

  isProjectFile(path: AbsolutePath): boolean {
    const held = this.#project.get(path);
    if (held !== undefined) return held;
    const project = this.toRelative(path) !== null && !path.split(sep).includes("node_modules");
    remember(this.#project, path, project);
    return project;
  }

  /** Spec 001 D4: "Stack paths are relativized before storage." Also strips ANSI colours. */
  relativizeText(text: string): string {
    return stripVTControlCharacters(text)
      .replaceAll(`file://${this.root}/`, "")
      .replaceAll(`${this.root}/`, "")
      .replaceAll(this.root, ".");
  }

  location(file: AbsolutePath, line: number, column: number): SourceLocation | null {
    const path = this.toRelative(file);
    return path === null ? null : { path, line, column };
  }
}

/**
 * Row 011-414: the most paths a memo holds. A closure loop asks about each
 * walked path once per test file that reaches it; a repository of some
 * thousands of files and the packages they import stays well below this.
 * Past it the memo starts again, so a long-lived host stays bounded.
 */
export const PATH_MEMO_LIMIT = 50_000;

function remember<V>(memo: Map<AbsolutePath, V>, path: AbsolutePath, value: V): void {
  if (memo.size >= PATH_MEMO_LIMIT) memo.clear();
  memo.set(path, value);
}
