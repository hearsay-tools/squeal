import { type Dirent, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { compare } from "../../core/fs/index.js";
import { createInputMatcher } from "../../core/keys/glob.js";
import type { AbsolutePath, PytestProject, RelativePath } from "../../core/types/index.js";
import { projectDir } from "./environment/index.js";

/**
 * Never walked: git's own directory, installed packages, bytecode, and the
 * directories pytest's default `norecursedirs` skips that hold no project
 * tests (environments, build output).
 */
const SKIPPED = new Set(["node_modules", ".git", "__pycache__", "venv", "build", "dist"]);
const GLOB = /[*?[{]/;

/**
 * Spec 007 D3: "`testFiles()` expands `include` minus `exclude` under `cwd`
 * with Squeal's matcher." Globs are relative to `cwd`; the result is
 * worktree-relative and sorted. Only the directories the globs can reach
 * are walked, never a dot directory (`.venv`, `.tox`, `.pytest_cache`) or
 * one of {@link SKIPPED}, and symbolic links are not followed.
 */
export function listTestFiles(root: AbsolutePath, project: PytestProject): RelativePath[] {
  const cwd = projectDir(root, project);
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
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !SKIPPED.has(entry.name)) walk(path);
      } else if (entry.isFile()) {
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

export function slashes(path: string): string {
  return path.split(sep).join("/");
}
