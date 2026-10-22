# 011-72: validation holds while the index has unmerged paths (notes)

Board row 011-72, R1 of `tasks/011-61/design.md` (section 4), spec 011 C2 and C9 as amended 2026-10-21. Brief: `tasks/wave-15.md`, W3. Baseline `804fc358` (0.1.265).

## Seam map

| File | What it does now |
| --- | --- |
| `src/core/daemon-loop/head.ts` | `readHead` returns `unmerged`, the paths with one of git-status(1)'s seven codes (`unmergedPaths`; a rename's source field is skipped). `HeadState.unmerged` is optional (`src/core/revision/reconcile.ts`), so a fake `head` that omits it changes nothing. |
| `src/core/scheduler/hold.ts` | `MergeHold`: the unmerged paths, the index stat they were read at, the 1 s poll while on hold, the row's write. `head(read)` wraps the scheduler's `head`; `check(force)` stats the index (`git rev-parse --git-path index`, read once) and runs `git ls-files -u -z` only when it moved. A read that began before the last applied one is dropped. `heldFiles` (the record's rule) and `sinkWithoutResults` (the refresh's rule). |
| `src/core/scheduler/hold-rows.ts` | Both rows' types, `meta` keys and readers: `MergeHoldRow` `{ v: 1, since, revision, paths, count }` (first 50 paths) and `CommandHoldEntry`, in `{ v: 1, entries }`, for 011-74 to write. Registry owner `scheduler/hold-rows`. |
| `src/core/scheduler/scheduler.ts` | The gate. `start` reads the index (a daemon starts on hold). `#handleBatch` reads it in every pass that is not a watch batch (reconciliation and sync passes). `#pump` checks before a tier (`#holdCheck`) and again under the selection lock. `#ended` reads it before a record; `#record` re-queues uncounted the files `heldFiles` names. `#cutTiers` cancels nothing while on hold. `#hasWork` keeps only runner work. `inUse`, `slowPending`, `owedWork` read nothing pending while on hold. |
| `src/core/scheduler/ledger.ts` | `Ledger.holds` (set by the scheduler) gates `settle`'s lookup, its own result key included; `#refresh` sends held files to `sinkWithoutResults`. |
| `src/core/types/store.ts` | `mergeHold` and `commandHold` in `WORKTREE_META_ROWS`. |

## Decisions the spec and design did not settle, and the choice

1. **Where the lookup gate sits.** Every lookup that settles a file goes through `Ledger.settle` (revisions, the baseline, `StoredKeys.adopt`, runner work), so the gate is there, not in `keying.ts` or `stored-keys.ts` as the design named them. The other probes (`tiers.ts` selection, `claims.ts`, `slow-tier.ts`) run only at tier selection, which the hold stops. `ledger.ts` was outside the brief's list.
2. **The known-state refresh is a second lookup.** `StateSink.refresh` makes current any result stored at a file's key, so a FAIL stored earlier at the conflicted key became current without `settle` (test 7). An optional parameter on `refresh` was tried and withdrawn: `sink.ts` is on the validity path, and its changed line failed `key-format.test.ts` (test 10) with no case to run it. Instead `Ledger.commit` refreshes held files through `sinkWithoutResults`, a sink over a store `Proxy` whose `results.byKey` reads nothing at their keys. `sink.ts` is unchanged.
3. **Held means pending, own result included.** A held file whose key returns to its own result key (the resolved write equals the bytes that passed) also waits. Once the hold ends, tier selection's probe takes the stored result with no run (test 7, second half).
4. **The end reconciles what it released.** When a read finds paths gone from the listing, the next pump pass reconciles those paths before any tier. An abort that clears the index before the watcher reports the restored bytes then re-keys first, and no tier runs at the conflicted keys (test 4 sends no batch at all).
5. **No cancel while on hold.** `#cutTiers` returns while on hold, so a tier in flight runs to its end (C9), a revision's yield included (test 8).
6. **A hold is no activity.** `inUse`, `slowPending` and `owedWork` read nothing pending, so the unused stop and a departure drain do not wait on work that cannot start (C9: "A hold is no request and no activity", "A departure while on hold drains nothing").
7. **The row's `revision` and `since`.** `since` is the daemon's clock when it saw the hold begin; a daemon started on hold writes its own. `revision` is the latest stored revision then: seen in the batch that records the conflicted bytes, `readHead` runs before that revision commits, so it names the revision before it. `readMergeHold(store, worktree, daemonStartedAt)` drops a row whose `since` precedes the live daemon's start (R2 test 6).
8. **A failed read.** A `git ls-files -u` that fails leaves the hold as it was and notes once until a read succeeds. A row that failed to write is written again at the next check, moved or not.

## Tests (R1's done-when)

| R1 test | Where |
| --- | --- |
| 1 to 4 | `test/scheduler/merge-hold.test.ts` |
| 5 (rebase, cherry-pick, `stash pop` then `git reset`) | `test/scheduler/merge-hold-operations.test.ts` |
| 6 to 9 | `test/scheduler/merge-hold-records.test.ts` (test 6 makes the index unmerged during the run with `git update-index --index-info`: the files-before-index order) |
| 10 | `test/keys/key-format.test.ts`, unchanged, passing |
| parsers, rows | `test/scheduler/hold-rows.test.ts`; `test/store/worktree-meta.test.ts` covers the registry |

All ran against a real git repository and the catch-up fixture's fake runner (`merge-hold-fixture.ts`). On the base, 11 of 12 scheduler cases fail. Test 3 passes there too, as it should: the base runs the markers and fails them as well.

## Repair of review 0.1.266 (W4 of `tasks/wave-15.md`)

### B1: another worktree's heal

- **The rule, off the path.** `holdsAt(store, worktree, paths)` in `hold.ts` reads the target's `merge-hold:<worktree>` row (`readMergeHold` at its last daemon's start, `lastDaemon`, so a predecessor's row is dropped and a dead daemon's stands) and says whether it names one of a stored key's inputs. A row whose `count` exceeds its 50 listed paths names every key: the rest are not known to another worktree. `healsUnheld(store, paths)` turns it into the heal's filter. `MergeHold.names` is the same rule for the worktree's own daemon, which `Ledger.holds` asks.
- **The seam on the path.** `storeResults(context, records, heals)` takes the filter. A worktree it refuses keeps its states (no refresh, no transition) and is told as a held fail's worktree is: its row reads `queued` and its daemon takes the file at its next pass (`addHeldFile`, `Ledger.confirmHeld`), where its own hold decides. So a file a large merge's row cannot name heals at that daemon's next pass, and a held one stays pending. `recordTier` passes the filter over the tier entry's inputs and its growth, the rule `heldFiles` applies at the record (the coordinator's agreement, 2026-10-22, for `tiers.ts:702`).
- **C3.** The filter's three lines in `store-results.ts` are on the validity path; no case ran its heal loop before. The `accept` case "another worktree's pass heals this worktree's own fail" (`test/keys/validity/cases/accept/heal.ts`) runs it at both trees: `heal: true` stores each run through the tree's own `storeResults`, the receiver keyed first, and the receiver's states, row and held files are an output. A second case, beside a fail the receiver never confirmed, was withdrawn: its output read the held fail as each tree's code wrote it, so `reach.test.ts`'s held-fail overlay, which D1 (a) says cannot fail an `accept` case, made it differ. The case's filter accepts every worktree, so both trees give equal outputs and `KEY_FORMAT_VERSION` stays 20: no stored row and no decision read from stored rows changes. The hold's refusal is scheduler policy that C9 keeps off the path.
- **Tests.** `test/scheduler/merge-hold-heal.test.ts` is the review's five steps (fails at `2f5eef3dd`: A's current outcomes `["pass"]`), with the control that `test/other.test.ts`, whose key names no unmerged path, heals from FAIL to PASS in the held worktree. `hold-rows.test.ts` pins `holdsAt`'s row rules.
- **The store view stays** for the ledger's own refresh: hiding the results at the held keys needs either the view or a sink parameter, and `sink.ts` is on the validity path.

### B2: a setup outcome from a run the hold let past

- **The rule.** `heldSetups` (`setup.ts`) names the projects whose setup outcome, pass or fail, a run recorded while the hold holds gives none: those of the files `heldFiles` names (their keys name an unmerged path through their closure or their project's environment inputs, where Vitest lists a global setup and its closure), and, when the startup failure's setup file is unmerged itself, the projects it blames (`failedProjects`, now shared). A startup failure that blames one of them is the hold's.
- **Where it applies.** `#record` asks it before `recordTier`. A startup failure that is the hold's leaves the report recorded: no setup check fails, `failStartup` blocks nothing, and every file it kept from starting joins the uncounted re-queue beside the held files, so none is `unknown` and no withhold budget is spent. The `setups` argument of `recordTier` widens from `boolean` to `boolean | ReadonlySet<ProjectName>` (a set passes none of those projects' setups); `false` is still the runtime's loss (review 0.1.262 B2), which wins. Outside the hold the set is empty and `setups` is `true`, as before.
- **Choice.** A startup failure that blames a held project and an unheld one is held whole: Vitest reports one failed start per run, so its cause cannot be split. The unheld project's failure comes back when its files run after the hold. One that blames only unheld projects stands (the control below).
- **Tests.** `test/scheduler/merge-hold-setup.test.ts`: the review's steps with two held setup reports in a row (fails at `2f5eef3dd`: A's row reads `pending: null`, not `queued`), then `git add` runs both with no edit; an unmerged import of the global setup listed among the project's environment inputs, the setup file itself merged (fails at `2f5eef3dd` too), which holds every file of the project, `test/other.test.ts` included; and the control, a startup failure blamed on project `p` in the same tier, whose setup FAIL and UNKNOWN file stand while `""`'s importers stay queued. `test/scheduler/held-setups.test.ts` pins the rule's branches.

## Not covered, for the next worker

- **A global setup that reads an unmerged path no key names.** `heldSetups` sees a setup's inputs only through the keys (closure and environment inputs) and the setup file itself. A runner whose environment inputs omit a setup's import can still record that setup's outcome from a run the race let past.
- **Submodule conflicts.** `readHead` passes `--ignore-submodules=all`, so its listing omits a conflicted submodule that `ls-files -u` lists. A revision can then end a hold that the next index read starts again.
- **Git's write order** during a merge is still not probed (`tasks/011-61/probes/git-unmerged.sh` has not run). Test 6 covers files-before-index, and the gate covers index-first.
- **Timing under load.** Test 2 asserts that the run starts less than 2 s after `git add`. The poll is 1 s, and a loaded host can stretch it.

## For R2 (011-73) and R3 (011-74)

- R2 reads `readMergeHold` and `readCommandHolds` (`hold-rows.ts`). The merge hold stops tiers in the whole worktree, so while its row stands every queued file is queued for the hold (C15's reason). A held file's `test_file_keys` row is `pending: "queued"` and its known states are pending.
- R3 adds the command cause. The gate reads only `#hold.holding` today: in `#pump` (both checks), `#hasWork`, `#cutTiers`, `inUse`, `slowPending` and `owedWork`. Fold the two causes into one `#onHold()` there. `Ledger.holds` stays merge-only, because a command hold does not stop lookups. The `CommandHoldEntry` shape is a proposal, and R3 may change it with its readers.
