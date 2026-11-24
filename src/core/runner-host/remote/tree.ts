import { execFile } from "node:child_process";
import { lstat, readFile, readlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { runGit, splitNul } from "../../fs/git.js";
import { readObjectFormat } from "../../hash/git-index.js";
import type { AbsolutePath } from "../../types/common.js";
import { insideRoot, packFiles, type TreeEntry, type TreeWrite, treeBlob } from "./tree-wire.js";

/*
 * Spec 021 D10 (row 021-13): the daemon's side of the remote tree. The tree
 * is every tracked file and every untracked one Git does not ignore, never
 * an ignored one (`remote-execution.md` Q3: a sync tool copied a
 * git-ignored `.env`). Git's own listing decides, so the remote holds what
 * a clone with the worktree's edits would.
 */

const run = promisify(execFile);

/** What one `write` message carries at most, in bytes before base64. */
export const WRITE_BYTES = 8 * 1024 * 1024;

/** Above this many changed paths, `treePathsFor` lists the whole tree instead of passing argv pathspecs. */
const NARROW_LIMIT = 256;

const AUTOCRLF_ON = new Set(["true", "input", "yes", "on", "1"]);
const CONVERTING_ATTRIBUTES = ["eol", "text", "crlf", "filter", "ident", "working-tree-encoding"];

/** The paths of `root`'s tree: tracked, and untracked but not ignored, each once, sorted. */
export async function treePaths(root: AbsolutePath): Promise<string[]> {
  const { stdout } = await run(
    "git",
    ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { maxBuffer: 256 * 1024 * 1024, encoding: "utf8" },
  );
  const paths = new Set(stdout.split("\0").filter((path) => path !== "" && insideRoot(path)));
  return [...paths].sort();
}

/**
 * Subset of `paths` that belong to `root`'s tree (tracked, or untracked and
 * not ignored). Avoids listing the whole repository on small invalidations.
 */
export async function treePathsFor(
  root: AbsolutePath,
  paths: readonly string[],
): Promise<Set<string>> {
  const valid = [...new Set(paths)].filter((path) => insideRoot(path));
  if (valid.length === 0) return new Set();
  if (valid.length > NARROW_LIMIT) return new Set(await treePaths(root));
  const { stdout } = await run(
    "git",
    [
      "-C",
      root,
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      ...valid.map((path) => `:(literal)${path}`),
    ],
    { maxBuffer: 64 * 1024 * 1024, encoding: "utf8" },
  );
  return new Set(stdout.split("\0").filter((path) => path !== "" && insideRoot(path)));
}

/** Whether `root` may have any gitattributes file that converts worktree bytes. */
async function hasGitAttributes(root: AbsolutePath): Promise<boolean> {
  const [tracked, configured, common] = await Promise.all([
    runGit(root, ["ls-files", "-z", "--", ".gitattributes", "**/.gitattributes"]).catch(() => ""),
    runGit(root, ["config", "--get", "core.attributesFile"], { okCodes: [0, 1] }).catch(() => ""),
    runGit(root, ["rev-parse", "--git-common-dir"]).catch(() => ""),
  ]);
  if (tracked.trim() !== "" || configured.trim() !== "") return true;
  if (common.trim() === "") return true;
  const infoPath = join(resolve(root, common.trim()), "info", "attributes");
  try {
    const text = await readFile(infoPath, "utf8");
    return text.split("\n").some((line) => {
      const trimmed = line.trim();
      return trimmed !== "" && !trimmed.startsWith("#");
    });
  } catch {
    return false;
  }
}

/**
 * Clean SHA-1 index entries whose bytes on disk equal their Git blob id,
 * keyed by worktree-relative path. Mirrors `readCleanIndexHashes` soundness
 * (skips dirty/unmerged/assume-unchanged/submodules/`core.autocrlf`/converting
 * attributes) while preserving executable and symlink modes.
 */
async function cleanIndexEntries(root: AbsolutePath): Promise<Map<string, TreeEntry>> {
  try {
    if ((await readObjectFormat(root)) !== "sha1") return new Map();
  } catch {
    return new Map();
  }
  const [autocrlf, staged, status, attrs] = await Promise.all([
    runGit(root, ["config", "--get", "core.autocrlf"], { okCodes: [0, 1] }),
    runGit(root, ["ls-files", "--stage", "-v", "-z"]),
    runGit(root, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=no",
      "--ignore-submodules=all",
      "--no-renames",
    ]),
    hasGitAttributes(root),
  ]);
  if (AUTOCRLF_ON.has(autocrlf.trim().toLowerCase())) return new Map();

  const listed = new Set(splitNul(status).map((line) => line.slice(3)));
  const clean = new Map<string, TreeEntry>();
  for (const line of splitNul(staged)) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const [tag, mode, oid, stage] = line.slice(0, tab).split(" ");
    const path = line.slice(tab + 1);
    if (tag !== "H" || stage !== "0" || oid === undefined || !insideRoot(path) || listed.has(path))
      continue;
    if (mode === "100644") clean.set(path, { path, blob: oid });
    else if (mode === "100755") clean.set(path, { path, blob: oid, mode: "x" });
    else if (mode === "120000") clean.set(path, { path, blob: oid, mode: "link" });
  }
  if (!attrs || clean.size === 0) return clean;

  const checked = await runGit(root, ["check-attr", "-z", "--stdin", ...CONVERTING_ATTRIBUTES], {
    input: `${[...clean.keys()].join("\0")}\0`,
  });
  const fields = splitNul(checked);
  for (let i = 0; i + 2 < fields.length; i += 3) {
    if (fields[i + 2] !== "unspecified") clean.delete(fields[i] ?? "");
  }
  return clean;
}

/** A file of the tree as it is on disk now, with its bytes; `null` when it is no file or link. */
export async function readEntry(
  root: AbsolutePath,
  path: string,
): Promise<{ entry: TreeEntry; bytes: Buffer } | null> {
  const at = join(root, path);
  try {
    const stat = await lstat(at);
    if (stat.isSymbolicLink()) {
      const bytes = Buffer.from(await readlink(at), "utf8");
      return { entry: { path, blob: treeBlob(bytes), mode: "link" }, bytes };
    }
    if (!stat.isFile()) return null;
    const bytes = await readFile(at);
    const x = (stat.mode & 0o111) !== 0;
    return { entry: { path, blob: treeBlob(bytes), ...(x ? { mode: "x" as const } : {}) }, bytes };
  } catch {
    // Gone since the listing, or unreadable: not part of the tree now.
    return null;
  }
}

/** The tree's entries, reusing clean SHA-1 Git index blobs and reading only dirty or untracked paths. */
export async function treeEntries(root: AbsolutePath): Promise<TreeEntry[]> {
  const [paths, clean] = await Promise.all([treePaths(root), cleanIndexEntries(root)]);
  const entries: TreeEntry[] = [];
  for (const path of paths) {
    const indexed = clean.get(path);
    if (indexed !== undefined) {
      entries.push(indexed);
      continue;
    }
    const read = await readEntry(root, path);
    if (read !== null) entries.push(read.entry);
  }
  return entries;
}

/**
 * The writes that bring a remote to `paths` as they are on disk now: a path
 * of the tree with its bytes, a path that is no longer in it (deleted, or
 * ignored now) removed. Split so that no message carries much more than
 * `WRITE_BYTES` before compression; a larger file goes alone.
 */
export async function writesFor(
  root: AbsolutePath,
  paths: readonly string[],
  tree: ReadonlySet<string>,
  limit: number = WRITE_BYTES,
): Promise<TreeWrite[]> {
  const writes: TreeWrite[] = [];
  let files: { entry: TreeEntry; bytes: Buffer }[] = [];
  let removed: string[] = [];
  let size = 0;
  const flush = async () => {
    if (files.length > 0 || removed.length > 0)
      writes.push({ ...(await packFiles(files)), removed });
    files = [];
    removed = [];
    size = 0;
  };
  for (const path of [...new Set(paths)].sort()) {
    if (!insideRoot(path)) continue;
    const read = tree.has(path) ? await readEntry(root, path) : null;
    if (read === null) {
      removed.push(path);
      continue;
    }
    if (size > 0 && size + read.bytes.byteLength > limit) await flush();
    files.push(read);
    size += read.bytes.byteLength;
  }
  await flush();
  return writes;
}
