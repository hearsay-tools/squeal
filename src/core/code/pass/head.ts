import { runGit } from "../../fs/index.js";
import type { FileHash, RelativePath, RevisionNumber } from "../../types/index.js";
import type { PassContext } from "./pass.js";

/** Long enough for a batch of paths on a loaded host; a git that takes longer leaves every edit marked. */
const GIT_TIMEOUT_MS = 10_000;

/**
 * Spec 015 D6 as amended by 015-19: a pull is not the agent's edit. When a
 * revision after `since` moved `HEAD` (a pull, merge, rebase or checkout),
 * the paths of `files` whose blob is their blob at the new `HEAD`; their
 * changed bodies mark no first edit. Empty when `HEAD` stayed, and when git
 * cannot say, so an edit is marked as it was before 015-19.
 */
export async function committedPaths(
  ctx: Pick<PassContext, "root" | "source" | "log">,
  since: RevisionNumber,
  upTo: RevisionNumber,
  files: readonly { readonly path: RelativePath; readonly blob: FileHash }[],
): Promise<Set<RelativePath>> {
  // One request per line: a path holding a line feed cannot be asked, so it keeps its edit.
  const asked = files.filter((f) => !f.path.includes("\n"));
  if (asked.length === 0) return new Set();
  const head = ctx.source.movedHead(since, upTo);
  if (head === null) return new Set();
  let out: string;
  try {
    out = await runGit(ctx.root, ["cat-file", "--batch-check=%(objectname) %(objecttype)"], {
      // `./`: relative to the root, which may sit below the repository's top.
      input: asked.map((f) => `${head}:./${f.path}\n`).join(""),
      timeoutMs: GIT_TIMEOUT_MS,
    });
  } catch (error) {
    ctx.log(`complexity: could not read the files at HEAD ${head}: ${String(error)}`);
    return new Set();
  }
  const lines = out.split("\n");
  return new Set(asked.filter((f, i) => blobOf(lines[i]) === f.blob).map((f) => f.path));
}

/** The object id of a `%(objectname) %(objecttype)` line naming a blob; `null` for `<input> missing` and the like. */
function blobOf(line: string | undefined): string | null {
  const [id, type, rest] = (line ?? "").split(" ");
  return type === "blob" && rest === undefined && id !== undefined && /^[0-9a-f]+$/.test(id)
    ? id
    : null;
}
