import { runGit, splitNul } from "../fs/index.js";
import type { AbsolutePath, RelativePath } from "../types/index.js";

/**
 * Which changed paths git ignores when a revision records them, for
 * `FileChange.ignored` (row 011-262). That the daemon watches a path as an
 * extra file does not prove it (review 0.1.379 B1): `git add -f` or a
 * `.gitignore` edit makes git see it, while it stays an extra file until a
 * restart. So the extra files among a revision's changes go through one
 * `git check-ignore`, which never reports a tracked path; with none, no git
 * process runs.
 *
 * A mark needs git's answer. When git refuses a path, one in a submodule or
 * beyond a symlink say, or fails, the revision marks nothing, and a note
 * says why, once per text. The watcher's `checkIgnored` counts a refused
 * path as ignored instead, which is right for what to watch, not for a
 * claim. Off the validity path: no key reads a mark.
 */
export class IgnoredMarks {
  readonly #noted = new Set<string>();

  constructor(
    private readonly root: AbsolutePath,
    private readonly extraFiles: () => readonly RelativePath[],
    private readonly note: (text: string) => void,
  ) {}

  async among(paths: readonly RelativePath[]): Promise<ReadonlySet<RelativePath>> {
    const extra = new Set(this.extraFiles());
    const asked = paths.filter((path) => extra.has(path));
    if (asked.length === 0) return new Set();
    try {
      const input = `${asked.join("\0")}\0`;
      // Exit 1 means no path is ignored.
      const out = await runGit(this.root, ["check-ignore", "-z", "--stdin"], {
        input,
        okCodes: [0, 1],
      });
      return new Set(splitNul(out));
    } catch (error) {
      const text = `A change's git-ignored mark was left off: git did not classify ${asked.join(", ")} (${String(error)}).`;
      if (!this.#noted.has(text)) {
        this.#noted.add(text);
        this.note(text);
      }
      return new Set();
    }
  }
}
