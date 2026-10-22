# 011-117: editor scratch files cancel no tier and start no quiet: worker notes

Worker 67d779d1, 2026-10-22. Brief: `tasks/toolkit-latency.md`, section 011-117.

## Seam map (what a vim open did before this row)

| Step | Where | What it did |
| --- | --- | --- |
| Listing re-key | `revision.ts` `rekeyContent` → `keying.ts` `rekeyListings` | The swap file's add moves `D/`, so every test file whose closure lists `D` re-keys. Unchanged by this row. |
| Cancel | `batch.ts` `reconcileBatch` → `Tier.changes` → `yields.ts` `superseded` | The add put `D/` (an ancestor listing) in every tier's `Tier.changes`. The tier file's inputs hold `D/`, so the tier was cancelled as `supersession`, not through `cancelsBacklog`. A backlog tier's cancel then started its lane's quiet. |
| Barrier | `store-decision.ts` `tierEnd` (`duringRun`) | The same `D/` in `Tier.changes` discarded the result, even when the swap file was gone at the run's end. |
| Quiet, content part | `revision.ts` → `quiet.ts` `quietQueued` | The re-keyed file was a queued miss of the lane, so a running wait started again. |
| Quiet, runner part | `refinement.ts` `applyRunnerPart` → `quietQueued` | An add in `D` re-resolves the closures of the test files with a path in `D` (`closuresToReresolve`, `inDirectory`), so the runner part settled the file again and restarted the wait too. |

## What changed

- `editor-scratch.ts`: the names (vim `.<name>.sw[a-p]` and `4913`, emacs `.#<name>`), `onlyEditorScratch`, and `scratchMovedListings`, the end-of-run check.
- `batch.ts` (agreed, request eff7bd44): a scratch file's add or delete puts the file in `Tier.changes`, not its ancestor listings.
- `tiers.ts` `unstableInputs` (agreed, request eff7bd44): adds to `Moved.changed` each listing input whose entries scratch files moved between the tier's revision and the latest, replayed from `store.revisions.range`. It reads the store only when `Tier.changes` holds a scratch file and the tier lists something. `store-decision.ts` is unchanged, so the key-format alarm is not involved.
- `revision.ts`: a scratch-only revision is catch-up, so neither part queues an edit's work. This keeps 011-116's widened edit cut (observed readers and listings as the edit's work) from making a vim open an edit that `cancelsBacklog` (`queuesEdit`) or a yield acts on.
- `quiet.ts` `quietQueued` takes the revision's changes (trailing, default none) and does nothing for a scratch-only revision; `refinement.ts` passes `part.revision.changes` (agreed, request 5896b6b5).

## Decisions the brief did not settle

1. **"Untracked" is not checked.** The names alone decide. An ignored path makes no revision, so "not ignored" holds by itself. A tracked file with such a name only loses the cancel and the quiet: it still re-keys, and the barrier still discards a result whose listing differs at its end.
2. **A scratch file a test read is a real input.** Its path stays in `Tier.changes`, so a tier whose file read it is still superseded, and `cancelsBacklog` rule 2 still applies. Only the listing move is deferred to the run's end.
3. **The end is the revisions' end.** The check reads the revisions up to the latest, as `Tier.changes` does for any listing: a swap file created in the last debounce window before the run ends is not seen, the same window real adds have.

## Remaining concerns

- **A run that lists `D` while the swap file exists, and ends after vim quits, stores its result.** The run may have seen the extra entry. The brief and `research/edit-latency.md` 6.2 accept this: only the listing at the end is compared.
- **An observed set that holds a scratch file.** If a run ever reads a swap file (a walk that reads every file), the observed set keeps it ("merged and never pruned"). Each later swap write re-keys and cancels that test while vim is open. The live toolkit-dev runs started while the swap file was absent, so this is not shown there. A fix would keep scratch names out of the observed sets (`observed.ts`, the `observe` kind of the key-format alarm); not filed.

## Repair: review `reviews/0.1.268.md` B1

The first slice asked `scratchMovedListings` only about the listings the tier's files held when it was selected, in `unstableInputs`, outside the lock. A listing the run observed for the first time (observed growth) was asked about by nobody: `prepareObserved` leaves listings to `Tier.changes`, and the scratch file's add no longer puts its listing there. A swap file created during a file's first run, and left present, then stored the run's PASS under the grown key, current, with no second run.

- `editor-scratch.ts` `scratchUnstable`: the listings the tier's files hold and the listings their growth adds, asked of `scratchMovedListings`.
- `scheduler.ts` `#record`: the call runs after `prepareObserved`, under the scheduler lock, and its listings join the changed paths `recordTier` gets. Every batch applied before the record counts, as in `Tier.changes`. `unstableInputs` in `tiers.ts` is back to its form before 011-117, apart from its comment.
- `test/scheduler/editor-scratch-observed.test.ts`: the reviewer's probe as a scheduler test (a swap file left present: no PASS stored, it re-runs and fails like the ordinary-add control), the accepted round trip on an observed listing (one run, PASS current), and a swap file there when the run listed the directory and removed during it (no false PASS). Without the growth listings, the first and third fail.
- Not covered by a test: a batch applied after the run's end and before its record. The check now reads the revisions in the record, so such a batch counts by construction.
