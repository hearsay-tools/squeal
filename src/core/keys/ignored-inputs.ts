import { runGit, splitNul } from "../fs/index.js";
import type { AbsolutePath, RelativePath } from "../types/index.js";
import { createInputMatcher } from "./glob.js";

/** Installed packages enter keys through the environment hash (D3), never as declared inputs. */
const INSTALLED = ":(exclude,glob)**/node_modules/**";

/**
 * The gitignored files under `root` that policy input `globs` select, sorted:
 * a build output a declaration names, which no tracked file stands for
 * (spec 004 D6, lessons defect 7). Git walks only the literal directory each
 * glob starts with; a glob that starts with a wildcard walks the worktree.
 * Nothing under a `node_modules` directory is returned.
 */
export async function ignoredInputs(
  root: AbsolutePath,
  globs: readonly string[],
): Promise<RelativePath[]> {
  if (globs.length === 0) return [];
  const prefixes = [...new Set(globs.map(literalPrefix))];
  const pathspecs = prefixes.includes("") ? ["."] : prefixes.map((p) => `:(literal)${p}`);
  const listed = splitNul(
    await runGit(root, [
      "ls-files",
      "-z",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--",
      ...pathspecs,
      INSTALLED,
    ]),
  );
  const matches = createInputMatcher(globs);
  return listed.filter((path) => matches(path) && !path.split("/").includes("node_modules")).sort();
}

/** The leading segments of `glob` that hold no wildcard, joined; `""` when the first one does. */
export function literalPrefix(glob: string): string {
  const segments = (glob.startsWith("./") ? glob.slice(2) : glob).split("/");
  const wild = segments.findIndex((segment) => /[*?[{]/.test(segment));
  return (wild === -1 ? segments : segments.slice(0, wild)).join("/");
}
