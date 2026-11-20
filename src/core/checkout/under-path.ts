import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/*
 * Row 023-31, review wave-18 B1: whether a process's path lies under a
 * checkout. Only whole path arguments count: an argument that is an absolute
 * path, or the value of `--option=<path>`. Each is resolved as the kernel
 * would (symlinks, `..`) and compared with the checkout's real path by whole
 * components. A checkout path embedded in another path, a sibling whose name
 * only starts with the checkout's, and `<checkout>/../x` are not under it.
 */

/**
 * The real path of `path`: the kernel's resolution when it exists; else its
 * longest existing ancestor's real path with the rest appended.
 */
export function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    // Missing, or not readable: resolve what exists of it.
  }
  const rest: string[] = [];
  let at = resolve(path);
  for (let up = dirname(at); up !== at; up = dirname(at)) {
    rest.unshift(basename(at));
    at = up;
    try {
      return join(realpathSync(at), ...rest);
    } catch {
      // Not there either: one folder up.
    }
  }
  return resolve(path);
}

/** `path` is `folder` or lies below it, both canonical, compared by whole components. */
export function contains(folder: string, path: string): boolean {
  return path === folder || path.startsWith(folder.endsWith("/") ? folder : `${folder}/`);
}

/**
 * The absolute paths `argv` names whole: an argument that is one, or the
 * value of `--option=<path>`. A process that rewrote its arguments into one
 * string (Chrome's helpers) is split at spaces.
 */
export function pathArgs(argv: readonly string[]): string[] {
  const only = argv.length === 1 ? argv[0] : undefined;
  const args = only?.includes(" ") === true ? only.split(" ") : argv;
  const paths: string[] = [];
  for (const arg of args) {
    const value = /^--?[^=/]+=(.*)$/s.exec(arg)?.[1] ?? arg;
    if (value.startsWith("/")) paths.push(value);
  }
  return paths;
}

/** A cwd (`/proc/<pid>/cwd`) or a path argument of `argv` lies under `folder`, canonical. */
export function underFolder(folder: string, cwd: string | null, argv: readonly string[]): boolean {
  const bare = cwd?.endsWith(" (deleted)") === true ? cwd.slice(0, -" (deleted)".length) : cwd;
  if (bare !== null && contains(folder, bare)) return true;
  return pathArgs(argv).some((path) => contains(folder, canonical(path)));
}
