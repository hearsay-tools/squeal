# 016-23 a git-ignored directory's listing keys the test file that read it: notes

Worker 411f4070, 2026-10-25. Brief: `tasks/wave-3.md`, section 016-23. Shape: repair. Code read at `817c6ffbb`. The coordinator approved the design (request of 2026-10-25, items 1 to 6) before the first product edit.

## Cause

A listing path (`ignored/list/`) hashes through `Listings.hashOf` (`src/core/keys/observed.ts`), from the names of the files the watcher tracks. `WorktreeKeys.#listedFiles` skips extra files, so no file in a git-ignored directory is an entry. The listing therefore hashed as `null` in every worktree, entered no key (`encodeSegment` gives `""`), and B inherited A's result whatever names its directory held. Main before 016-17 dropped the listing; 0.1.313 stored it and hashed it as none.

## Changes

| Commit | What |
| --- | --- |
| `25962b318` | `Listings` takes an optional `root`. When the tracked files give a directory no entry names, `hashOf` hashes the names `readdirSync` returns there, sorted, as a tracked listing hashes its names. An absent or empty directory stays `null`; a directory with tracked names keys as before. `WorktreeKeys` passes `options.root` (`keying.ts`, in the constructor: a field initializer runs before `options` is set). |
| `b020107cc` | `observedGrowth`: a listing of a git-ignored directory the run adds is `firstSeen`. Its names are read after the run, so the file runs once more under the key that holds it, as a kept ignored file does (D5). New `test/scheduler/ignored-listing.test.ts`. |
| `64f55c444` | Validity cases `test/keys/validity/cases/listing/ignored.ts`, kind `assemble`, and one line in `cases/index.ts`. |

Type changes: `Listings`' constructor gains an optional second parameter, `root?: AbsolutePath` (additive). No stored format changes: the listing is still `dir/` in `observed.<project>`.

## The key format

`KEY_FORMAT_VERSION` stays at 20. Only the keys of test files whose closure holds a listing of a directory the watcher sees no file in, and that holds names on disk, change. Every other key has the same inputs. The alarm fired (the global component's emitted code changed) and asked for no raise, since the one case whose keys differ is allowed to differ. Its first run named two uncovered lines, both removed lines at the 0.1.313 bundle: the tracked-listing hash, which no case ran. The third case covers them.

`npx tsx test/keys/validity/compare-refs.ts squeal--v0.1.313 HEAD assemble` at `64f55c444`:

```text
squeal--v0.1.313 -> HEAD, 3440 ms, fired: true (global 20->20 fired, vitest 3->3, node:test 10->10, pytest 4->4, recorder 4->4)
  ...the nine earlier assemble cases: keys equal, outputs equal
  assemble	a listing of an ignored directory another worktree stored, read back: keys differ, outputs equal
  assemble	a listing of an ignored directory absent here, read back: keys equal, outputs equal
  assemble	a listing of a tracked directory another worktree stored, read back: keys equal, outputs equal
wording: []
uncovered: 0
```

## Residuals (accepted by the coordinator for later rows)

| # | Residual | What shows it |
| --- | --- | --- |
| R1 | In one worktree, a name added to an ignored listed directory is seen only when the key is read again: at a restart, or in another worktree. The watcher does not watch ignored directories, so no revision re-keys the listing. A re-read at each revision (for example in `Listings.apply`) would close it, but a test that writes new names into the ignored directory it lists would then run at every revision. | `test/scheduler/ignored-listing.test.ts`, second case: after `b.json` is added, an edit of `notes.md` runs nothing; the restart runs the file once. |
| R2 | A recursive listing of an ignored directory keys only its own names. `Listings.below` reads the tracked index, so no directory below an ignored root is a listing. | `test/keys/observed.test.ts`, "hash a directory the watcher sees no file in…": `below("ignored")` is `["ignored/"]` while `ignored/list/` holds names. |
| R3 | A directory that holds tracked files and ignored files keys by its tracked names only, as before (011 C3: what the watcher does not see is no entry). | The same unit case: `src/y.log` on disk leaves `hashOf("src")` equal to the tracked-only hash. The validity case "a listing of a tracked directory…" (`src/ignored.log` under `*.log`): keys equal at 0.1.313 and HEAD. |
| R4 | An absent directory has no names and keys as none, as 0.1.313 keyed every ignored listing. A 0.1.313 result made with the directory present is therefore still found in a worktree where the directory is absent. It holds for results stored by 0.1.313 only: from this change on, a present directory's names enter the key. | The validity case "a listing of an ignored directory absent here…": keys equal at 0.1.313 and HEAD (output above). The unit case: `hashOf("missing")` is `null`. |

## Decisions the spec did not settle

1. **Disk names, not a git check.** The rule is "a listed directory the watcher sees no file in hashes as its entry names on disk". It needs no `git check-ignore` in the keys, which are synchronous, and it covers a directory that holds only ignored files. The `firstSeen` rule in `observedGrowth` uses the git check that function already makes.
2. **All names.** Every name `readdirSync` returns enters the hash, empty subdirectories and dotfiles too: that is what the listing returned to the test. A tracked listing still counts a subdirectory only when it holds a tracked file.
3. **No marker.** A disk listing and a tracked listing of the same names hash alike: the test saw the same names.

## For the next worker

- The disk read happens when `KeyIndex` acquires or refreshes the listing's entry. The entry is shared by every test file that lists the directory and kept while one references it.
- `rekeyListings` still filters extra-file changes, and `Listings.apply` moves only the ancestors of tracked adds and deletes. R1's fix belongs there or in the watcher, with the write-loop risk above in its test.
