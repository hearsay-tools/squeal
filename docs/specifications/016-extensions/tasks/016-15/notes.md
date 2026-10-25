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
