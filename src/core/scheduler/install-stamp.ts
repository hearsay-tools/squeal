import { createHash } from "node:crypto";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { isMissing } from "../fs/index.js";
import { findInstalledLockfile } from "../keys/index.js";
import type { AbsolutePath } from "../types/index.js";
import { type MissingInstall, missingInstall } from "./install.js";

/** What `InstallStamps.check` found before a tier. */
export interface InstallCheck {
  /** Stats of the install; equal stamps mean nothing replaced it in between. */
  readonly stamp: string;
  /** What the root waits for, or `null` when it is installed or declares nothing. */
  readonly missing: MissingInstall | null;
}

/**
 * The install of a worktree root, as stats a tier can be compared against.
 *
 * Task 001-107 (review wave 11, S1; D5 as amended): `npm ci` removes
 * `node_modules` before it installs, so a tier that ran meanwhile saw
 * packages vanish, and one restored with identical content keeps its key. A
 * tier whose stamp moved stores nothing. The stamp is the names of the root
 * `node_modules` entries, dot entries left out (npm 7's `ci` empties the
 * directory and keeps it; Vite and Vitest create `.vite` in it on a first
 * run), and the inode, mtime and size of the root `package.json` and of the
 * installed lockfile. `missingInstall`, which reads files, runs again only
 * when the stamp moves.
 */
export class InstallStamps {
  #lockfile: AbsolutePath | null = null;
  #last: InstallCheck | null = null;

  constructor(private readonly root: AbsolutePath) {}

  /** Before a tier: the stamp and, when it moved since the last check, the wait decided again. */
  async check(): Promise<InstallCheck> {
    const stamp = await this.stamp();
    if (this.#last?.stamp === stamp) return this.#last;
    const missing = await missingInstall(this.root);
    this.#lockfile = (await findInstalledLockfile(this.root, this.root))?.path ?? null;
    this.#last = { stamp: await this.stamp(), missing };
    return this.#last;
  }

  /** One directory listing and stats; no file is read. */
  async stamp(): Promise<string> {
    const paths = [join(this.root, "package.json")];
    if (this.#lockfile !== null) paths.push(this.#lockfile);
    const parts = await Promise.all(paths.map(statPart));
    return [await entriesPart(join(this.root, "node_modules")), ...parts].join("|");
  }
}

async function entriesPart(dir: AbsolutePath): Promise<string> {
  try {
    const names = (await readdir(dir)).filter((name) => !name.startsWith(".")).sort();
    // Missing and holding only `.vite` alike: a run of a project with nothing installed creates it.
    if (names.length === 0) return "-";
    return createHash("sha1").update(names.join("\0")).digest("hex");
  } catch (error) {
    if (isMissing(error) || (error as NodeJS.ErrnoException).code === "ENOTDIR") return "-";
    throw error;
  }
}

async function statPart(path: AbsolutePath): Promise<string> {
  try {
    const stats = await lstat(path, { bigint: true });
    return `${stats.ino}:${stats.mtimeNs}:${stats.size}`;
  } catch (error) {
    if (isMissing(error) || (error as NodeJS.ErrnoException).code === "ENOTDIR") return "-";
    throw error;
  }
}
