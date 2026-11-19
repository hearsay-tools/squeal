import { runGit } from "../core/fs/git.js";
import { testFileId } from "../core/keys/reverse-index.js";
import {
  type ChangedImports,
  changedImports,
  codeSideChanges,
  testCodeWhy,
} from "../core/proof/imports.js";
import type { AbsolutePath, RelativePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";

/*
 * Spec 023 D5.2 (row 023-21, review wave-14 B1): each named file's changed
 * imports while it is unchanged, each code-side one read at `HEAD` and at
 * `base` to tell test code (a test API import, pytest's conftest, a helper
 * name) from source (`core/proof/imports.ts`).
 */

/** A larger file is read only up to this many bytes: imports sit at its top. */
const READ_BYTES = 1_048_576;

export async function importsOf(
  root: AbsolutePath,
  commits: { readonly base: string; readonly head: string },
  refs: readonly TestFileRef[],
  loadsOf: (ref: TestFileRef) => readonly RelativePath[],
  changed: ReadonlySet<RelativePath>,
  testSide: ReadonlySet<RelativePath>,
): Promise<Map<string, ChangedImports | null>> {
  const paths = new Set(
    refs.flatMap((ref) => codeSideChanges(ref.path, loadsOf(ref), changed, testSide).code),
  );
  const why = new Map<RelativePath, string | null>();
  for (const path of [...paths].sort()) {
    const versions = [];
    for (const commit of [commits.head, commits.base])
      versions.push({ commit, text: await textAt(root, commit, path) });
    why.set(path, testCodeWhy(path, versions));
  }
  return new Map(
    refs.map((ref) => [
      testFileId(ref),
      changedImports(ref.path, loadsOf(ref), changed, testSide, (p) => why.get(p) ?? null),
    ]),
  );
}

/** `path`'s text at `commit`, its first `READ_BYTES`; `null` when the commit lacks it. */
async function textAt(
  root: AbsolutePath,
  commit: string,
  path: RelativePath,
): Promise<string | null> {
  const out = await runGit(root, ["cat-file", "--batch"], { input: `${commit}:${path}\n` });
  const header = out.slice(0, out.indexOf("\n"));
  if (!/^[0-9a-f]+ blob \d+$/.test(header)) return null;
  return out.slice(header.length + 1, header.length + 1 + READ_BYTES);
}
