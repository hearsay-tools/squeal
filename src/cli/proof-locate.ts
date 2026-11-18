import { resolveCommit } from "../core/commit/at-keys-checkout.js";
import { runGit, splitNul } from "../core/fs/git.js";
import { type Conditions, placeWithout, type Without } from "../core/proof/conditions.js";
import type { AbsolutePath, RelativePath } from "../core/types/common.js";
import type { CliIo } from "./main.js";
import type { ProofArgs } from "./proof-args.js";
import { inRoot, worktreeOf } from "./status-at.js";

/*
 * Spec 023 D5, D5.3 (rows 023-08, 023-11): where a proof runs: the
 * worktree, both commits, the named files from the root, and the
 * conditions with each `--without` placed; and the working tree's
 * uncommitted paths, which the proof does not see.
 */

export interface Located {
  readonly root: AbsolutePath;
  readonly commonDir: AbsolutePath;
  readonly base: string;
  readonly head: string;
  /** The named files, relative to the root. */
  readonly paths: readonly RelativePath[];
  /** D5.3: the conditions, each `--without` placed in the repository or under `HOME`. */
  readonly conditions: Conditions;
}

/** The worktree, both commits and the named files; a setup problem as a string. */
export async function locate(args: ProofArgs, io: CliIo): Promise<Located | string> {
  const where = worktreeOf(io);
  if (typeof where === "string") return where;
  const { cwd, root, commonDir } = where;
  const commit = async (name: string, problem: string) => {
    try {
      return await resolveCommit(root, name);
    } catch {
      return { problem };
    }
  };
  const base = await commit(args.base, `"${args.base}" names no commit here`);
  if (typeof base !== "string") return base.problem;
  const head = await commit("HEAD", "HEAD names no commit: commit the test first");
  if (typeof head !== "string") return head.problem;
  const paths: RelativePath[] = [];
  for (const file of args.files) {
    const rel = inRoot(root, cwd, file);
    if (rel === null) return `${file} lies outside ${root}`;
    paths.push(rel);
  }
  const conditions = conditionsOf(args, cwd, root, (io.env ?? process.env).HOME);
  if (typeof conditions === "string") return conditions;
  return { root, commonDir, base, head, paths, conditions };
}

/**
 * D5.3: `args`' conditions, each `--without` placed (`placeWithout`); a
 * usage problem for a path it cannot hide, or for `--env HOME` beside a
 * path hidden under `HOME`, whose run has its own `HOME`.
 */
export function conditionsOf(
  args: ProofArgs,
  cwd: AbsolutePath,
  root: AbsolutePath,
  home: string | undefined,
): Conditions | string {
  const without: Without[] = [];
  for (const given of args.without ?? []) {
    const placed = placeWithout(given, cwd, root, home);
    if ("usage" in placed) return placed.usage;
    without.push(placed);
  }
  const env = args.env ?? [];
  if (env.some((e) => e.name === "HOME") && without.some((w) => w.where === "home"))
    return "--env HOME cannot be given with a --without path under HOME: that run has its own HOME";
  return { env, without };
}

/**
 * Every path the working tree holds otherwise than `HEAD`: changed,
 * staged, deleted or untracked (not ignored). Both sides are committed
 * versions in checkouts; this only tells the user the proof is not of
 * their uncommitted change.
 */
export async function dirtyPaths(root: AbsolutePath): Promise<RelativePath[]> {
  const changed = await runGit(root, ["diff", "--name-only", "--no-renames", "-z", "HEAD", "--"]);
  const untracked = await runGit(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  return [...new Set([...splitNul(changed), ...splitNul(untracked)])]
    .filter((path) => path !== "")
    .sort();
}
