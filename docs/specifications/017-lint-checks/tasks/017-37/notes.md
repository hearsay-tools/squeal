# Row 017-37 notes: a gate gets the lint of the files it names (gh-238)

Worker b07b500e, 2026-11-28. Brief: `tasks/wave-9.md`. Evidence: `research/lint-gate-stall.md`.

## What changed, by contract item

1. **Edited quiet files lint as an edit's part.** A new record `lint-edited:<scope>` (`records.ts`, `editedKey`) holds the quiet paths that the revisions since the cursor changed. `judgeAll` (`rekey.ts`) writes it with the quiet set: an edit keying adds its changed quiet paths to the old set; a config keying starts it from its own changed paths (`plan.changed`, the revisions since the old cursor); a first keying leaves it empty (no cursor, no changed paths). `readEdited` keeps only the paths that are still quiet. `readQueue` (`parts.ts`) puts a pending path that is quiet and edited in the edit queue: `running(1)`, no backlog lease. The path stays quiet, so it records no transition. `forgetRecords` drops the record.
   - Why a record and not `ctx.first`: `first` comes from the keying of the current pass only. A pass that the pool refused, or that a nudge ended, keys nothing the next time, so `first` is empty there. The edited file would then go back to the backlog.
   - Changed behaviour: in a config keying, the changed included files (for example a nested `eslint.config.js`) now lint in their own edit part before the backlog part. `test/lint/pass/keys.test.ts` expected one part; it now expects two.
2. **`status --wait <paths>` waits for the named paths' lint.** `src/cli/wait/named.ts` asks `lintDecided` (`named-lint.ts`) once the test files decided a read (`settled`, `unmatched` or `slow`; not `focused`). With the daemon alive and the deadline not passed, the read goes on while a named check waits as `linting` or `backlog`. At the deadline the test files decide alone, so the exit code and the verdict mean what they meant before. The end always reads the lint once more for its `lint` field. `held` (commit, pause, stop, manual) and `stale` checks do not hold the wait: nothing lints them during it. A named folder picks every check below it. Lint off, a store not made yet, an unreadable or a busy store read as no lint, and the wait does not hold.
3. **A refusal names its cause.** `PermitPool.refusal()` (`pool.ts`) keeps the cause of the last backlog look that got nothing: `share` when the target was below the fewest workers (fair share or project cap), else `ceiling` when the CPU gate left fewer, else `queue` (permits held or kept for older waiters). This is the same order as `#logRefusal`, so the log's ceiling line and the record agree. `TierCapacity.backgroundGate()` adds `refusal` (agreed with the coordinator). The lint record (`cpu-wait.ts`) keeps `cause`; a cause that changes writes the record at once. The daemon log is unchanged: share and queue refusals are still not logged, because the test tiers meet a share refusal at every look under load.

## JSON changes (all additive)

- `squeal status --json`: `lint.linting.cpuWait.cause`: `"ceiling" | "share" | "queue"`. `busy` and `limit` stay in JSON for every cause; only the text drops them for `share` and `queue`.
- `squeal status --json --wait <ms> <path>...`: `selection.lint` and `wait.lint`, present only when lint is on and includes a named path. The snapshot form without `--wait` (`status --json <path>...`, `src/cli/wait/snapshot.ts`) does not read lint yet:
  - `done`, `pending`, `failing`, `unknown`: counts of checks (a path per tool). `failing` is part of `done`.
  - `files[]`: `{ path, tool, outcome: "pass" | "fail" | "pending" | "unknown", reason?, waits?: "linting" | "backlog" | "held" | "stale", cpuWait?, findings? }`. A stale check reads `pending` with `waits: "stale"`.
- The repository-wide `linting` count is unchanged.

## Text changes

- Status and registration: `waiting for this worktree's share of the worker pool` or `waiting in line for a free worker of the pool`, with no CPU numbers; `waiting for CPU (21 busy, limit 18)` stays for the ceiling.
- Named wait, before its verdict line: `Lint of the named files: 2 checks, 1 linted, 1 with findings, 1 pending; squeal lint lists the findings.` Then one indented line for each check with no clean verdict, at most 10: `src/a.ts (eslint): pending: waits in the backlog of a full re-lint, waiting for this worktree's share of the worker pool`.

## Spec text D7 and D8 need (for the coordinator)

- D7 step 4: "A pending file that a first or config keying left quiet, and that the revisions since the cursor changed, lints in an edit's part (`running(1)`, outside the background ceiling) and records no transition. The pass keeps those paths in `lint-edited:<scope>` until they lint or the next first or config keying."
- D7 or D9, the wait record: "A refused part's record names the cause the pool gave: `ceiling`, `share` or `queue`. Only `ceiling` is a wait for CPU."
- D8 Status: the two new wait wordings above; JSON `linting.cpuWait.cause`.
- D8, a new "Named wait" item: "`squeal status --wait <ms> <path>...` waits, after its test files decide and before its deadline, for the lint of the named paths that the pass lints now (`linting`, `backlog`). Its JSON `lint` gives those paths' checks apart from the repository count. At the deadline the test files decide alone."

## Remaining concerns

- A gate that names files it did not change in this worktree (for example the diff against main in a new worktree whose first keying runs) still waits for the backlog: those files are not edited since the keying. Only a promotion of named paths into the lint queue, a daemon request, would fix that. That is outside this row's ownership (`src/core/daemon/`).
- `namedPoll.read` stays at complexity 40 and `LockFilePool.acquire` at 22, as before this row.
- The named wait opens the lint store at each read after the test files decide, until the lint is done. This is the same cost as the lint group's wait.
