# 016-29 and 016-30 one owner for the shared observed sets, and two kit-proven cases out: notes

Worker 00f19154, 2026-10-25. Brief: `tasks/wave-6.md`. Shape: repair. Code read at `85e43bdc9`. The coordinator approved the design before the first product edit (request 000ce078, reply 589bedbb). 011's coordinator accepted the invariant below in place of its condition (1), with no closure re-assembly in `record.ts`. Slice 2 was dropped on the coordinator's decision C (request 79af861d).

## Cause

`ObservedSets.add` merged the path into the view, then wrote `observed.<project>` at once. It ran in `recordCompleted`, inside the record's transaction, so the write was a savepoint. After a rollback the view and the `KeyIndex` closure kept the path. The next run of the file then added nothing new, and nothing wrote the path until a restart. Other worktrees keyed without it. The failing test showed this on main: `one-write-path.test.ts:195`, `expected null to deeply equal { 'test/a.test.ts': [ 'lib/x.mjs' ] }`.

## Changes

| Commit | What |
| --- | --- |
| `4d946aca9` | 016-30: the `--require` probe case of `adapter-preload-require.test.ts` and the first form of `adapter-preload-quoted.test.ts` are removed. The header comments name kit K5 and `node-options.test.ts`. |
| `a740fc923` | The failing test, shaped like the start-up case at `one-write-path.test.ts:140`. |
| `54a0828ed` | `SharedPaths` (`src/core/keys/observed.ts`): this worktree's view of one shared `meta` key, the map shape or the list shape. It has `of`, `refresh`, `see` and `write`, with one `parse`, one `merge` and one `format`. `ObservedSets` and `StartupSets` are facades over it. `addObserved` sees, and `writeSeen` writes all three keys. Tests: the failing test with the invariant asserts, a restart before the next record, and two connections in all three keys. |
| `39196d600` | Slice 1: `Listings` takes a required root, so `hashOf` returns `FileHash`, never `null`. |

Slice 2 (`Listings` to `listings.ts`) was built as `6c21390a1` and taken off the branch. See "Slice 2" below.

## The write rule

- `see(entry, paths)` adds to the view and to `#unwritten`, never to the store.
- `write()` returns at once when nothing is unwritten. Otherwise it reads the key inside `store.transaction`. It drops each unwritten entry the store already holds, unions the rest and sets the key once. A written entry stays unwritten until a later write finds it stored. So a rolled-back write is made again, and a committed one costs one more parse at the next record.
- **Call it once per transaction.** An entry another write stored earlier in the same transaction counts as held. If that transaction then rolls back, the entry is lost. The product calls `writeSeen` once per record (`tiers.ts`, `recordTier`). The kit and the validity harness call it outside a transaction.
- **The invariant (accepted by 011 in place of "the view equals the store").** Each record transaction stores the results first, then `endRecord`'s `writeSeen`. So every committed result is keyed only with observed paths the store holds after that commit. Between a rolled-back record and the next record the view is ahead of the store, and no result is committed. The failed record stored none, and the pump stalls until the next batch. The failing test asserts this: no stored result in that interval, then a restart after the next record finds the result without a run.
- `ObservedSets.add` stays as `see`, then `write`. Its callers run outside a record: `test/keys/validity/harness/observe.ts` and `test/scheduler/absent-paths.test.ts`.

## Stored bytes and keys

Both shapes keep the same sorted keys, the same sorted and deduplicated entry arrays, and the same `JSON.stringify`. The observed write moves from `recordCompleted` to `endRecord`, in the same transaction. A record with several grown files writes once, not once per file, and the final text is the same. One difference: the start-up list's write did not deduplicate before; the one `format` now does. The two differ only for a stored list with duplicates, which no Squeal writes. The coordinator accepted this.

`node --import tsx test/keys/validity/compare-refs.ts squeal--v0.1.320 <ref>`, load average about 25 on 24 CPUs:

| Ref | Fired | Cases | Wording | Uncovered |
| --- | --- | --- | --- | --- |
| `54a0828ed` (the view) | global | 64 of 64 keys equal, outputs equal | `[]` | 0 |
| `39196d600` (slice 1, the candidate) | global | 64 of 64 | `[]` | 0 |
| `6c21390a1` (slice 2 as briefed) | global, vitest, node:test, pytest, recorder | 64 of 64 | one: "a run whose instance lost its temp directory stores nothing, and its instance is closed (row 013-06)" (not followed up) | 33 |
| `fb1d9a959` (option B, a scratch commit, not on the branch) | global | 64 of 64 | `[]` | 3 |

`test/keys/key-format.test.ts` passes at `39196d600` with no version raised. It failed at revision 14 (slice 2) and passed again at revision 15. No file under `src/core/keys/` changed between `squeal--v0.1.320` and `squeal--v0.1.321`.

## Slice 2: the input for whoever splits `observed.ts`

`observed.ts` is 424 lines at `39196d600`: the shared sets, the listing paths and `Listings`. The alarm treats a moved line as changed, so every moved line needs a validity case that runs it. Two layouts were measured:

- **A, the brief's slice 2** (`Listings`, `ABSENT_LISTING`, `EMPTY_LISTING` and `namesHash` to `listings.ts`; `6c21390a1`, in the reflog): 33 uncovered. That is 16 lines of `observed.ts` at the baseline and 17 of `listings.ts` at the candidate, the same code at each side:
  - `Listings.below` (candidate `listings.ts:80-89`, baseline `observed.ts:284-293`);
  - the add and delete loop of `Listings.apply` (candidate `listings.ts:100-105`, baseline from `observed.ts:304`);
  - the delete branch of `#count` (candidate `listings.ts:133`).

  The tool cuts its list of lines; `git cherry-pick 6c21390a1` and the command above print it again.

  No validity case makes a recursive listing or reports an add or delete at a revision. A split first needs one or two `assemble` cases under `test/keys/validity/cases/` that do.
- **B, the view to a new `src/core/keys/shared-paths.ts`, `Listings` stays** (`fb1d9a959`; `observed.ts` 301 lines, `shared-paths.ts` 126): 3 uncovered, `observed.ts:361-363` at `squeal--v0.1.320`. This is the old map parse's malformed-JSON branch. No case leaves a malformed `observed.<project>` map; the existing malformed case is for the start-up key. The split needs that one case.

The coordinator chose C: no split and no row now. A later change to `Listings.below` or to the add and delete loop of `apply` shows as uncovered and needs its case then.

## Cost

Read-only `node:sqlite` read of this repository's store, 2026-10-25: `observed.` is 1,725,708 bytes and `observedDirect.` is 252,582. Before, `add` parsed and rewrote `observed.` once per grown file per record. `writeMarks` and `StartupSets.write` parsed their key at every record after the first mark, with no end. Now each key is parsed at most twice per growth: once to write, and once at the next record to confirm. After that, `write` reads nothing.

## Type changes (no interface in `src/core/types`)

- `ObservedSets`: added `see(testFile, paths)` and `write()`; `writeMarks()` is now `write()`, which writes the paths and the marks of every project. `add` is `see` and then `write`, so it also writes any unwritten marks.
- `observed.ts` module exports, not in `index.ts`: `SharedPaths`, `viewOf` and `ABSENT_LISTING`. `ABSENT_LISTING` is exported for `test/keys/observed.test.ts`.
- `Listings`: the constructor's `root` is required, and `hashOf` returns `FileHash`.
- `StartupSets` and `WorktreeKeys` keep their methods. `WorktreeKeys.addObserved` now writes nothing, and `writeSeen` writes the observed paths too.

## Tests

- New in `test/scheduler/one-write-path.test.ts`: "an observed path the record's rolled-back transaction did not store", with the cases "is stored at the next record" and "is not keyed by a daemon restarted before the next record, which runs the file".
- New in `test/keys/observed.test.ts`: "merge two connections' writes in all three keys, each write reading the key it merges into". It checks the stored text byte for byte.
- Changed calls, with no assertion changed: `writeMarks()` is `write()` in `test/keys/observed.test.ts`, and two test titles name `write`. Slice 1 gave the five `Listings` constructions a root and replaced its two `toBeNull` assertions with `ABSENT_LISTING`, as the scan said.

## For the next worker

- The C3 sentence ("written in one transaction that merges and never prunes") becomes "written in the record's transaction, merged with what the store holds, never pruned". The coordinator amends 011 C3 at integration.
- Residue that this row did not change: after its own write, a view reads its key again at the next ask (`#read` is reset). When `of` makes that read, it merges other worktrees' paths without reporting them as grown, so `#grownElsewhere` can miss them until their next `setClosure`. The old `add` did the same. `test/keys/observed.test.ts`'s first case pins this re-read.
- The kit's `OpenWorktree.record` keeps its copy of the record's steps; only its comment changed. `writeSeen` now writes all three keys.
