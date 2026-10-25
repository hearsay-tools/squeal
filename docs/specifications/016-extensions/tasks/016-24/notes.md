# 016-24 and 016-26 ignored listings in one worktree, and absent directories: notes

Worker 6d8a1279, 2026-10-25. Brief: `tasks/wave-4.md`, section "016-24 and 016-26". Shape: repair. Code read at `feb3edfb8`. The coordinator approved the design (request 673d3013) before the first product edit: re-read at each revision, the names a run leaves are the names seen, an absent marker and an empty marker, no `KEY_FORMAT_VERSION` raise. It also gave this row the one `listedByRun` call in `src/core/scheduler/observed.ts` (decision A) and the assemble-harness steps (decision B, agreed for 011).

## Causes

- **R1 (016-24).** `Listings.hashOf` read an ignored directory's names on disk only when `KeyIndex` acquired or refreshed the listing's entry. `rekeyListings` passes only the adds and deletes the watcher reports, and the watcher does not watch ignored directories. So in one worktree a name added there moved no key until a restart.
- **R4 (016-26).** An absent or empty directory hashed as none. Every ignored listing before 0.1.316 hashed as none too. So a result stored before 0.1.316 with the directory present was found where it is absent or empty.

## Changes

| Commit | What |
| --- | --- |
| `602dae3c6` | `Listings`: a directory hashed from disk that cannot be read (absent) hashes as `sha1("\0absent")`; an empty one hashes as `sha1("\0empty")`. No list of names joins to either text, since no name is empty. Without a root it stays `null`. Unit cases in `test/keys/observed.test.ts`; the absent validity case now reads keys differ. |
| `4b57df3f7` | `Listings` remembers each directory it hashed from disk with the hash of the names last seen there. `apply` reads each one again at every revision and returns its listing path when the names differ. `Listings.ran` and `WorktreeKeys.listedByRun`: when a run of the only file that lists a directory ends, the names there now are the names seen. `observedGrowth` calls `listedByRun` for each reported file. Four scheduler cases in `test/scheduler/ignored-listing.test.ts`. |
| `7030de02d` | Assemble harness: optional `AssembleInput.relisted` (files written or removed, the runs of `ran` end, then `rekeyListings([])`). Three validity cases in `cases/listing/ignored.ts`. |

Type changes, all additive: `Listings.ran(directories)`; `WorktreeKeys.listedByRun(testFile, directories)`; `AssembleInput.relisted?`. `Listings.hashOf` with a root no longer returns `null`.

## How each piece answers the brief

1. **How a revision learns.** It reads the names again: one `readdirSync` and one sha1 per directory hashed from disk in this daemon, not per reader. No watcher change. The watcher's own events for a test that writes into its listed directory would make a revision after each of its runs.
2. **A test that writes into the directory it lists.** The record calls `listedByRun` before the growth is added. The names the run left become the names seen, and the key keeps the names the run started with. A later revision re-keys only when the names differ from those. The writer runs twice at first sight (first seen, then once more) and does not run at later revisions. Without the call it ran at each of the three revisions: 5 runs, not 2.
3. **R4.** The markers. The cost is below.
4. **`KEY_FORMAT_VERSION`** stays at 20. See the comparison below.

## Measurements

Read-only `node:sqlite` queries on `.git/squeal/store.sqlite`, at load 7.06 (one minute, 24 CPUs) for the first two items and 34.74 for the recount. The scripts are kept in `t/6d8a1279/probe`.

- `observed.<"">` holds 687 test files and 402 listing paths.
- The cost per revision: 22 µs for 3 directories that are absent (readdir ENOENT and sha1), and 14 µs for one directory of 20 names.
- Directories this daemon re-reads at each revision: those no cached file is below in this worktree. Over the 32 live worktrees with a stat cache: 51 directories, absent wherever a reader file of theirs exists. Three of them are absent in nearly every worktree: `.codex/plugins/cache/hearsay/squeal/` (32 worktrees), `plugins/claude-code/versions/` (26) and `src/runners/pytest/runtime/__pycache__/` (30). The others are absent in older checkouts.
- **The marker's cost.** It replaces the earlier "5 readers" figure. 35 distinct reader files and 251 (worktree, file) pairs: each pair is one run after the release, 5 to 35 per worktree, median 6. An example: `src/core/code/coverage/` is absent in 10 worktrees and has 29 readers. Most of these runs re-check results that were already right: a tracked directory absent in an older checkout keyed as none there before too. The coordinator accepted this cost (request 5f8dd65c).
- **The empty count.** 0 directories, 0 files, 0 pairs.
- **R4's exposure if left.** None of the 3 directories absent everywhere is present in any of the 38 worktrees, and no stat cache holds a file below one. So no stored result here could be shown to depend on R4.

## The key format

`npx tsx test/keys/validity/compare-refs.ts squeal--v0.1.316 HEAD` at `7030de02d`, load 28.86:

```text
squeal--v0.1.316 -> HEAD, 26498 ms, fired: true (global 20->20 fired, vitest 3->3 fired, node:test 10->10 fired, pytest 4->4 fired, recorder 4->4 fired)
  ...
  assemble	a listing of an ignored directory another worktree stored, read back: keys equal, outputs equal
  assemble	a listing of an ignored directory absent here, read back: keys differ, outputs equal
  assemble	a name added to an ignored listed directory here, read again at a revision: keys differ, outputs equal
  assemble	a name a run of the only file that lists an ignored directory wrote there, read again at a revision: keys equal, outputs equal
  assemble	an ignored listed directory emptied here, read again at a revision: keys differ, outputs equal
  assemble	a listing of a tracked directory another worktree stored, read back: keys equal, outputs equal
  ...
wording: ["a run whose instance lost its temp directory stores nothing, and its instance is closed (row 013-06)"]
uncovered: 0
```

The other 97 cases read "keys equal, outputs equal": 100 equal and 3 differ in all. The wording line names an `adapter:vitest` case this row does not touch. It appears in every comparison I ran, also in the first one, of the markers alone.

Two of the three differences are readers of an absent or empty unwatched directory (the markers). The third, "a name added…", is the R1 fix itself: a running daemon moves the key, where 0.1.316 keeps it until a restart. The key it moves to is the key a restart computes for the same names. The candidate's harness gives `05bee25dbe448833ea9c12d52efd000b44061f71b0c7d2cff563e27260e7756a` both for that case after the revision and for "a listing of an ignored directory another worktree stored, read back" (the same `a.json` and `b.json`). The comparison shows that second case with keys equal at both trees. So no stored key changes meaning. The coordinator took the case to 011 (request 6a8d55fc); 011's answer gates the landing.

`npx vitest run test/keys/key-format.test.ts` at `7030de02d`, load 31.68:

```text
 Test Files  1 passed (1)
      Tests  12 passed (12)
   Duration  34.00s (tests 93%, transform 6%, import 1%)
```

## Decisions the spec did not settle

1. **Only the sole reader's run takes the names as its own.** This is narrower than the approved design, and the call takes the test file: `listedByRun(observed.testFile, observed.directories)`. If two files list a directory, the names one of them writes are the other's input. Taking them as the writer's would leave the other file current at a key whose names are not on disk, until a restart. So the next revision runs both. The case "runs another file that lists the directory a writer lists…" fails without the rule.
2. **The names seen are per directory, read at every revision for each directory hashed from disk in this daemon.** The map is not pruned when the last closure that lists a directory drops it. It is bounded by the distinct directories ever hashed from disk: 51 at most in this repository.
3. **The keys stay true to disk.** `hashOf` still reads the disk whenever `KeyIndex` acquires or refreshes an entry. So after a run's names were taken as its own, a closure change of a reader reads the names on disk and re-keys it once.
4. **An unreadable path is absent.** Any `readdirSync` error, a file at the path for example, gives the absent marker.

## Residuals

| # | Residual | What shows it |
| --- | --- | --- |
| a | A revision that lands during the writer's own run sees its partial writes and runs it once more (catch-up, after the quiet). | By reasoning; no test makes a revision during a run. |
| b | A name someone else adds during the only reader's run is taken as that run's, and seen at the next restart. 0.1.316 saw every name only then. | By reasoning. |
| c | Where a file that writes new names each run and another file list one directory, both run at every revision that follows the writer's run: the cost of decision 1. | `ignored-listing.test.ts`, the second-reader case: one revision runs both. |
| d | A name added with no other change is seen at the next revision, not at once. | `ignored-listing.test.ts`, the R1 case: the add, then an edit of `notes.md`. |
| e | A writer runs once at each restart: the names it left differ from those its stored key holds. | The writer case's restart: one run. |
| f | R2 and R3 (row 016-25) are unchanged: below an ignored root, and ignored names beside tracked ones. | `test/keys/observed.test.ts`, the 016-23 case. |

## For the next worker

- The seam: `Listings.hashOf` (a key read) sets the names seen. `Listings.apply` (`rekeyListings`, each revision) reads them again and moves a listing whose names changed. `Listings.ran` (`listedByRun`, from `observedGrowth` at each record) takes the names a run left as seen. `KeyIndex.refresh` compares with the entry's hash, so a moved listing re-keys only when its key really changes.
- The validity harness's `relisted` step runs a revision after `elsewhere`'s read-back. Use it for any change to `apply` or `rekeyListings`: the global bundle holds both, and no other case kind runs a revision.
- `src/core/scheduler/observed.ts` and `revision.ts` are outside the global bundle (checked with an esbuild metafile of `entries/global.ts`). `keys/observed.ts` and `keying.ts` are inside it.
- The plugin bundles drift from `src`, as expected; this row ran no build. Squeal reports `cli/ps.mjs differs from the build` in `test/harness/opencode/package.test.ts` and `test/harness/pi/package.test.ts`.
