import { sep } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { toAbsolute, toRelative } from "../../core/fs/index.js";
import type { AbsolutePath, RelativePath, SourceLocation } from "../../core/types/index.js";

/**
 * Converts between Vitest's absolute paths and Squeal's worktree-relative
 * paths. Everything outside the worktree root or under `node_modules` is not
 * a project file: the watcher does not see it and the environment hash
 * covers installed dependencies (D3).
 */
export class WorktreePaths {
  constructor(readonly root: AbsolutePath) {}

  toAbsolute(path: RelativePath): AbsolutePath {
    return toAbsolute(this.root, path);
  }

  /** `null` when the path is the root itself or outside it. */
  toRelative(path: AbsolutePath): RelativePath | null {
    return toRelative(this.root, path);
  }

  isProjectFile(path: AbsolutePath): boolean {
    return this.toRelative(path) !== null && !path.split(sep).includes("node_modules");
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
