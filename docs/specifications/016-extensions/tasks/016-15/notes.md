# 016-15 notes: a check knows its runner

Worker notes for row 016-15 (D3, row 007-45). Not a spec; the coordinator decides from them.

## Seam map

- Every `checks` row is inserted by `ensureCheckId` (`src/core/store/codec.ts`), from four writers: `results.putMany`, `knownStates`/`transitions` (`repos/states.ts`), `consumerViews` (`repos/consumers.ts`) and `checks.upsertMany` (`repos/test-files.ts`). None knows the runner.
- The runner of a project is known in one place the store can reach: `RunnerEnvironment.runnerName` (`vitest`, `node-test`, `pytest`), which the key hashes (`src/core/keys/environment.ts:76`). `WorktreeKeys` (`src/core/scheduler/keying.ts:86`) holds it per project, with no accessor.
- Run results reach the store only through `storeResults` (`src/core/scheduler/store-results.ts:36`), called from `recordTier`.
- Setup checks (001-382) have no key and no stored result. Their known state is written through the ledger's commit (`SetupFailures`, `src/core/scheduler/setup.ts`), never through `putMany`. Only Vitest reports a startup failure (`src/runners/vitest/startup.ts`).
- A lane (`RunnerAdapter.lane`) is the owning adapter's name in the composite, but it is a scheduling name (slow lanes, `a+b` for an unowned project). It is not used as the record.
- No released Squeal inserts into any table without a column list (`git log -G` over `src`), and every read goes by column name (`node:sqlite` rows are objects). An added column cannot break an older daemon's statements.

## Store probe, 2026-10-25

`t/35f92bc7/probe-store.ts` (scratch, not committed). The older daemon is this worktree's store code before the step: no released version changes a `checks` statement, so it runs the same SQL. It opens a fresh store with the integrity check and keeps it open. A second connection, the new daemon, applies each step.

```text
old: wrote doc check before any step                       1
new: ALTER TABLE checks ADD COLUMN runner TEXT, ms         1.69
new: user_version after the step                           {"user_version":1}
old: listByTestFile (SELECT c.*) after the step            ["late.js"]
old: results.byKey k1                                      [["example.js","fail"]]
old: newestForTestFile                                     ["fail"]
old: meta get unrelated key                                null
old: error on its open connection after the step           null
checks.runner after old writes                             [["docs/example.js",null],["src/a.test.ts","vitest"],["docs/late.js",null]]
old: prune report                                          {"checksRemoved":2,"resultsRemoved":0}
checks left                                                [["src/a.test.ts","vitest"]]
meta project-runners after old prune                       {"value":"{\"py\":\"pytest\",\"\":\"vitest\"}"}
integrity_check                                            {"integrity_check":"ok"}
old: reopen with integrity check                           "opened"
old hook: open create:false                                "opened"
runner columns after a second open                         {"n":1}
```

What it shows:
- Column: the step takes under 2 ms and leaves `user_version` at 1. The older daemon's open connection goes on with no error: its cached statements re-prepare. Its inserts leave the column empty. Its `ON CONFLICT DO NOTHING` keeps a runner the new daemon wrote. Its prune deletes checks rows as before. It restarts on the stepped store through the integrity check, and its hooks open it. The step is idempotent.
- Meta map: the older daemon never reads or deletes the key. Its prune removed every `py` check and left `py` in the map. The map needs a prune rule of its own that only new daemons run.

## The two options

| | Column `checks.runner` | Meta map project to runner |
|---|---|---|
| Unit | one check | one project |
| Written | at each result write (`putMany`) | at each environment read (`setEnvironments`) |
| Scheduler lines | `store-results.ts` 1, `keying.ts` accessor 3; setup checks 1 more | `keying.ts` 1 |
| Setup checks | not recorded without the extra line | recorded |
| A check an older daemon wrote | empty until a new daemon runs it again; a lookup writes nothing | read from the map as soon as a new daemon enumerates the project |
| When wrong | never wrong; an empty record says nothing | a project renamed across runners: its old checks read the new runner from the map's write until the listing forgets them; a shared (not per-worktree) map also flips between worktrees that name one project for two runners |
| Prune | the row goes with its check | its own rule; an older daemon never prunes it |

Every gap of the column is an absent record, which D3 accepts ("says nothing rather than guess"). The map's gap can say the sentence beside a pytest failure, which is 007-45's defect.

## Decision and what landed

The coordinator, 2026-10-25, on this slice's requests: the column, no `user_version` raise; `WorktreeKeys.runnerOf` and the one `store-results.ts` line, each in a commit of its own; setup checks recorded too, with one statement in `Ledger#write` (`setup.ts` holds neither the store nor the keys). Nothing else under `src/core/scheduler/`.

- What first landed (`checks.runner`, one value per check, added at open by `columns.ts`) was replaced twice; the third round below is what stands.

## Repair: review 0.1.303 B1 (replaced by the third round)

The review proved that one runner per check is wrong. `checks` is shared by every worktree, and a file-level check has no test name. So a pytest doctest of `docs/example.js` in one worktree and a Vitest file of the same path in another are one check, and each `putMany` overwrote the one value. The coordinator's repair brief, 2026-10-25: the runner moves to the result, the setup producer to this worktree's own state, and `checks.runner` goes with no migration, since no release has it.

- Store: `addColumns` adds `results.runner`, with no `user_version` raise. `putMany(records, runner)` writes it with each row, and `copyNewest` copies it. Every row at one key names one runner, whichever worktree stored it, because the key hashes `runnerName`. `codec.ts` is back to its state before this row: no column guard, since every store new code opens has the column (`openStore` fails otherwise).
- Reads: `checks.runnerOf(check, key)` reads the row at that key. `withDependencies` takes the key from `readFailureKeys`: the key of the result this worktree's failing state holds, which the state sink records and older daemons record too (001-420). No key, no row or a NULL runner reads as none, so no sentence.
- Setup checks: `checks.recordSetupRunner(worktreeId, check, runner)` keeps a list under the worktree meta row `setup-runners:<wt>`, and `setupRunnerOf` reads only this worktree's list. Not a `known_states` column: `knownStates.upsertMany` writes with `INSERT OR REPLACE`, which would empty it, and the sink is outside this row. `WorktreeRepo.remove` drops the row with the worktree's others. The ledger line passes its worktree.
- Tests: `test/delivery/runner-collision.test.ts` runs the review's probe in both directions (pytest here and Vitest there, and the reverse) through the tool boundary and a registration, plus a setup record of this worktree and of another. All eight failed before the repair.
- Dev stores that ran the first 016-15 build keep an unused `checks.runner` column. No statement names it.

## Third round: re-review 0.1.303 B1

The re-review proved that `results.runner` breaks older daemons on Node 22. A statement prepared before `ALTER TABLE results ADD COLUMN` returns one field fewer from `all()` after it. A released daemon's `SELECT r.*, ..., f.summary, f.errors` then loses `errors`, and its `toResult` throws "squeal store: errors is not text". Node 24 keeps the field. The human chose a third round; the coordinator's brief, 2026-10-25: no table gains a column, and each worktree records a runner per project.

- Store: `results.runner`, `ADDED_COLUMNS` and `columns.ts` are gone, with no migration (never released). `results.ts`, `open.ts` and `codec.ts` are back to their state before this row, and so is `putMany`'s signature.
- Record: the worktree meta row `runners:<wt>` (`WORKTREE_META_ROWS`, owner `store/repos/test-files`) holds a list of `{ project, runner }`. `checks.recordRunners(worktreeId, Map<project, runner | undefined>)` reads it once and writes only a change. An `undefined` runner (environment not read) records nothing. `checks.runnersOf(worktreeId)` reads it. It replaces `setup-runners:<wt>`. `WorktreeRepo.remove` drops it with the worktree's other rows.
- Write point (asked and agreed, 2026-10-25): `Ledger#write` records the runner of every project its commit names, in the same transaction. That is the projects of its keyed files, its applied results (runs and lookups alike) and its setup outcomes, as `keys.runnerOf` names them; the helper `runners` sits outside the class. This is the only scheduler diff. `store-results.ts` is back to main. `storeResults` sees only this worktree's own runs, so a worktree that only looks results up would never have recorded.
- Read: `withDependencies` reads `runnersOf(worktreeId)` once and takes the failing check's project, for result and setup checks alike. A project has one runner in a worktree (`createCompositeRunner`), and another worktree's record is never read.
- A failure from another worktree stands here only after a local run confirms it (001 D6 as amended, `state/inherited.ts`). So a worktree cannot show a failure it only looked up from another worktree. The lookup-only case with a sentence is a daemon that looks up its own failure, which an older daemon stored with no record (`test/scheduler/check-runner.test.ts`). A worktree that inherits another's results records its runner from the lookup's commit, with no run ended.
- 011 C7 rule, accepted by 011 on 2026-10-25: "No column is added to an existing table under an unchanged user_version. A new field goes in a new table or a meta row, or comes with a user_version raise." `test/store/table-columns.test.ts` pins every table's columns at user_version 1. It fails at 80cbd43e2.
- Older daemons: `test/store/check-runner.test.ts` makes a store and a failing result with a released daemon's SQL, warms its result query, then lets a new daemon open, write and record. The held query returns every field. At 80cbd43e2 it fails on Node 22 and on Node 24. `test/daemon/step-down.test.ts` (released 0.1.31) passes on Node 22.
- Test fakes: ten tests build a `Ledger` over a partial `SchedulerContext`. Each now has `keys.runnerOf: () => undefined`, one line, in a test-only commit before the scheduler commit.

## Gaps a later row may close

- The record is per project, not per result. If a worktree moves a project name from one runner to another (a policy edit), its retained failures from the old runner read the new runner from the next commit on, until they are re-run. Within one worktree, that is the only way a record can be wrong.
- A project removed from the policy stays in the worktree's list. The list holds one entry per project the worktree ever ran.
- A worktree whose daemon is older records nothing. Its failures get no sentence until a new daemon commits there, which records every project it commits at its first commit.
- The Node runner set is a list of names in `attribution.ts`. A runner that declares whether Node's lockfiles decide what it loads would remove it; that is a runner description, a 016 non-goal.

## The key-format alarm (011 C14)

The validity bundle re-exports the store and `WorktreeKeys` whole, and the alarm asks a case to run each changed line. No `KEY_FORMAT_VERSION` raise, since keys do not change. After the third round, this row's lines on the path are `WorktreeKeys.runnerOf` and the ledger's record. `results.ts`, `codec.ts`, `open.ts` and `store-results.ts` have no diff. Harness edits (agreed with the coordinator for 011): the store harness's stub context names a runner (`vitest`) for `Ledger#write`. The assemble harness outputs `keys.runnerOf?.("") ?? input.environment?.runnerName`, equal at both trees. The store harness's `putMany` wrapper and the accept harness's producer are back to their state before this row. `key-format.test.ts` and `validity/compare.test.ts` pass.
