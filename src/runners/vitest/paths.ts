import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type {
  AbsolutePath,
  FileHash,
  RelativePath,
  SourceLocation,
} from "../../core/types/index.js";

/**
 * Git blob id of a file's bytes, SHA-1 object format.
 *
 * Spec 001 D3: "the git blob id of the bytes on disk, `sha1("blob <len>\0" +
 * bytes)`". SHA-256 repositories and the clean-index shortcut belong to the
 * core hasher (001-11), which can replace this one through
 * `VitestAdapterOptions.hashFile`.
 */
export function gitBlobHash(path: AbsolutePath): FileHash {
  const bytes = readFileSync(path);
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

/**
 * Converts between Vitest's absolute paths and Squeal's worktree-relative
 * paths. Everything outside the worktree root or under `node_modules` is not
 * a project file: the watcher does not see it and the environment hash
 * covers installed dependencies (D3).
 */
export class WorktreePaths {
  constructor(readonly root: AbsolutePath) {}

  toAbsolute(path: RelativePath): AbsolutePath {
    return resolve(this.root, path);
  }

  /** `null` when the path is the root itself or outside it. */
  toRelative(path: AbsolutePath): RelativePath | null {
    const rel = relative(this.root, path);
    if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
    return rel.split(sep).join("/");
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
