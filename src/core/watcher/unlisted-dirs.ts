import type { AbsolutePath, RelativePath } from "../types/index.js";
import { checkIgnored } from "./git.js";
import { selfAndAncestors } from "./paths.js";

/**
 * Ignored directories git does not list, recorded by a spec rebuild that left
 * the spec unchanged: a new ignored directory below one of them does not
 * rebuild again. Research `nested-worktree-watch.md` finding 2: every
 * `mkdtemp` under an ignored directory git did not list rebuilt the spec,
 * unchanged each time (task 001-299).
 */
export class UnlistedDirs {
  private readonly dirs = new Set<RelativePath>();

  constructor(private readonly root: AbsolutePath) {}

  /** True when `dir` is, or is below, a recorded directory. */
  holds(dir: RelativePath): boolean {
    for (const path of selfAndAncestors(dir)) if (this.dirs.has(path)) return true;
    return false;
  }

  /** Records the outermost ignored directory holding each of `dirs`. */
  async record(dirs: readonly RelativePath[]): Promise<void> {
    const ancestors = new Set(dirs.flatMap((dir) => [...selfAndAncestors(dir)]));
    const ignored = await checkIgnored(this.root, [...ancestors]);
    for (const dir of dirs) {
      const outermost = [...selfAndAncestors(dir)].filter((path) => ignored.has(path)).at(-1);
      this.dirs.add(outermost ?? dir);
    }
  }

  clear(): void {
    this.dirs.clear();
  }
}
