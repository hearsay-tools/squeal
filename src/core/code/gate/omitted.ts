import { compare } from "../../fs/compare.js";
import { runGit } from "../../fs/git.js";
import type { CodeRange, FileCount, FunctionCount } from "../../types/code.js";
import type { AbsolutePath, RelativePath } from "../../types/common.js";
import type { OmittedFunction } from "./types.js";

/*
 * Spec 020 D16 (row 020-18, #177): the head functions D2 does not judge
 * that the diff's changed lines touch, each with why. Selection does not
 * change; the report says what it left out.
 */

/**
 * The head side of one hunk of `git diff -U0`: `count` lines from line
 * `start`; with `count` 0, lines removed after line `start`.
 */
interface Hunk {
  readonly start: number;
  readonly count: number;
}

/** What `changedFunctions` knows of the base and the diff. */
export interface OmitContext {
  readonly cwd: AbsolutePath;
  readonly baseCommit: string;
  /** Each changed path counted at the base. */
  readonly bases: ReadonlyMap<RelativePath, FileCount>;
  /** Untracked paths: every line of them changed. */
  readonly untracked: ReadonlySet<RelativePath>;
}

/**
 * D16.1: of the head functions D2 skipped, by path, the ones a changed line
 * touches. `unchanged` when the base holds the same identity with the same
 * body hash, else `moved`, with the first base function holding the hash.
 * Sorted by path, name and occurrence.
 */
export async function omittedFunctions(
  skipped: ReadonlyMap<RelativePath, readonly FunctionCount[]>,
  ctx: OmitContext,
): Promise<OmittedFunction[]> {
  const first = firstByBody(ctx.bases);
  const omitted: OmittedFunction[] = [];
  for (const [path, counts] of skipped) {
    if (counts.length === 0) continue;
    const hunks = ctx.untracked.has(path) ? null : await headHunks(ctx, path);
    const same = new Set(ctx.bases.get(path)?.functions.map(sameKey));
    for (const count of counts) {
      if (hunks !== null && !hunks.some((h) => touches(h, count.range))) continue;
      const at = { path, qualifiedName: count.qualifiedName, occurrence: count.occurrence };
      const line = count.range.startLine;
      const base = same.has(sameKey(count)) ? undefined : first.get(count.bodyHash);
      omitted.push(
        base === undefined
          ? { ...at, line, reason: "unchanged" }
          : { ...at, line, reason: "moved", base },
      );
    }
  }
  return omitted.sort(byIdentity);
}

/** D16.2's order: by path, name and occurrence. */
export function byIdentity(a: OmittedFunction, b: OmittedFunction): number {
  return (
    compare(a.path, b.path) ||
    compare(a.qualifiedName, b.qualifiedName) ||
    a.occurrence - b.occurrence
  );
}

/** An identity with its body: the base holds it when the function is unchanged. */
function sameKey(f: FunctionCount): string {
  return `${f.qualifiedName}\0${f.occurrence}\0${f.bodyHash}`;
}

/** Each body hash at the base, with the first function holding it by path, name and occurrence. */
function firstByBody(
  bases: ReadonlyMap<RelativePath, FileCount>,
): Map<string, NonNullable<OmittedFunction["base"]>> {
  const all = [...bases].flatMap(([path, c]) =>
    c.functions.map((f) => ({
      path,
      qualifiedName: f.qualifiedName,
      occurrence: f.occurrence,
      bodyHash: f.bodyHash,
    })),
  );
  all.sort(
    (a, b) =>
      compare(a.path, b.path) ||
      compare(a.qualifiedName, b.qualifiedName) ||
      a.occurrence - b.occurrence,
  );
  const first = new Map<string, NonNullable<OmittedFunction["base"]>>();
  for (const { bodyHash, ...at } of all) if (!first.has(bodyHash)) first.set(bodyHash, at);
  return first;
}

/** A hunk touches a function when it changes one of its lines, or removes lines inside it. */
function touches({ start, count }: Hunk, range: CodeRange): boolean {
  if (count === 0) return range.startLine <= start && start < range.endLine;
  return start <= range.endLine && start + count - 1 >= range.startLine;
}

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;

/**
 * The head side of `git diff -U0 <base> -- <path>` against the working
 * tree. Only the hunk headers are read, so a quoted path does not matter;
 * user diff settings that would move or join hunks are turned off.
 */
async function headHunks(ctx: OmitContext, path: RelativePath): Promise<Hunk[]> {
  const diff = await runGit(ctx.cwd, [
    "--literal-pathspecs",
    "diff",
    "-U0",
    "--inter-hunk-context=0",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--text",
    "--no-renames",
    ctx.baseCommit,
    "--",
    path,
  ]);
  return [...diff.matchAll(HUNK)].map((m) => ({
    start: Number(m[1]),
    count: m[2] === undefined ? 1 : Number(m[2]),
  }));
}
