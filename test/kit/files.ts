import { mkdirSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

/*
 * Spec 016 D1: the files a scenario's play writes. A path is from the
 * fixture root, or absolute for a file a pack keeps outside the worktree,
 * such as an installed package in a declared environment. What is written
 * outside is removed when the play ends, so a shared environment keeps no
 * scenario's install.
 */
export class FixtureFiles {
  private readonly outside = new Set<string>();

  constructor(readonly root: string) {}

  /** Where `path` is on disk. */
  at(path: string): string {
    return isAbsolute(path) ? path : join(this.root, path);
  }

  put(path: string, text: string): void {
    const at = this.at(path);
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, text);
    if (isAbsolute(path)) this.outside.add(path);
  }

  /** Removes the file, and its directory when that is left empty. */
  remove(path: string): void {
    const at = this.at(path);
    rmSync(at, { force: true });
    try {
      rmdirSync(dirname(at));
    } catch {
      // Not empty, or gone: either way nothing of this file is left.
    }
    this.outside.delete(path);
  }

  /** Removes every file written outside the fixture. */
  cleanup(): void {
    for (const path of [...this.outside]) this.remove(path);
  }
}
