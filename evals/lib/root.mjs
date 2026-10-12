// Where the evals put their cells and the judge's scratch (spec 006 D3; 001's
// research/nested-worktree-watch.md R4). Claude Code loads `CLAUDE.md` from the working directory
// and every directory above it, so a root inside a repository hands that repository's
// instructions to every Claude cell and every judge call. `os.tmpdir()` is no default: in a Cezar
// session it is `.ai/cezar/tmp/<task>`, inside the checkout.
import { existsSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";

/** What makes a directory part of a repository an agent reads instructions from. */
export const REPO_MARKERS = [".git", "CLAUDE.md", "AGENTS.md", ".claude"];

/** The eval root: `SQ_EVALS_ROOT`, else `/tmp/squeal-evals-<uid>`. */
export function evalsRoot(env = process.env) {
  if (env.SQ_EVALS_ROOT) return resolve(env.SQ_EVALS_ROOT);
  return `/tmp/squeal-evals-${process.getuid?.() ?? userInfo().username}`;
}

/** The first of `dir` and its ancestors holding a repository marker, `{ dir, marker }`, or null. */
export function repoAncestor(dir) {
  for (let d = resolve(dir); ; d = dirname(d)) {
    const marker = REPO_MARKERS.find((m) => existsSync(join(d, m)));
    if (marker) return { dir: d, marker };
    if (dirname(d) === d) return null;
  }
}

/** `dir` resolved, or an error when it lies inside a repository and `force` is not set. */
export function refuseInsideRepo(dir, { force = false } = {}) {
  const hit = repoAncestor(dir);
  if (hit && !force)
    throw new Error(
      `eval root ${resolve(dir)} is inside a repository (${join(hit.dir, hit.marker)}): its instructions would reach every cell and judge call. Set SQ_EVALS_ROOT outside it, or pass --force-root.`,
    );
  return resolve(dir);
}
