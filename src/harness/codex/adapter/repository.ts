import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

/*
 * The fixed plugin's own test for "this repository uses Squeal", the one its
 * `hooks.json` shell fast path makes before Node starts (spec 001 D9, 002
 * D4): `dir` or its worktree root holds `squeal.config.json`, or the git
 * common dir holds a store (`squeal/`). The adapter pins sessions and speaks
 * diagnostics only there. It is a copy, not an import of
 * `src/harness/opencode/host.ts`, since the adapter ships frozen.
 */

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const firstLine = (path: string): string => readFileSync(path, "utf8").split("\n")[0] ?? "";

/** Whether the repository holding `dir` uses Squeal. Never throws. */
export function usesSquealAt(dir: string): boolean {
  try {
    let root = dir;
    if (isFile(join(root, "squeal.config.json"))) return true;
    while (!existsSync(join(root, ".git"))) {
      const up = dirname(root);
      if (up === root) return false;
      root = up;
    }
    if (isFile(join(root, "squeal.config.json"))) return true;
    let git = join(root, ".git");
    if (isFile(git)) {
      const named = firstLine(git)
        .replace(/^gitdir:/, "")
        .trim();
      git = isAbsolute(named) ? named : join(root, named);
      const common = isFile(join(git, "commondir")) ? firstLine(join(git, "commondir")).trim() : "";
      if (common !== "") git = isAbsolute(common) ? common : join(git, common);
    }
    return existsSync(join(git, "squeal"));
  } catch {
    return false;
  }
}
