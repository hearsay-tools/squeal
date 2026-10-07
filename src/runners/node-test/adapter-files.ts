import { type Dirent, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { compare } from "../../core/fs/index.js";
import { createInputMatcher } from "../../core/keys/glob.js";
import type { AbsolutePath, NodeTestProject, RelativePath } from "../../core/types/index.js";

/** Never walked: installed packages and git's own directory. */
const SKIPPED = new Set(["node_modules", ".git"]);
const GLOB = /[*?[{]/;

/** The project's `cwd` as an absolute path; absent, empty or `.` is the root. */
export function projectCwd(root: AbsolutePath, project: NodeTestProject): AbsolutePath {
  return resolve(root, project.cwd ?? ".");
}

/**
 * Spec 003 D2: "`testFiles()` expands `include` minus `exclude` under `cwd`
 * with Squeal's own matcher." Globs are relative to `cwd`; the result is
 * worktree-relative and sorted. Only the directories the globs can reach are
 * walked, never `node_modules` or `.git`, and symbolic links are not followed.
 */
export function listTestFiles(root: AbsolutePath, project: NodeTestProject): RelativePath[] {
  const cwd = projectCwd(root, project);
  const include = createInputMatcher(project.include);
  const exclude = createInputMatcher(project.exclude ?? []);
  const found: RelativePath[] = [];
  const walk = (dir: AbsolutePath): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIPPED.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        const fromCwd = slashes(relative(cwd, path));
        if (include(fromCwd) && !exclude(fromCwd)) found.push(slashes(relative(root, path)));
      }
    }
  };
  for (const base of bases(project.include)) walk(join(cwd, base));
  return found.sort(compare);
}

/**
 * The directories, relative to `cwd`, below which the globs can match: each
 * glob's leading segments without a glob character, nested ones dropped.
 */
function bases(globs: readonly string[]): string[] {
  const all = globs.map((glob) => {
    const segments = (glob.startsWith("./") ? glob.slice(2) : glob).split("/");
    const literal: string[] = [];
    for (const segment of segments.slice(0, -1)) {
      if (GLOB.test(segment)) break;
      literal.push(segment);
    }
    return literal.join("/");
  });
  const sorted = [...new Set(all)].sort(compare);
  return sorted.filter(
    (base, i) => !sorted.slice(0, i).some((other) => other === "" || base.startsWith(`${other}/`)),
  );
}

function slashes(path: string): string {
  return path.split(sep).join("/");
}
