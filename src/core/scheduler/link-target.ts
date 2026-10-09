import { realpath } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import type { AbsolutePath, RelativePath } from "../types/index.js";

/**
 * The in-scope target spelling of each observed file path whose directory is
 * reached through a symlink, whether the file exists or not (task 001-148).
 * The recorder keys a link with its kept target (task 001-135), but only a
 * target `realpath` resolves: a file read through a directory link before it
 * exists has none, so the run that first finds it there first observes the
 * target, and the first-observation rule (task 001-134) re-ran it a second
 * time. The target is resolved from the file's real directory instead. Kept
 * as the recorder keeps: under `root` (a realpath), outside `node_modules`
 * and `.git`.
 */
export async function linkTargets(
  root: AbsolutePath,
  paths: Iterable<RelativePath>,
): Promise<RelativePath[]> {
  const directories = new Map<string, Promise<string | null>>();
  const resolve = (directory: string) => {
    let real = directories.get(directory);
    if (real === undefined) {
      real = realpath(join(root, directory)).then(
        (abs) => (abs === root ? "" : abs.startsWith(root + sep) ? relative(root, abs) : null),
        () => null,
      );
      directories.set(directory, real);
    }
    return real;
  };
  const targets = await Promise.all(
    [...paths].map(async (path) => {
      const directory = dirname(path);
      if (directory === ".") return null;
      const real = await resolve(directory);
      if (real === null || real === directory) return null;
      const target =
        real === ""
          ? path.slice(directory.length + 1)
          : `${real}/${path.slice(directory.length + 1)}`;
      return kept(target) ? target : null;
    }),
  );
  return targets.filter((target): target is RelativePath => target !== null);
}

const kept = (path: RelativePath) =>
  !path.split("/").some((segment) => segment === "node_modules" || segment === ".git");
