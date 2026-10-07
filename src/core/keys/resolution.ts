import { posix } from "node:path";
import { compare } from "../fs/index.js";
import type { FileChange, RelativePath, TestFileRef } from "../types/index.js";
import { directoryOf, type ReverseIndex, testFileId } from "./reverse-index.js";

/**
 * Test files whose closure must be re-resolved by the runner because a file
 * was added or deleted where their imports resolve, or a `package.json` was
 * edited.
 *
 * Spec 001 D3: "Adding or deleting a file re-resolves closures of test files
 * that import from the affected directory, because module resolution can
 * change without any closure file's content changing." Research R3 names the
 * case: a new `foo/index.ts` beside `foo.ts`, and the reverse. For an added or
 * deleted path `dir/name.ext` this picks test files with a closure path:
 *
 * - directly in `dir`: `./name` may now resolve to another extension, and a
 *   template-literal `import()` or `import.meta.glob` over `dir` changes;
 * - below `dir/name/`: `./name` may now resolve to the file instead of the
 *   directory's index, or back;
 * - directly in the parent of `dir` when `name` is `index`: `./dir` may now
 *   resolve to the directory.
 *
 * An added, deleted or edited `dir/package.json` instead picks test files
 * with a closure path anywhere below `dir`: the directory, or the package by
 * name, now resolves to its `index` or to another entry, which may lie below
 * `dir` (`"main": "lib/entry.ts"`). The manifest is in no closure and no
 * module graph, so neither `KeyIndex.rekey` nor the runner's `affected` sees
 * it (task 001-72, reviews/wave-9.md S1, S2). At the worktree root, `below`
 * covers only root files: a package importing itself by name is not modelled.
 *
 * An added or deleted declared input (`isDeclaredInput`) joins or leaves every
 * closure, so every test file is picked. Other content changes are not
 * handled here: D5 re-resolves the closures of the test files `KeyIndex.rekey`
 * reports, because an edited file may import something new. Aliases and
 * `paths` from tsconfig are not modelled; closures are declared incomplete
 * (D3).
 */
export function closuresToReresolve(
  changes: readonly FileChange[],
  index: ReverseIndex,
  isDeclaredInput: (path: RelativePath) => boolean,
): TestFileRef[] {
  const picked = new Map<string, TestFileRef>();
  const pick = (refs: readonly TestFileRef[]) => {
    for (const ref of refs) picked.set(testFileId(ref), ref);
  };

  for (const change of changes) {
    const dir = directoryOf(change.path);
    const base = posix.basename(change.path);
    const edited = change.oldHash !== null && change.newHash !== null;
    if (edited && base !== "package.json") continue;
    if (!edited && isDeclaredInput(change.path)) return index.testFiles();
    if (base === "package.json") {
      pick(index.below(dir));
      continue;
    }
    const dot = base.lastIndexOf(".");
    const name = dot > 0 ? base.slice(0, dot) : base;
    pick(index.inDirectory(dir));
    pick(index.below(dir === "" ? name : `${dir}/${name}`));
    if (name === "index" && dir !== "") pick(index.inDirectory(directoryOf(dir)));
  }
  return [...picked.keys()].sort(compare).map((id) => picked.get(id) as TestFileRef);
}
