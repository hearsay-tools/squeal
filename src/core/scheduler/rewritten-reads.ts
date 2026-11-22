import { runGit, splitNul } from "../fs/git.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import type { ObservedInputs } from "../types/runner.js";

/*
 * Row 023-47 (spec 023 D2; spec 001 D3 as amended): the recorder leaves a
 * path the run wrote out of its reads, so a scratch file the run wrote and
 * read back keys nothing. A tracked file the run read and also rewrote is
 * an input the run changed: left out, the run was kept at the key from
 * before it, which two commits can share, and its read was never recorded.
 * The runner names such files apart (`ObservedInputs.rewritten`); the ones
 * git tracks are read as reads, so the record's stability check and its
 * first-seen rule see them, and the read joins the shared observed rows.
 */

/**
 * The `rewritten` paths of each of `observed` that git tracks in `root`,
 * by position. One `git ls-files` for all of them; none when no file has any.
 */
export async function trackedRewrites(
  root: AbsolutePath,
  observed: readonly Pick<ObservedInputs, "rewritten">[],
): Promise<RelativePath[][]> {
  const asked = [...new Set(observed.flatMap((o) => o.rewritten ?? []))];
  if (asked.length === 0) return observed.map(() => []);
  const out = await runGit(root, [
    "--literal-pathspecs",
    "ls-files",
    "-z",
    "--cached",
    "--",
    ...asked,
  ]);
  const tracked = new Set(splitNul(out));
  return observed.map((o) => (o.rewritten ?? []).filter((path) => tracked.has(path)));
}
