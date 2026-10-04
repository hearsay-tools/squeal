import type { AbsolutePath, FileHash, RelativePath } from "../types/index.js";
import type { ObjectFormat } from "./blob.js";
import { runGit, splitNul } from "./git.js";

/**
 * Attributes under which the index oid can differ from the bytes on disk.
 * Spec 001 D3 names `eol`, `text` and `filter`. `crlf` is the legacy spelling
 * of `text`; `ident` and `working-tree-encoding` also convert content between
 * the index and the worktree.
 */
const CONVERTING_ATTRIBUTES = ["eol", "text", "crlf", "filter", "ident", "working-tree-encoding"];

/** Regular and executable files. Symlink (120000) and gitlink (160000) oids are not file bytes. */
const FILE_MODES = new Set(["100644", "100755"]);

/** `git config core.autocrlf` values that convert line endings without any attribute. */
const AUTOCRLF_ON = new Set(["true", "input", "yes", "on", "1"]);

/** Object format of the repository at `root`. */
export async function readObjectFormat(root: AbsolutePath): Promise<ObjectFormat> {
  const format = (await runGit(root, ["rev-parse", "--show-object-format"])).trim();
  if (format !== "sha1" && format !== "sha256") {
    throw new Error(`squeal: unsupported git object format "${format}" in ${root}`);
  }
  return format;
}

/**
 * Index oids of the files whose index entry is the hash of their bytes on
 * disk, keyed by path relative to `root`.
 *
 * Spec 001 D3: the file hash "is read from the git index only when git reports
 * the file clean and no `eol`, `text` or `filter` attribute applies to it;
 * otherwise the bytes are hashed." A file is left out when:
 *
 * - `git status` lists it (staged, modified, deleted, unmerged);
 * - its entry is assume-unchanged or skip-worktree, which status trusts
 *   without looking at the file;
 * - it is not a regular file (symlink, submodule);
 * - a converting attribute applies to it;
 * - `core.autocrlf` is on, which converts every text file. The whole shortcut
 *   is skipped then.
 *
 * Callers hash every path missing from the map. Stat the files before calling
 * and again after, and use an oid only if the stat did not change in between,
 * so a write racing the status read is never paired with a stale oid.
 */
export async function readCleanIndexHashes(
  root: AbsolutePath,
): Promise<Map<RelativePath, FileHash>> {
  const [autocrlf, entries, status] = await Promise.all([
    runGit(root, ["config", "--get", "core.autocrlf"]).catch(configUnset),
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
  const candidates = new Map<RelativePath, FileHash>();
  for (const line of splitNul(entries)) {
    // "<tag> <mode> <oid> <stage>\t<path>"; tag "H" is a plain cached entry.
    const tab = line.indexOf("\t");
    const [tag, mode, oid, stage] = line.slice(0, tab).split(" ");
    const path = line.slice(tab + 1);
    if (tag !== "H" || stage !== "0" || !FILE_MODES.has(mode ?? "") || oid === undefined) continue;
    if (listed.has(path)) continue;
    candidates.set(path, oid);
  }
  if (candidates.size === 0) return candidates;

  const attributes = await runGit(
    root,
    ["check-attr", "-z", "--stdin", ...CONVERTING_ATTRIBUTES],
    `${[...candidates.keys()].join("\0")}\0`,
  );
  const fields = splitNul(attributes);
  for (let i = 0; i + 2 < fields.length; i += 3) {
    if (fields[i + 2] !== "unspecified") candidates.delete(fields[i] as RelativePath);
  }
  return candidates;
}

/** `git config --get` exits 1 when the key is unset. */
function configUnset(error: unknown): string {
  if (error instanceof Error && error.message.includes(" exited 1 ")) return "";
  throw error;
}
