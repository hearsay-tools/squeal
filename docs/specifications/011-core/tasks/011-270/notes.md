# 011-270 notes: a path git stops ignoring leaves the extra-file set

Row 011-270 (`tasks/wave-66.md` W2; review 0.1.379 B1). Worker run `61cb171d`, 2026-10-31. Baseline: `3edfabbe0`.

## What changed

- **Finding the paths, before the transaction.** `WorktreeKeys.ignoredAmong` (`src/core/scheduler/keying.ts`) is what both revision writers call before their transaction: `reconcileBatch` (`batch.ts`, watch and interval passes) and `WorktreeKeys.reconcile` (start passes). It still returns the marks from `IgnoredMarks`. It now also asks one `checkIgnored` (`src/core/watcher/git.ts`) about these extra files: the changed ones the marks did not report ignored, or every extra file when a `.gitignore` is among the changed paths. The ones git does not ignore go into `#seenByGit`.
  - In the common case, an ignored extra file rewritten, the marks report it ignored, so no second git process runs.
  - `checkIgnored` is the rule `track` and `bootstrap` classify with. It counts a path git refuses (beyond a symlink, in a submodule) as ignored, so such a path stays. `IgnoredMarks` answers an empty set on failure, so its empty answer is not taken as proof.
  - When git fails outright (a broken index, say), `checkIgnored` throws; `#findSeen` catches it, finds no path, and the revision goes on without marks, as row 011-262's marks do. Commit `4f90a8d15` let it throw. `test/delivery/ignored-transitions.test.ts` ("is left off when git check-ignore fails, with a note naming the paths") then failed, and `6200175dc` restored the catch. The third validity case runs the catch.
- **Leaving, inside the transaction.** `rekeyListings` is the first step of `rekeyContent` (`src/core/scheduler/revision.ts`). It now calls `#leave` first: each path of `#seenByGit` still in `#extra` leaves `#extra`, `#inherited` and `#unjudged`, and `onExtraFiles` gets the new list. Then:
  - `Listings.join` (`src/core/keys/observed.ts`, new) counts each one that is present as an add and returns its ancestor listings. The changes of leaving paths are kept out of `Listings.apply`, so nothing is counted twice. If the entries were not read yet, the lazy read counts the path, because it is no longer extra.
  - The moved listings are re-keyed (`index.rekey`), and their readers go to `ledger.settle` with the rest of the revision.
  - When policy `inputs` matches a leaving path, declared inputs are selected again (`#selectDeclared`, shared with `updateDeclaredInputs`), because a restart's `#declarable` includes the path.
- **Why the count matters.** Without `Listings.join`, a later delete of the path takes away a count that `Listings` never added. The root listing then loses `.ai` while the tracked `.ai/notes.md` is still there. In a probe copy, removing the `join` line failed all four transition tests in `test/scheduler/extra-file-leaves.test.ts`, the two delete tests included.

## Tests

- `test/scheduler/extra-file-leaves.test.ts` (new). It runs over the descriptor fixture (`test/delivery/descriptor-fixture.ts`), for both transitions (`git add -f` with a commit, then a rewrite; and a `.gitignore` that no longer ignores the path). It checks four things: the path leaves at the revision that shows it; the keys equal a restarted daemon's; a later delete keeps the tracked sibling's directory listed; and the path becomes a declared input when policy `inputs` selects it. Two guards check that the path stays: when the marks give no answer, and when a `.gitignore` edit still ignores it. `revise` copies the order of `rekeyContent`: listings first, then content.
- `test/keys/validity/cases/listing/leaves.ts` (new, by agreement, request `a25224f3`). `key-format.test.ts` needs a case that runs every changed line on the key path, at the side that holds it. No case had run an add or a delete through `Listings.apply`, at the last release either. `AssembleInput.revised` (`case.ts`) holds steps of git commands and file writes; the harness (`harness/assemble.ts`, `revised` and `revise`) runs a pass after each, then `rekeyListings` and `index.rekey`. There are three cases: a force-add with a commit, and an ignore-rule removal, each followed by a tracked add and the path's delete (the keys differ between the trees, no output does, so no raise is asked); and a rewrite with `.git/index` broken after the head is read (`brokenIndex`), which runs the `catch` (keys equal).
- `test/scheduler/daemon-loop.test.ts` (first case, by agreement with the coordinator, request `ca13afcc`). It drives the real watcher through `reconcileBatch` and now expects `extraFiles()` to be `[]` after the tracked path's watch revision.

## Not covered (decisions the spec did not settle)

1. **A force-add and commit with no change to the path itself.** No revision shows it, so the path stays extra until it changes, a `.gitignore` changes, or the daemon restarts. A restart counts it in its listings without a revision. Checking all extra files on every `HEAD` move would close this gap, at the cost of one git process per commit. I did not add that check.
2. **Ignore rules outside `.gitignore` files.** `.git/info/exclude` and `core.excludesFile` are not watched (git metadata), so a rule removed there takes effect at the path's next change or a restart.
3. **The reverse transition.** A path git starts to ignore does not join `#extra` in the same daemon. That direction is outside this row.
4. **No key-format change.** Only listing keys and declared inputs of the paths that leave move, at the revision that shows the change, to what a restart would give.
