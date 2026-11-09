# 018-18 notes: import tolerance (D10) and re-keying at import (D11)

Worker 1891c653, 2026-11-09. For whoever continues (018-17's `ci export`, 018-20's reader).

## Where things are

| Part | File |
|---|---|
| D10 field rule | `src/core/keys/environment-descriptor.ts` (`importDifferences`, beside `describeDifferences`; the descriptor's new optional `browser` part) |
| D11 re-key and its proof | `src/core/store/transfer-rekey.ts` (`rekeyFiles`, `Rekeying`) |
| Import (moved out of `transfer.ts`) | `src/core/store/transfer-import.ts` (`importResults`, `importRefusal`, `ImportCounts.rekeyed`) |
| Export stays | `src/core/store/transfer.ts` (`exportResults`) |
| Key parts in the file, static-list hash | `src/core/store/transfer-bundle.ts` (`KeyParts`, `ExportedTestFile.keyParts`, `staticListHash`, `STATIC_LIST`) |
| Commit blobs for the CLI | `src/core/commit/tree.ts` (`committedBlobs`, reused, not changed) |
| Environment line "equal for imported passes" | `src/core/status/import-environment.ts` (kind `passes`) |
| D15 texts | `src/core/status/imports.ts` (static-list comparison), `import-lines.ts` (no-coverage line) |

## The rule as built

For each exported file, with the export commit's blobs from `git ls-tree -r <commit>`:

1. Proof: `keyFromSegments(exported env hash, file, segments of the export's own closure list over the commit, keyParts.dependencies, keyParts.runtime)` must equal the exported key. Absent `keyParts` means both empty.
2. This worktree's environment hash for the project, when the hashes are equal or `importDifferences` is empty.
3. This worktree's list: the stored `test_files` list (after the import's add-only lists) plus the `observed.<project>` entry, through `assembleClosure`.
4. Coverage (repair R1, review wave-5 B1): this worktree's list must hold every path of the export's list, observed files and listings included. A list that lacks one keeps the results at the exported key: a key without that input would stay equal when it changes here. The import never widens the shared observed set or moves a local key to make a file fit.
5. Key here = same parts, local environment hash, that list over the commit.

D10 (repair R1, review wave-5 B2): `allowOnly` is tolerated only when the export's hash is `configFieldHash(false)` and this worktree's is `configFieldHash(true)`; the other direction, an absent field and any other value stay keyed. `watch` stays tolerated both ways (Vitest reads it in a worker only to keep an inspector open, `research/ci-step.md` 3). `configFieldHash` is the one function that hashes a config field; test descriptors that fake `allowOnly` with strings such as `"f"` are unknown values now, so use it.

Any step that fails leaves the file's results at the exported key (D3). Segments over the commit: a file by its blob id, none when absent; a listing by `namesHash` of the tree's entry names, `ABSENT_LISTING` for a directory the tree lacks; `.git` is absent at a commit, so a file whose list names `.git` misses (sound).

## What the next rows must know

- 018-17 (`ci export`) must write `keyParts` per file: the dependency segment (`DependencyKeys.of(packages)`) and the runtime segment exactly as the key used them. Without them, a pnpm project whose Vitest reports packages never re-keys, because its keys hold a non-empty dependency segment.
- A store-made `squeal export` cannot write `keyParts`: the daemon keeps neither segment. Such an export re-keys only files whose segments are empty. Option B of request fa099e15 (the daemon records both per worktree) is a later row if needed.
- `importResults` takes `rekeying` as a parameter, so 018-20's daemon reader can pass the same commit blobs, or later a function from its own `KeyIndex`.
- The re-key reads the shared observed entry, not the daemon's in-memory view. A daemon that has not refreshed its view yet keys a smaller list and misses until it does (sound).
- Descriptor rows recorded before this row lack `browser`; `putEnvironments` now replaces such a row once a descriptor with the part arrives for the same hash (request 0728c0fa). Until a daemon of this release records its environments again, `browser` stays keyed.
- `import_files.closure` of new rows is `static:<listHash of the list less its observed paths>`; older rows hold the whole-list hash and are compared the old way.
- D10 applies only when both descriptors name runner `vitest`.
