import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { isMissing } from "../fs/index.js";
import { resolveCommonDir } from "../store/index.js";
import type { AbsolutePath, CommitSha } from "../types/index.js";

const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/** Symbolic refs followed before giving up; git itself stops at 5. */
const MAX_REF_DEPTH = 5;

/**
 * `HEAD` of the worktree at `root`, read from its git dir without spawning
 * git: a detached `HEAD` is the commit itself; `ref: <name>` is looked up as
 * a loose ref in the worktree's git dir, then in the common dir, then in
 * `packed-refs`. `null` for an unborn `HEAD` or when nothing can be read.
 *
 * Spec 001 D7 lists `HEAD` in status; until the daemon records a revision
 * (which carries `HEAD`) status reads it here.
 */
export function readGitHead(root: AbsolutePath): CommitSha {
  const gitDir = worktreeGitDir(root);
  const commonDir = resolveCommonDir(root);
  if (gitDir === null || commonDir === null) return null;
  let value = read(join(gitDir, "HEAD"));
  for (let depth = 0; depth < MAX_REF_DEPTH && value !== null; depth++) {
    if (SHA.test(value)) return value;
    const ref = /^ref:\s*(\S+)$/.exec(value)?.[1];
    if (ref === undefined) return null;
    value = read(join(gitDir, ref)) ?? read(join(commonDir, ref)) ?? packed(commonDir, ref);
  }
  return null;
}

/** `<root>/.git` when it is a directory, else the `gitdir:` it points to. */
function worktreeGitDir(root: AbsolutePath): AbsolutePath | null {
  const dotGit = join(root, ".git");
  try {
    if (statSync(dotGit).isDirectory()) return dotGit;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  const line = /^gitdir:\s*(.+?)\s*$/m.exec(read(dotGit) ?? "");
  return line?.[1] === undefined ? null : resolve(root, line[1]);
}

function packed(commonDir: AbsolutePath, ref: string): string | null {
  for (const line of (read(join(commonDir, "packed-refs")) ?? "").split("\n")) {
    const [sha, name] = line.split(" ");
    if (name === ref && sha !== undefined && SHA.test(sha)) return sha;
  }
  return null;
}

/** Trimmed file content; `null` when the file does not exist. */
function read(path: AbsolutePath): string | null {
  try {
    return readFileSync(path, "utf8").trim();
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}
