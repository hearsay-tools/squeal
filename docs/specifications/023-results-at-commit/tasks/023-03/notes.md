# 023-03 keys at a commit: notes for 023-06 and 023-08

Worker notes, 2026-11-16. Code: `src/core/commit/at-keys.ts`, `at-keys-untracked.ts`, `at-environment.ts`, `at-environment-lockfile.ts`. Tests: `test/core/commit/at-keys.test.ts`, `at-environment.test.ts`.

## Entry points

- `keysAtCommit({ root, store, worktreeId, commit, files?, parts?, projectDir?, rehash? })`: each file's `KeyAt`, by `testFileId`. Without `files`, every file this worktree lists in `test_file_keys`.
- `sideKeys({ ..., code, tests, testPaths })`: D5.1. The paths in `testPaths` come from commit `tests` (absent there, absent in the side); every other path from commit `code`. The environment is read from the mixed blobs too.
- `keysAtBlobs(input, blobs)` and `keysOver(store, input)`: the same steps over any blob map, for callers that hold the blobs already.
- `KeyAt` is `{ key, environment, step }` or `{ notDetermined: { reason: "closure" | "environment" | "untracked input", ... } }`.

## How a key is computed, in order

1. Closure list: the stored `test_files` list plus the shared `observed` entries (`localClosures`), as 018 D11's re-key takes it. No stored list: `closure`.
2. Untracked input: any closure path that `git status --ignored` shows as untracked or ignored here. A listing (`dir/`) counts only untracked direct entries, or a whole ignored folder at or above it. Reason `untracked input` with the first such path.
3. D11's proof: `keyOver(this worktree's environment hash, closure, file_hashes of this worktree, parts)` must equal the file's current key in `test_file_keys`. If not, `closure`. This is how the function knows the list and the key parts are the ones the daemon keys with. It needs a daemon to have keyed the file at least once.
4. Environment at the commit (`environmentAt`, D2.2), then `keyOver` over the commit's blobs.

## Decisions the spec did not settle

- **Key parts.** The store does not keep the dependency and runtime segments. Default: both empty (whole-fingerprint mode, no runtime files). A project in per-package mode, or with `runtimeFiles`, fails the proof in step 3 and reads `closure`. A caller can pass `parts` (for example from `keyPartsOf` in `src/core/ci/export-parts.ts`, which needs the runner adapters). Then the proof checks those parts.
- **Step 1** compares the commit's blobs at the runner files in this worktree's stored descriptor, and the committed lockfile's blob with the worktree file's blob on disk.
- **Step 2 runner version.** When the commit's lockfile declares the runner in an importer, the installed part already fixes its version, so the runner version is not compared. Otherwise (node:test) it must equal this worktree's. Allow-listed variables (`env.hash`) must equal this worktree's.
- **Step 2, more than one match** stops with `not determined`. It does not fall through to step 3.
- **Config-only difference.** A project is refused for step 2 when two stored descriptors share every input but `config` under different hashes (`ambiguous`). Steps 1 and 3 still apply, as the spec says only step 2 is skipped.
- **Step 3** runs only when the runner files are equal, this worktree's descriptor holds the whole fingerprint of its own committed lockfile (so not per-package mode, not a stale install), and both lockfiles pin the runner to the same versions. It needs `rehash(project, installed)` from the caller: this worktree's `environmentHash` with the new installed part. Without `rehash`, step 3 reads `not determined (the lockfile differs)`.
- **Lockfile location.** The nearest committed lockfile from `projectDir(project)` (default the root) up to the root, on either side. The store does not keep a project's folder.
- **pnpm installed part** is the second YAML document of `pnpm-lock.yaml`. A file with one document (pnpm before 11) is not derived.

## What 023-06 needs to wire

- `rehash` for step 3: open the runner adapters (as `openDaemonKeying` does) and call `environmentHash({ ...core, installedDependencies: installed }, runner, hashOf)`. Without it, a never-recorded lockfile reads `not determined`.
- `parts` for per-package projects, the same way, if `closure` reasons are frequent.
- Exit and text per D1 and D3. The `detail` strings in `KeyAt` are short English phrases meant for the report.

## Type changes

All additive: new exports `NO_PARTS`, `keyOver`, `commitSegments` (`src/core/store/transfer-rekey.ts`), `INSTALLED_ENCODING` (`src/core/keys/environment.ts`), new function `projectEnvironments` (`src/core/store/environments.ts`).
