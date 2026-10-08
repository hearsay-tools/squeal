import { createHash } from "node:crypto";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { isMissing } from "../fs/index.js";
import { findInstalledLockfile } from "../keys/index.js";
import type { AbsolutePath } from "../types/index.js";
import { NOTHING_CHANGED, type SchedulerContext } from "./context.js";
import { type Failures, settleFailures } from "./failures.js";
import { installDirs, type MissingInstall, missingInstall } from "./install.js";
import type { Ledger } from "./ledger.js";
import { readEnvironments } from "./revision.js";

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
 * tier whose stamp moved stores nothing. The stamp is, for the root and,
 * while the root holds no install, every workspace that declares
 * dependencies (`installDirs`, review wave 11c S1): the names of its
 * `node_modules` entries, dot entries left out (npm 7's `ci` empties the
 * directory and keeps it; Vite and Vitest create `.vite` in it on a first
 * run), and the inode, mtime and size of its `package.json` and of its
 * installed lockfile. `missingInstall`, which reads files, runs again only
 * when the stamp moves.
 */
export class InstallStamps {
  /** Absolute directories and their installed lockfiles, as the last `check` found them. */
  #dirs: { readonly dir: AbsolutePath; readonly lockfile: AbsolutePath | null }[] = [];
  #last: InstallCheck | null = null;
  /** The stamp `takeChange` saw last; `null` before its first call. */
  #taken: string | null = null;

  constructor(private readonly root: AbsolutePath) {}

  /** Before a tier: the stamp and, when it moved since the last check, the wait decided again. */
  async check(): Promise<InstallCheck> {
    const stamp = await this.stamp();
    if (this.#last?.stamp === stamp) return this.#last;
    const missing = await missingInstall(this.root);
    this.#dirs = [];
    for (const relative of await installDirs(this.root)) {
      const dir = join(this.root, relative);
      this.#dirs.push({ dir, lockfile: (await findInstalledLockfile(dir, dir))?.path ?? null });
    }
    this.#last = { stamp: await this.stamp(), missing };
    return this.#last;
  }

  /**
   * Whether the install moved since the last call: true once per move, false
   * at the first call, which follows the environments' read at the start.
   * Task 001-109 (review wave-11b S2): a package folder added without
   * rewriting the lockfile creates no revision, since `node_modules` is not
   * watched, so the environments are read again here (`refreshInstall`).
   */
  takeChange(check: InstallCheck): boolean {
    const moved = this.#taken !== null && this.#taken !== check.stamp;
    this.#taken = check.stamp;
    return moved;
  }

  /** One directory listing and stats; no file is read. */
  async stamp(): Promise<string> {
    const dirs = this.#dirs.length > 0 ? this.#dirs : [{ dir: this.root, lockfile: null }];
    const parts = await Promise.all(
      dirs.map(async ({ dir, lockfile }) => {
        const paths = [join(dir, "package.json"), ...(lockfile === null ? [] : [lockfile])];
        const stats = await Promise.all(paths.map(statPart));
        return [await entriesPart(join(dir, "node_modules")), ...stats].join("|");
      }),
    );
    return parts.join("/");
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

/**
 * Reads the environments again after `InstallStamps.takeChange`, so each
 * project's installed dependencies are read under task 001-104's rule and
 * every key they move is settled, as a revision changing the lockfile
 * would. Under the scheduler lock, before a tier is selected; a tier of
 * another lane in flight then sees the stamp moved and stores nothing. The stamp covers the root
 * `node_modules` entries only; a folder added deeper waits for a restart
 * (D3).
 */
export async function refreshInstall(context: SchedulerContext, ledger: Ledger): Promise<void> {
  const failures: Failures = new Map();
  const touched = (await readEnvironments(context, failures)).map((change) => change.testFile);
  ledger.settle(touched, NOTHING_CHANGED);
  settleFailures(ledger, failures, false, NOTHING_CHANGED);
  ledger.commit();
}
