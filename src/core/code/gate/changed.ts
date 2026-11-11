import { lstat, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { readHead } from "../../daemon-loop/head.js";
import { compare } from "../../fs/compare.js";
import { isMissing } from "../../fs/errors.js";
import { runGit, splitNul } from "../../fs/git.js";
import { blobHash, type ObjectFormat } from "../../hash/blob.js";
import { readObjectFormat } from "../../hash/git-index.js";
import { createInputMatcher } from "../../keys/glob.js";
import {
  CODE_EXTENSIONS,
  type CodeLanguage,
  type FileCount,
  type FunctionCount,
} from "../../types/code.js";
import type { AbsolutePath, RelativePath } from "../../types/common.js";
import type { FileHash } from "../../types/keys.js";
import { countFile } from "../count/index.js";
import { overlaps } from "../pass/counted.js";
import { omittedFunctions } from "./omitted.js";
import type { BasePolicy } from "./policy.js";
import type { ChangedFunction, ChangedSet, CountedPath, UncountedPath } from "./types.js";

/*
 * Spec 020 D2: the functions the working tree changed against the merge base
 * of a ref, counted with 015's counter (015 D3) under 015 D2's identities.
 */

/** D6: the keys D2 counts by, read at the base (`loadBasePolicy`). */
export type CountPolicy = Pick<BasePolicy, "include" | "exclude" | "maxFileBytes">;

/** `--base` names no commit, or one with no common commit with `HEAD`: a setup error (D1, exit 2). */
export class BaseRefError extends Error {}

/** `git merge-base <ref> HEAD` in `cwd`; throws `BaseRefError` when there is none. */
export async function mergeBase(cwd: AbsolutePath, ref: string): Promise<string> {
  if (ref === "" || ref.startsWith("-")) throw new BaseRefError(`"${ref}" is not a ref`);
  const verify = ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`];
  const commit = (await runGit(cwd, verify, { okCodes: [0, 1, 128] })).trim();
  if (commit === "") throw new BaseRefError(`"${ref}" names no commit`);
  const base = (await runGit(cwd, ["merge-base", commit, "HEAD"], { okCodes: [0, 1, 128] })).trim();
  if (base === "") throw new BaseRefError(`"${ref}" and HEAD have no common commit`);
  return base;
}

/**
 * D2: every JS/TS function that changed between `git merge-base <ref> HEAD`
 * and the working tree, untracked files and test files included. `cwd` is
 * the worktree root; paths are relative to it. `policy` is read at the base.
 *
 * - `paths`: `git diff --name-only <base>` (renames as a removal and an
 *   addition) plus untracked files git does not ignore, every one of them
 *   (D3.1 selects tests from them). The paths counted are those with an
 *   extension of the TS grammar, inside `include`, outside `exclude` and
 *   outside `node_modules`.
 * - A head function whose body hash a base function of any counted path
 *   has is unchanged, moved or shifted, and is not returned. Every other one
 *   is `edited` when its identity is at the base in its path, else `added`;
 *   moved and edited reads as added. Removed functions are not returned.
 * - `counted`: each path counted at the head, with all of its functions.
 * - A head file with a parse error is in `counted` and also in `uncounted`
 *   as `parse-error`, since an error range can hide a changed function no
 *   count names. Its changed functions that overlap an error range are in
 *   `inErrors`, not in `functions`.
 * - A head file over `maxFileBytes` is `too-large`, and one that is not a
 *   regular file (a symlink) is `unsupported`; neither is in `counted`. A
 *   base file over the limit is not counted, so its head functions read as
 *   added unless their bodies are elsewhere at the base.
 * - Each `uncounted` regular file carries its head blob, for the report's
 *   provenance (D7); an `unsupported` path has none.
 * - `baseCounted`: each counted path as the base holds it, for D8's
 *   inherited exceptions (row 020-09).
 * - `omitted`: the head functions it does not return that a changed line
 *   touches, with why (D16, row 020-18).
 */
export async function changedFunctions(
  cwd: AbsolutePath,
  ref: string,
  policy: CountPolicy,
): Promise<ChangedSet> {
  const baseCommit = await mergeBase(cwd, ref);
  const [head, format, { all, untracked }] = await Promise.all([
    readHead(cwd),
    readObjectFormat(cwd),
    changedPaths(cwd, baseCommit),
  ]);
  const paths = countedPaths(all, policy);
  if (head.head === null) throw new BaseRefError("HEAD names no commit");
  const bases = await countsAtBase(cwd, baseCommit, paths, policy.maxFileBytes);
  const heads = new Map<RelativePath, FileCount>();
  const uncounted: UncountedPath[] = [];
  for (const [path, language] of paths) {
    const now = await countAtHead(join(cwd, path), language, format, policy.maxFileBytes);
    if (now === null) continue;
    if (now === "unsupported") {
      uncounted.push({ path, reason: now });
      continue;
    }
    if ("tooLarge" in now) {
      uncounted.push({ path, reason: "too-large", blob: now.tooLarge });
      continue;
    }
    heads.set(path, now);
    if (now.errors.length > 0) uncounted.push({ path, reason: "parse-error", blob: now.blob });
  }
  const atBase = bodies(bases.values());
  const atHead = bodies(heads.values());
  const functions: ChangedFunction[] = [];
  const inErrors: ChangedFunction[] = [];
  const counted: CountedPath[] = [];
  const skipped = new Map<RelativePath, FunctionCount[]>();
  for (const [path, now] of heads) {
    counted.push({ path, blob: now.blob, functions: now.functions });
    // An identity whose base body is gone from the head was edited; one whose body lives on shifted or moved.
    const edited = new Set(
      bases
        .get(path)
        ?.functions.filter((f) => !atHead.has(f.bodyHash))
        .map(identity),
    );
    const unjudged: FunctionCount[] = [];
    skipped.set(path, unjudged);
    for (const count of now.functions) {
      if (atBase.has(count.bodyHash)) {
        unjudged.push(count);
        continue;
      }
      const change = edited.has(identity(count)) ? "edited" : "added";
      const into = now.errors.some((e) => overlaps(count.range, e)) ? inErrors : functions;
      into.push({ path, blob: now.blob, change, count });
    }
  }
  const omitted = await omittedFunctions(skipped, { cwd, baseCommit, bases, untracked });
  return {
    ref,
    baseCommit,
    headCommit: head.head,
    dirty: head.dirty,
    paths: all,
    functions,
    counted,
    inErrors,
    uncounted,
    baseCounted: [...bases]
      .map(([path, c]) => ({ path, blob: c.blob, functions: c.functions }))
      .sort((a, b) => compare(a.path, b.path)),
    omitted,
  };
}

/**
 * D2.1 and D3.1: every changed and untracked path, removed ones included,
 * sorted; and the untracked ones, whose every line is changed (D16).
 */
async function changedPaths(
  cwd: AbsolutePath,
  baseCommit: string,
): Promise<{ all: RelativePath[]; untracked: Set<RelativePath> }> {
  const [diff, untracked] = await Promise.all([
    runGit(cwd, [
      "diff",
      "--name-only",
      "--no-renames",
      "--ignore-submodules=all",
      "-z",
      baseCommit,
    ]),
    runGit(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  const added = new Set(splitNul(untracked));
  return { all: [...new Set([...splitNul(diff), ...added])].sort(compare), untracked: added };
}

/** D2.1: of `paths`, the ones the gate counts, with their language. */
function countedPaths(
  paths: readonly RelativePath[],
  policy: CountPolicy,
): Map<RelativePath, CodeLanguage> {
  const include = createInputMatcher(policy.include);
  const exclude = createInputMatcher(policy.exclude);
  const counted = new Map<RelativePath, CodeLanguage>();
  for (const path of paths) {
    const language = CODE_EXTENSIONS[extname(path)];
    if (language === undefined || language === "python") continue;
    if (path.startsWith("node_modules/") || path.includes("/node_modules/")) continue;
    if (include(path) && !exclude(path)) counted.set(path, language);
  }
  return counted;
}

/** Each path's count at `baseCommit`; absent when it is not there, over `maxFileBytes` or not a blob. */
async function countsAtBase(
  cwd: AbsolutePath,
  baseCommit: string,
  paths: ReadonlyMap<RelativePath, CodeLanguage>,
  maxFileBytes: number,
): Promise<Map<RelativePath, FileCount>> {
  // One request per line: a path holding a line feed cannot be asked, so its functions read as added.
  const asked = [...paths].filter(([path]) => !path.includes("\n"));
  const counts = new Map<RelativePath, FileCount>();
  if (asked.length === 0) return counts;
  const check = await runGit(
    cwd,
    ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
    // `cwd` is the worktree's top, so git's paths are relative to it.
    { input: asked.map(([path]) => `${baseCommit}:${path}\n`).join("") },
  );
  const lines = check.split("\n");
  for (const [i, [path, language]] of asked.entries()) {
    const [oid, type, size] = (lines[i] ?? "").split(" ");
    if (oid === undefined || type !== "blob" || Number(size) > maxFileBytes) continue;
    const text = await runGit(cwd, ["cat-file", "blob", oid]);
    counts.set(path, await countFile(text, language, oid));
  }
  return counts;
}

/**
 * The count of the file at `file` as it is on disk; `null` when it is gone
 * (removed); the blob of a file over `maxFileBytes`, which is read but not
 * counted; or `unsupported` for one that is not a regular file.
 */
async function countAtHead(
  file: AbsolutePath,
  language: CodeLanguage,
  format: ObjectFormat,
  maxFileBytes: number,
): Promise<FileCount | { readonly tooLarge: FileHash } | "unsupported" | null> {
  try {
    const stat = await lstat(file);
    if (!stat.isFile()) return "unsupported";
    const bytes = await readFile(file);
    const blob = blobHash(bytes, format);
    if (bytes.byteLength > maxFileBytes) return { tooLarge: blob };
    return await countFile(bytes.toString("utf8"), language, blob);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/** 015 D2's identity within one path: qualified name and occurrence. */
function identity(f: { readonly qualifiedName: string; readonly occurrence: number }): string {
  return `${f.qualifiedName}\0${f.occurrence}`;
}

/** The body hashes of every function of `counts`. */
function bodies(counts: Iterable<FileCount>): Set<string> {
  return new Set([...counts].flatMap((c) => c.functions.map((f) => f.bodyHash)));
}
