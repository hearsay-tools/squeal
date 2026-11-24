import { execFile } from "node:child_process";
import { lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { runGit, splitNul } from "../../fs/git.js";
import { readObjectFormat } from "../../hash/git-index.js";
import { RACY_WINDOW_MS } from "../../hash/stat-cache.js";
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

const STAT_CONCURRENCY = 64;
const AUTOCRLF_ON = new Set(["true", "input", "yes", "on", "1"]);
const CONVERTING_ATTRIBUTES = ["eol", "text", "crlf", "filter", "ident", "working-tree-encoding"];

interface CleanIndexCandidate {
  readonly oid: string;
  readonly isLink: boolean;
}

interface DiskStat {
  readonly isLink: boolean;
  readonly executable: boolean;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly mode: number;
}

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

async function statOne(root: AbsolutePath, path: string): Promise<DiskStat | null> {
  try {
    const info = await lstat(join(root, path));
    const isLink = info.isSymbolicLink();
    if (!isLink && !info.isFile()) return null;
    return {
      isLink,
      executable: !isLink && (info.mode & 0o111) !== 0,
      ino: info.ino,
      size: info.size,
      mtimeMs: info.mtimeMs,
      ctimeMs: info.ctimeMs,
      mode: info.mode,
    };
  } catch {
    return null;
  }
}

async function statAll(
  root: AbsolutePath,
  paths: readonly string[],
): Promise<Map<string, DiskStat>> {
  const result = new Map<string, DiskStat>();
  let next = 0;
  const worker = async () => {
    while (next < paths.length) {
      const path = paths[next++];
      if (path === undefined) continue;
      const info = await statOne(root, path);
      if (info !== null) result.set(path, info);
    }
  };
  const count = Math.min(STAT_CONCURRENCY, paths.length);
  await Promise.all(Array.from({ length: count }, worker));
  return result;
}

function sameDiskStat(a: DiskStat, b: DiskStat): boolean {
  return (
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs &&
    a.mode === b.mode
  );
}

/**
 * Clean SHA-1 index entries whose bytes on disk equal their Git blob id,
 * keyed by worktree-relative path. Mirrors `readCleanIndexHashes` soundness:
 * skips dirty, unmerged, assume-unchanged, skip-worktree, submodule,
 * `core.autocrlf`, and any file with a converting Git attribute (from any
 * tracked, untracked, info, configured, or global attributes source).
 */
async function cleanIndexEntries(root: AbsolutePath): Promise<Map<string, CleanIndexCandidate>> {
  const [autocrlf, staged, status] = await Promise.all([
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
  ]);
  if (AUTOCRLF_ON.has(autocrlf.trim().toLowerCase())) return new Map();

  const listed = new Set(splitNul(status).map((line) => line.slice(3)));
  const clean = new Map<string, CleanIndexCandidate>();
  for (const line of splitNul(staged)) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const [tag, mode, oid, stage] = line.slice(0, tab).split(" ");
    const path = line.slice(tab + 1);
    if (tag !== "H" || stage !== "0" || oid === undefined || !insideRoot(path) || listed.has(path))
      continue;
    if (mode === "100644" || mode === "100755") clean.set(path, { oid, isLink: false });
    else if (mode === "120000") clean.set(path, { oid, isLink: true });
  }
  if (clean.size === 0) return clean;

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

/**
 * The tree's entries, reusing clean SHA-1 Git index blobs when disk `lstat`
 * matches before and after the index check, the file type matches the index
 * entry, and the file is outside `RACY_WINDOW_MS`. File type and executable
 * permissions always come from disk `lstat` (safe under `core.filemode=false`
 * and `core.symlinks=false`).
 */
export async function treeEntries(root: AbsolutePath): Promise<TreeEntry[]> {
  const [paths, format] = await Promise.all([
    treePaths(root),
    readObjectFormat(root).catch(() => null),
  ]);
  if (paths.length === 0) return [];
  if (format !== "sha1") {
    const entries: TreeEntry[] = [];
    for (const path of paths) {
      const read = await readEntry(root, path);
      if (read !== null) entries.push(read.entry);
    }
    return entries;
  }

  const checkStartedAt = Date.now();
  const before = await statAll(root, paths);
  const clean = await cleanIndexEntries(root);
  const after =
    clean.size > 0 ? await statAll(root, [...clean.keys()]) : new Map<string, DiskStat>();

  const entries: TreeEntry[] = [];
  for (const path of paths) {
    const cand = clean.get(path);
    const b = before.get(path);
    const a = after.get(path);
    if (
      cand !== undefined &&
      b !== undefined &&
      a !== undefined &&
      cand.isLink === a.isLink &&
      sameDiskStat(b, a) &&
      checkStartedAt - a.mtimeMs >= RACY_WINDOW_MS
    ) {
      if (a.isLink) entries.push({ path, blob: cand.oid, mode: "link" });
      else entries.push({ path, blob: cand.oid, ...(a.executable ? { mode: "x" as const } : {}) });
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
