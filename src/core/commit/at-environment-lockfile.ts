import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isMissing } from "../fs/errors.js";
import { runGit } from "../fs/git.js";
import { blobHash, type ObjectFormat } from "../hash/blob.js";
import { INSTALLED_ENCODING } from "../keys/environment.js";
import { PNPM_LOCKFILE, readPnpmLockfile, withoutLinkedSpecifiers } from "../keys/pnpm-lockfile.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import type { FileHash } from "../types/keys.js";
import { LS_TREE_TIMEOUT_MS } from "./tree.js";

/*
 * Spec 023 D2.2 and D2.3: the committed lockfile of one project at a commit
 * and in this worktree, and the installed-dependency part a pnpm 12 install
 * of it gives in whole-fingerprint mode. pnpm 12 commits `pnpm-lock.yaml` as
 * two YAML documents; the installed `node_modules/.pnpm/lock.yaml` is the
 * second, byte for byte (`research/environment-at-commit.md` 1). npm and
 * Yarn lockfiles are compared by blob only (step 1).
 */

/** The committed lockfile names, by manager, in the order a directory is searched. */
const COMMITTED: readonly (readonly [string, LockfileManager])[] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["package-lock.json", "other"],
  ["npm-shrinkwrap.json", "other"],
  ["yarn.lock", "other"],
  ["bun.lock", "other"],
  ["bun.lockb", "other"],
];

export type LockfileManager = "pnpm" | "other";

/** One project's committed lockfile in this worktree and at the commit. */
export interface LockfileSides {
  /** The lockfile's path; `null` when neither side holds one. */
  readonly path: RelativePath | null;
  readonly manager: LockfileManager | null;
  /** The blob of the worktree's file; `null` when it has none. */
  readonly here: FileHash | null;
  /** The blob at the commit; `null` when the commit holds none there. */
  readonly there: FileHash | null;
  /** pnpm: the worktree's text; `null` otherwise or with no file. */
  readonly hereText: string | null;
  /** pnpm: the commit's text; `null` otherwise or with no file. */
  readonly thereText: string | null;
}

/** No lockfile on either side. */
export const NO_LOCKFILE: LockfileSides = {
  path: null,
  manager: null,
  here: null,
  there: null,
  hereText: null,
  thereText: null,
};

/**
 * The nearest committed lockfile of the project at `projectDir`: the first
 * directory from it up to the worktree root where the worktree or the
 * commit (`blobs`) holds one of the names, in `COMMITTED` order. Reads the
 * worktree's file from disk and the commit's through git.
 */
export async function readLockfileSides(
  root: AbsolutePath,
  projectDir: RelativePath,
  blobs: ReadonlyMap<RelativePath, FileHash>,
  format: ObjectFormat,
): Promise<LockfileSides> {
  for (const dir of upwards(projectDir)) {
    for (const [name, manager] of COMMITTED) {
      const path = dir === "" ? name : `${dir}/${name}`;
      const bytes = await readOrNull(join(root, path));
      const there = blobs.get(path) ?? null;
      if (bytes === null && there === null) continue;
      const pnpm = manager === "pnpm";
      return {
        path,
        manager,
        here: bytes === null ? null : blobHash(bytes, format),
        there,
        hereText: pnpm && bytes !== null ? bytes.toString("utf8") : null,
        thereText: pnpm && there !== null ? await blobText(root, there) : null,
      };
    }
  }
  return NO_LOCKFILE;
}

/** `dir` and each parent up to the worktree root (`""`). */
function upwards(dir: RelativePath): RelativePath[] {
  const out: RelativePath[] = [];
  let at = dir.replace(/\/+$/, "");
  for (;;) {
    out.push(at);
    if (at === "") return out;
    const slash = at.lastIndexOf("/");
    at = slash < 0 ? "" : at.slice(0, slash);
  }
}

async function readOrNull(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if (isMissing(error) || (error as NodeJS.ErrnoException).code === "EISDIR") return null;
    throw error;
  }
}

/** The text of the blob `id`. */
export function blobText(root: AbsolutePath, id: FileHash): Promise<string> {
  return runGit(root, ["cat-file", "blob", id], { timeoutMs: LS_TREE_TIMEOUT_MS });
}

/**
 * The installed lockfile a pnpm 12 install of the committed `text` writes:
 * its second YAML document. `null` for a file of one document (another
 * pnpm), whose install this slice does not derive.
 */
export function installedLockText(text: string): string | null {
  const documents = text.split(/^---\n/m);
  return documents.length === 3 && documents[0] === "" ? (documents[2] ?? null) : null;
}

/**
 * The installed-dependency part of the environment hash in whole-fingerprint
 * mode, for an install of the committed pnpm lockfile `text` that is not
 * stale and has no patches directory: `installedDependencies`' value for
 * `node_modules/.pnpm/lock.yaml`. `null` when `installedLockText` is.
 */
export function installedPart(text: string): string | null {
  const installed = installedLockText(text);
  if (installed === null) return null;
  return createHash("sha256")
    .update(`${PNPM_LOCKFILE}\0`)
    .update(`${INSTALLED_ENCODING}\0${withoutLinkedSpecifiers(installed)}`)
    .digest("hex");
}

/**
 * The versions the committed pnpm lockfile `text` resolves `runner` to, one
 * per importer that declares it, sorted, peer suffixes left out; empty when
 * no importer declares it (node:test, say). `null` when the file does not
 * read (`readPnpmLockfile`).
 */
export function runnerPins(text: string, runner: string): string[] | null {
  const installed = installedLockText(text);
  const lockfile = installed === null ? null : readPnpmLockfile(installed);
  if (lockfile === null) return null;
  const pins = new Set<string>();
  for (const declared of lockfile.importers.values()) {
    const version = declared.get(runner);
    if (version !== undefined) pins.add(version.replace(/\(.*$/, ""));
  }
  return [...pins].sort();
}
