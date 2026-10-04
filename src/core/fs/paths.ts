import { isAbsolute, join, relative, sep } from "node:path";
import type { AbsolutePath, RelativePath } from "../types/index.js";

/**
 * `abs` relative to `root` with `/` separators, or `null` when it is the root
 * or outside it. Outside means a first segment of exactly `..`: a root-level
 * file named `..foo` is inside.
 */
export function toRelative(root: AbsolutePath, abs: AbsolutePath): RelativePath | null {
  const rel = relative(root, abs);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return sep === "/" ? rel : rel.split(sep).join("/");
}

export function toAbsolute(root: AbsolutePath, rel: RelativePath): AbsolutePath {
  return join(root, ...rel.split("/"));
}
