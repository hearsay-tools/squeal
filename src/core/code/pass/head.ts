import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findWorktreeRoot, gitDirOf, runGit } from "../../fs/index.js";
import type { AbsolutePath, FileHash, RelativePath, RevisionNumber } from "../../types/index.js";
import type { PassContext } from "./pass.js";

/** Long enough for a batch of paths on a loaded host; a git that takes longer leaves every edit marked. */
const GIT_TIMEOUT_MS = 10_000;

/**
 * 015-34: the files a stopped merge, cherry-pick, revert or rebase step
 * leaves in the git dir, and the revision whose blobs each brings. A
 * revert brings the reverted commit's parent.
 */
const OPERATIONS: readonly (readonly [file: string, rev: (sha: string) => string])[] = [
  ["MERGE_HEAD", (sha) => sha],
  ["CHERRY_PICK_HEAD", (sha) => sha],
  ["REVERT_HEAD", (sha) => `${sha}^`],
  ["REBASE_HEAD", (sha) => sha],
];

/** A rebase under way, stopped or between steps, keeps one of these in the git dir. */
const REBASE_DIRS = ["rebase-merge", "rebase-apply"];

const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/**
 * Spec 015 D6 as amended by 015-19 and 015-34: git's change is not the
 * agent's edit. The paths of `files` whose blob is their blob at a
 * revision git brought them from: the new `HEAD` when a revision after
 * `since` moved it (a pull, merge, rebase or checkout), and each
 * operation under way (`operationRevisions`). A file gone, its `blob`
 * `null`, is git's when it is gone at such a revision too (015-38). Their
 * changed bodies mark no first edit, and a `PASS` or `RESOLVED` they bring
 * is taken in by count (`pulled.ts`). Empty when there is none, and when
 * git cannot say, so an edit is marked as it was before 015-19.
 */
export async function committedPaths(
  ctx: Pick<PassContext, "root" | "source" | "log">,
  since: RevisionNumber,
  upTo: RevisionNumber,
  files: readonly { readonly path: RelativePath; readonly blob: FileHash | null }[],
): Promise<Set<RelativePath>> {
  // One request per line: a path holding a line feed cannot be asked, so it keeps its edit.
  const asked = files.filter((f) => !f.path.includes("\n"));
  if (asked.length === 0) return new Set();
  const head = ctx.source.movedHead(since, upTo);
  const revs = [...new Set([...(head === null ? [] : [head]), ...operationRevisions(ctx.root)])];
  if (revs.length === 0) return new Set();
  let out: string;
  try {
    out = await runGit(ctx.root, ["cat-file", "--batch-check=%(objectname) %(objecttype)"], {
      // `./`: relative to the root, which may sit below the repository's top.
      input: revs.flatMap((rev) => asked.map((f) => `${rev}:./${f.path}\n`)).join(""),
      timeoutMs: GIT_TIMEOUT_MS,
    });
  } catch (error) {
    ctx.log(`complexity: could not read the files at ${revs.join(", ")}: ${String(error)}`);
    return new Set();
  }
  const lines = out.split("\n");
  return new Set(
    asked
      .filter((f, i) =>
        revs.some((rev, r) => {
          const line = lines[r * asked.length + i];
          return f.blob === null ? line === `${rev}:./${f.path} missing` : blobOf(line) === f.blob;
        }),
      )
      .map((f) => f.path),
  );
}

/**
 * 015-34: the revisions an operation under way in the worktree at `root`
 * brings files from, read from its git dir without spawning git: each
 * commit `MERGE_HEAD` names, `CHERRY_PICK_HEAD`, the parent of
 * `REVERT_HEAD`, `REBASE_HEAD`, and `HEAD` while a rebase is under way, as
 * it moves `HEAD` at each step and a revision can see a step's files after
 * its `HEAD`. Empty when none is.
 */
export function operationRevisions(root: AbsolutePath): string[] {
  const top = findWorktreeRoot(root);
  const gitDir = top === null ? null : gitDirOf(top);
  if (gitDir === null) return [];
  const revs = OPERATIONS.flatMap(([file, rev]) => shasIn(join(gitDir, file)).map(rev));
  if (REBASE_DIRS.some((dir) => existsSync(join(gitDir, dir)))) revs.push("HEAD");
  return revs;
}

/** The commit ids a pseudo-ref file holds, one per line; none when it cannot be read, so each edit stays marked. */
function shasIn(path: string): string[] {
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => SHA.test(line));
  } catch {
    return [];
  }
}

/** The object id of a `%(objectname) %(objecttype)` line naming a blob; `null` for `<input> missing` and the like. */
function blobOf(line: string | undefined): string | null {
  const [id, type, rest] = (line ?? "").split(" ");
  return type === "blob" && rest === undefined && id !== undefined && /^[0-9a-f]+$/.test(id)
    ? id
    : null;
}
