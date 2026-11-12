# Row 020-39: `squeal code` records the observed reads it saves with

Worker 58e6f8c1, 2026-11-12/13. Brief `../wave-15.md`. Commits `4b509448b` to `d1ae3909d` (see the final list in the worker's report).

## Change

- **Evidence** (`src/core/run-evidence/sources.ts`, `readKeepEvidence`): the keeper now reads which of its run's reads beyond the key moved, with the daemon's `observedMoves`, and adds their touched paths to the barrier's. Before, a grown file was never kept, so the keeper did not need it.
- **Acceptance** (`run-evidence.ts`, `keeps`): `store` at `ran` or at `grown`.
- **Grown key** (`code/gate/keep-seen.ts`, `atStoreKey`): `keys.addObserved(ref, growth.add)` on the lookup's keys, then `keys.index.key(ref)`, as `recordCompleted` does. The file's `paths` gain `growth.growth`, and the stat cache entries of those paths are copied into the lookup's snapshot, so the deferred checks of D17.5 (`stillAsRead`, `unheldNow`, `healsUnheld`) cover the reads too.
- **Merge** (`keep-seen.ts`, `seenOf`, `mergeSeen`, `keepSeen`; `keep-here.ts`, `writeHere().seen`): per candidate file, `ObservedGrowth.add` (from any decision that carries `growth`, as the daemon merges for every completed decision), and the direct and module marks its run reported that the lookup's keys took (`directOf`, the new `modulesOf`). `ObservedSets`/`ModuleSets` over the repository's store `see`/`mark` them; when a view gained a path, one `store.transaction` calls their `write()` (each `SharedPaths.write` a savepoint). Synchronous, inside `writeHere`'s busy slice; tried through `sliced` before the files' writes, with the same `StoreWait` bound and `InputCheck`.
- **Serving daemon** (`keep.ts`, `#withoutGrown`): when the worktree's lock is held, grown files are dropped and told with their decision ("read paths its key lacks"), as before; `writeThroughDaemon` has no `seen`, so nothing is merged.
- **Accessor** (`scheduler/keying.ts`, `modulesOf`; agreed with 31e1d860): read-only. The key alarm runs its line from `test/keys/validity/harness/assemble.ts` (`readBack`), as 011-319 did; no `KEY_FORMAT_VERSION` raise.

## Seam map (for the next worker)

- The gate's `WorktreeKeys` sit on a scratch store (`gate/stored.ts`, `openKeyer`), seeded from the repository's `OBSERVED_META_KEYS` rows at the lookup. `keys.writeSeen()` would write into that scratch store, so the merge must open views over the repository's store; it cannot reuse the keys' own views.
- `observedGrowth` (scheduler) already calls `markDirect`/`markModules` and `track` on the lookup's keys for every reported file. The marks are in the keys' view only.
- `track` hashes only paths the stat cache lacks. A tracked or untracked-unignored read is hashed at `bootstrap` (before the run), so it is not first-seen. A git-ignored read is first hashed by `track` after `beginRun`: first-seen. The next gate run's `keyFiles` calls `trackUntracked`, which hashes the ignored path from the merged row before the run, so that run stores at `ran`.

## Decisions the spec did not settle

1. The merge is one transaction of its own, before the files' writes, not inside each file's results transaction. Neither order can store a wrong result: a result at the grown key without the merged rows is never looked up; merged rows without the result are a miss. One merge per flush also matches the research's cost (one write of the rows, not one per file).
2. Reads are merged for every candidate (completed, with a coverage record) whose decision carries growth, kept or not: first-seen, unstable or environment ones too, as the daemon's record does. A completed file with no coverage record is not a candidate, so its reads are not merged (the daemon would merge them).
3. With no file to write (only reads to merge, all files first-seen say), the merge takes one try and does not wait for a busy store, and says nothing if it is refused: the next run merges again. Waiting up to 30 s only to save reads, with notes that name no file, looked worse.
4. A grown file whose read moved between the decision and the write is dropped at `flush`'s opening check without a note, as a file at its ran key already is.

## Spec text to amend (coordinator's)

- D17.3 says "a file is written only when its run evidence's store decision is 'store at the key it ran under'" and lists "the run read a path its key lacks" among the bars. Since this row: "store at the key it ran under, or, where no daemon serves, at the key with what it read, its reads merged into the shared observed rows"; the bar is "the run read a path first seen during the run, or one that moved".

## Tests

- `test/run-evidence/table.test.ts`: the three "difference 1" rows flip (keeper = daemon; a touched read is `unknown` for the keeper); a new row, a git-ignored read is `first-seen` in both.
- `test/code/gate/keep-grown.test.ts` (new): real lookup keys and the repository's store: grown key and the three rows; busy past the bound; a read moved before the write; a serving daemon.
- `test/cli/code-gate-keep-grown.test.ts` (new): no daemon history, three gate runs: tracked read kept on run 1 and read on run 2; ignored read kept on run 2 and read on run 3.
- `test/cli/code-gate-children.test.ts`: the not-kept line goes (agreed with 31e1d860).
