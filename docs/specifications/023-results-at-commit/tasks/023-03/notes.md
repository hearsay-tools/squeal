# 023-03 keys at a commit: notes for 023-06 and 023-08

Worker notes, 2026-11-16, updated 2026-11-17 after fix A (row 023-13). Code: `src/core/commit/at-keys.ts`, `at-keys-coverage.ts`, `at-keys-globs.ts`, `at-keys-untracked.ts`, `at-environment.ts`, `at-environment-lockfile.ts`. Tests: `test/commit/at-keys.test.ts`, `at-keys-coverage.test.ts`, `at-keys-glob.test.ts` (real Vitest adapter), `at-environment.test.ts`.

## Entry points

- `keysAtCommit({ root, store, worktreeId, commit, inputs, files?, parts?, projectDir?, rehash? })`: each file's `KeyAt`, by `testFileId`. Without `files`, every file this worktree lists in `test_file_keys`. `inputs` is policy `inputs`, required.
- `sideKeys({ ..., code, tests, testPaths })`: D5.1. The paths in `testPaths` come from commit `tests` (absent there, absent in the side); every other path from commit `code`. The environment is read from the mixed blobs too.
- `keysAtBlobs(input, blobs)` and `keysOver(store, input)`: the same steps over any blob map, for callers that hold the blobs already.
- `KeyAt` is `{ key, environment, step }` or `{ notDetermined: { reason: "closure" | "environment" | "untracked input", ... } }`.

## How a key is computed, in order

1. **Closure list** (`localClosures`): the stored `test_files` list, plus the shared `observed` entries, plus (since fix A) the glob listings of its modules from `globListings.<project>` (`GlobListings.of` over the stored paths). This is how `WorktreeKeys.setClosure` merges them when a daemon starts from a stored list. No stored list: `closure`.
2. **Untracked input**: any closure path that `git status --ignored` shows as untracked or ignored here. A listing (`dir/`) counts only untracked direct entries, or a whole ignored folder at or above it. Reason `untracked input` with the first such path.
3. **D11's proof here**: `keyOver(this worktree's environment hash, closure, file_hashes of this worktree, parts)` must equal the file's current key in `test_file_keys`. If not, `closure`. This proves the list and key parts are the ones the daemon keys with here. It needs a daemon to have keyed the file at least once.
4. **Target coverage** (`targetCoverage`, review of wave 1 B1 and its re-review): the list must cover the commit's run, else `closure` with the reason.
   - Checks that apply even when every list file is byte-equal at the commit:
     - The test file must be at the commit. Policy `inputs` matched over the commit's files must be in the list.
     - A resolution stem (`x.ts` beside `x/index.ts`) with a file outside the list, where either side changed.
     - Glob modules (`at-keys-globs.ts`): a list file whose text holds `import.meta.glob(` or a template `` import(` ``. It is found by `git grep` here, and from the blob for changed files. Such a module reads `closure` when it changed (its pattern may differ), or when no walk recorded it in `globListings` (its folders are then not in the list).
     - Listed folders (`dir/`, from globs or observed listings): a name the commit's folder holds and this worktree's does not must be a list file. A match removed at the commit needs nothing: its segment and the folder's names follow the commit's tree. This is the re-review's case: `src/plugins/old.ts` exists at A, and B's list lacks it, so A's key asked from B is not determined.
   - Then, once any list file differs between here and the commit:
     - observed run-time reads, or non-empty key parts, read `closure`;
     - a changed file that is neither parsed (`.[mc]?[jt]sx?`) nor a known leaf (`.json`, `.snap`, `.css`, ...), such as a `.vue` file, reads `closure`;
     - each changed parsed file is read at the commit from git objects. Every relative import must resolve only to list files held there. Builtins pass. A package import passes only if this worktree's version of the file imports it too. A computed `import()`, a glob and an unresolvable import read `closure`.
5. **Environment** at the commit (`environmentAt`, D2.2), then `keyOver` over the commit's blobs.

## Decisions the spec did not settle

- **Key parts.** The store does not keep the dependency and runtime segments. Default: both empty (whole-fingerprint mode, no runtime files). A project in per-package mode, or with `runtimeFiles`, fails the proof in step 3 and reads `closure`. A caller can pass `parts` (for example from `keyPartsOf` in `src/core/ci/export-parts.ts`, which needs the runner adapters). Then the proof checks those parts, and step 4 accepts them only when no list file differs.
- **Step 1** compares the commit's blobs at the runner files in this worktree's stored descriptor, and the committed lockfile's blob with the worktree file's blob on disk.
- **Step 2 runner version.** When the commit's lockfile declares the runner in an importer, the installed part already fixes its version, so the runner version is not compared. Otherwise (node:test) it must equal this worktree's. Allow-listed variables (`env.hash`) must equal this worktree's.
- **Step 2, more than one match** stops with `not determined`. It does not fall through to step 3.
- **Config-only difference.** A project is refused for step 2 when two stored descriptors share every input but `config` under different hashes (`ambiguous`). Steps 1 and 3 still apply, as the spec says only step 2 is skipped.
- **Step 3** runs only when the runner files are equal, this worktree's descriptor holds the whole fingerprint of its own committed lockfile (so not per-package mode, not a stale install), and both lockfiles pin the runner to the same versions. It needs `rehash(project, installed)` from the caller: this worktree's `environmentHash` with the new installed part. Without `rehash`, step 3 reads `not determined (the lockfile differs)`.
- **Lockfile location.** The nearest committed lockfile from `projectDir(project)` (default the root) up to the root, on either side. The store does not keep a project's folder.
- **pnpm installed part** is the second YAML document of `pnpm-lock.yaml`. A file with one document (pnpm before 11) is not derived.

## What 023-06 needs to wire

- `inputs`: the policy's `inputs`.
- `rehash` for step 3: open the runner adapters (as `openDaemonKeying` does) and call `environmentHash({ ...core, installedDependencies: installed }, runner, hashOf)`. Without it, a never-recorded lockfile reads `not determined`.
- `parts` for per-package projects, the same way, if `closure` reasons are frequent.
- Exit and text per D1 and D3. The `detail` strings in `KeyAt` are short English phrases meant for the report.

## Limits known

- The rules hold when a run's closure is the static imports of its files, its glob folders, its declared inputs and its observed reads. A runner that reads its file set another way, with no listing in the closure, is outside them.
- A glob module that no walk at 0.1.532 or later recorded reads `closure` until a daemon walks it.

## Type changes

All additive: new exports `NO_PARTS`, `keyOver`, `commitSegments` (`src/core/store/transfer-rekey.ts`), `INSTALLED_ENCODING` (`src/core/keys/environment.ts`), new function `projectEnvironments` (`src/core/store/environments.ts`).
