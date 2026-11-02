import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blobHash } from "../../../src/core/hash/index.js";
import type { LintSource, LintSourceFile } from "../../../src/core/lint/pass/index.js";
import type { RelativePath } from "../../../src/core/types/index.js";
import { listing } from "./replay.js";

/**
 * A worktree read from disk, as the daemon's stat cache and revisions give
 * the lint pass (011 C2): `revise` lists every file but `node_modules` and
 * `.git`, hashes each as git does, and records the paths that changed as
 * one revision. Edits made on disk by any means are seen at the next one.
 */
export class DiskWorktree {
  readonly #revisions: RelativePath[][] = [];
  #files = new Map<RelativePath, LintSourceFile>();

  constructor(readonly root: string) {}

  /** Stores a revision of what is on disk now; its number. */
  revise(): number {
    const next = new Map<RelativePath, LintSourceFile>();
    for (const path of listing(this.root)) {
      next.set(path, { path, hash: blobHash(readFileSync(join(this.root, path)), "sha1") });
    }
    const paths = new Set([...next.keys(), ...this.#files.keys()]);
    const changed = [...paths].filter((p) => next.get(p)?.hash !== this.#files.get(p)?.hash);
    this.#files = next;
    this.#revisions.push(changed.sort());
    return this.#revisions.length;
  }

  readonly source: LintSource = {
    latestRevision: () => this.#revisions.length,
    changedPaths: (after, upTo) => [...new Set(this.#revisions.slice(after, upTo).flat())],
    file: (path) => this.#files.get(path) ?? null,
    files: () => [...this.#files.values()],
    ignored: () => [],
  };
}
