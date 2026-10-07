import { createHash } from "node:crypto";
import { type Dirent, lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { compare, isMissing, isRecord } from "../fs/index.js";
import type { AbsolutePath } from "../types/index.js";

/** npm's hidden lockfile, relative to the directory that holds `node_modules`. */
export const HIDDEN_LOCKFILE = "node_modules/.package-lock.json";

/** Bumped when the fallback encoding below changes. */
const PACKAGE_FOLDERS_ENCODING = "squeal-package-folders/1";

/** A package folder in the `node_modules` hierarchy, relative to its root with `/` separators. */
interface PackageFolder {
  readonly path: string;
  /** A symlink, such as a workspace link: compared by `lstat`, never followed. */
  readonly link: boolean;
  readonly mtimeMs: number;
}

/**
 * Why npm would not trust the hidden lockfile of the install at `dir`, as one
 * sentence fragment, or `null` when it would.
 *
 * Task 001-104, npm's rule (`package-lock-json`, "Hidden Lockfiles"): the file
 * counts only when "no package folders exist in the `node_modules` hierarchy
 * that are not listed in the lockfile" and "the modified time of the file is
 * at least as recent as all of the package folders it references". A listed
 * folder that is missing fails too. Workspace links are compared with `lstat`
 * and not followed: their targets are live project directories. Directory
 * mtimes change when an entry is added, removed or renamed, so an install that
 * replaced a folder without rewriting the file shows; an edit inside a file
 * does not, for npm either.
 */
export function staleHiddenLockfile(dir: AbsolutePath, content: Buffer): string | null {
  const listed = listedPackages(content);
  if (listed === null) return "not valid JSON";
  const lockTime = lstatSync(join(dir, HIDDEN_LOCKFILE)).mtimeMs;
  const folders = packageFolders(dir, workspaces(listed));
  const seen = new Set(folders.map((folder) => folder.path));

  const unlisted = folders
    .filter((folder) => !Object.hasOwn(listed, folder.path))
    .map((folder) => folder.path);
  const newer = folders.filter(
    (folder) => Object.hasOwn(listed, folder.path) && folder.mtimeMs > lockTime,
  );
  const missing = Object.keys(listed).filter((path) => isInstalledFolder(path) && !seen.has(path));
  const parts = [
    ["not listed in it", unlisted],
    ["newer than it", newer.map((folder) => folder.path)],
    ["missing", missing],
  ] as const;
  const reasons = parts
    .filter(([, paths]) => paths.length > 0)
    .map(([label, paths]) => `${label}: ${example(paths)}`);
  return reasons.length === 0 ? null : reasons.join("; ");
}

/**
 * Fingerprint of the install at `dir` from its package folders, for when the
 * hidden lockfile does not describe it: each folder's path and its
 * `package.json` name and version, and each link's path and target, unread.
 * Adding, removing, moving or re-versioning a package changes it.
 */
export function packageFoldersFingerprint(dir: AbsolutePath, content: Buffer): string {
  const folders = packageFolders(dir, workspaces(listedPackages(content) ?? {}));
  folders.sort((a, b) => compare(a.path, b.path));
  const entries = folders.map(({ path, link }) =>
    link ? [path, "link", readlinkSync(join(dir, path))] : [path, ...nameAndVersion(dir, path)],
  );
  return createHash("sha256")
    .update(JSON.stringify([PACKAGE_FOLDERS_ENCODING, entries]))
    .digest("hex");
}

/** The lockfile's `packages` map, or `null` when it is not JSON. */
function listedPackages(content: Buffer): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.toString("utf8"));
  } catch {
    return null;
  }
  return isRecord(parsed) && isRecord(parsed.packages) ? parsed.packages : {};
}

/** Whether a lockfile location is a folder under some `node_modules`, inside the install. */
function isInstalledFolder(path: string): boolean {
  return (
    insideInstall(path) && (path.startsWith("node_modules/") || path.includes("/node_modules/"))
  );
}

/** Locations outside the install directory (`file:` dependencies) are never walked or required. */
function insideInstall(path: string): boolean {
  return path !== "" && !isAbsolute(path) && path !== ".." && !path.startsWith("../");
}

/** Workspace folders the lockfile lists: their own `node_modules` belong to the hierarchy. */
function workspaces(listed: Record<string, unknown>): string[] {
  return Object.keys(listed).filter((path) => insideInstall(path) && !isInstalledFolder(path));
}

/**
 * Package folders under `node_modules` and each workspace's `node_modules`,
 * recursively, with their `lstat` mtimes. Synchronous: on `cezar`'s 470
 * packages the asynchronous walk waited on the thread pool past the 25 ms
 * budget (001-104).
 */
function packageFolders(dir: AbsolutePath, workspaceFolders: readonly string[]): PackageFolder[] {
  const folders: PackageFolder[] = [];
  const visit = (path: string, entry: Dirent): void => {
    if (!entry.isSymbolicLink() && !entry.isDirectory()) return;
    const link = entry.isSymbolicLink();
    folders.push({ path, link, mtimeMs: lstatSync(join(dir, path)).mtimeMs });
    if (!link) walk(`${path}/node_modules`);
  };
  const walk = (modules: string): void => {
    for (const entry of entriesOf(join(dir, modules))) {
      if (entry.name.startsWith(".")) continue;
      const path = `${modules}/${entry.name}`;
      if (entry.name.startsWith("@") && entry.isDirectory()) {
        for (const child of entriesOf(join(dir, path))) visit(`${path}/${child.name}`, child);
      } else {
        visit(path, entry);
      }
    }
  };
  for (const path of ["", ...workspaceFolders])
    walk(path === "" ? "node_modules" : `${path}/node_modules`);
  return folders;
}

function entriesOf(path: string): Dirent[] {
  try {
    return readdirSync(path, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error) || (error as NodeJS.ErrnoException).code === "ENOTDIR") return [];
    throw error;
  }
}

/** A folder's `package.json` name and version; `null` for each that is absent or unreadable. */
function nameAndVersion(dir: AbsolutePath, path: string): [unknown, unknown] {
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(dir, path, "package.json"), "utf8"));
    if (!isRecord(manifest)) return [null, null];
    return [manifest.name ?? null, manifest.version ?? null];
  } catch {
    return [null, null];
  }
}

/** The first path, sorted, and how many more. */
function example(paths: readonly string[]): string {
  const [first] = [...paths].sort(compare);
  return paths.length === 1 ? `${first}` : `${first} and ${paths.length - 1} more`;
}
