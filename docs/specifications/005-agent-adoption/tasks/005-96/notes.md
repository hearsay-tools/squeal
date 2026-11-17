# Row 005-96: the scheduler records what the late bound reads

Worker 74012cb8, wave 119 W1 (`../../../011-core/tasks/wave-119.md`), 2026-11-17. Base: main at 0.1.531 (`23f67d006`). Read-side contract: `contract.md` (this folder). Why: `../../reviews/0.1.530.md` B2, B3; `../../reviews/0.1.530-r2.md` R2-B1.

## Design (written before the code)

**Replaced by "Repair after review 0.1.535" (end of this file):** the in-transaction write below failed review 0.1.535 (B1). The sections up to "For the next worker" describe the first round, at `e3ac46929`.

### Where the write goes

**Inside the transaction that starts the tier.** `startTier` (`src/core/scheduler/tiers.ts`) runs one `BEGIN IMMEDIATE`: it takes the files off the queue, sets their running keys and claims, writes the unfinished run row and commits the ledger. The record is written in that same transaction, as its last write, in a savepoint of its own (`store.transaction` nests as a savepoint). So:

- The record and the start commit together: when the start commits, the record holds the tier (contract need 1, freshness). No second `BEGIN IMMEDIATE` exists, so no second lock acquisition can meet a competing writer between the start's commit and the flight. This removes R2-B1's gap rather than handling it: there is nothing between the commit and `fly` that can throw on a busy store.
- The record can still fail inside the transaction (a row that does not parse is not a failure: it reads as nothing recorded; a programming error or a SQLite error on the one `meta` write is). The record catches every error of its own: the savepoint rolls back the sample's write only, and the start goes on and commits (contract need 2, a failed write loses at most the sample). It never throws into `startTier`, which matters because the ledger's in-memory moves (queue, running keys, claims) are made before the commit and are not undone by a throw.
- The lock is already held when the record runs, so it cannot get `SQLITE_BUSY` on its own. Its cost is one `meta` read, one JSON parse and one `meta` write, inside the lock turn the step already holds, with no extra commit (no extra WAL sync).

`startTier` gains one optional mark, `started(tier)`: called inside its transaction after the start's own writes, and only when a tier starts. `act` in `tier-start.ts` passes the record with the tier's grant. `startTier` stays the generic start: the slow lanes' `#start` (`slow-tier.ts`, not this row's) passes nothing and records nothing, as on the wip branch, whose call site was `act` only.

### Rejected: after the run has flown

`startNext` calls `options.fly(tier)` right after `act` returns. A write after `fly` cannot strand a launch, and a lost sample is acceptable. But it is a second `BEGIN IMMEDIATE` in the step's lock turn (or a deferred write after it): it waits on the busy slice when another process holds the lock, which lengthens the turn by up to that slice, and its failure must be caught at a place that no longer knows the tier's facts unless they are captured first. It adds a commit (a WAL sync) per edit tier. The in-transaction write has none of these costs and no gap at all.

### The start stamp

The first start's delay is `tier.startedAt - revision.createdAt`, floored at 0. `tier.startedAt` is `newTier`'s action stamp, the tier's own start stamp (row 011-372 keeps it as the tier's one clock reading for its start). The record reads no clock of its own: no `context.now()` fallback, so `step-reading.test.ts`'s list of clock reads does not change.

### Which tiers

Only `kind === "edit"` tiers from `act` write; a backlog, turn, slow or focused tier writes nothing (contract need 5). A focused tier never reaches `startTier`. Both lists keep the newest 20 (need 4). The row's key is `worktreeMetaKey("editTimings", worktreeId)`, registered in `WORKTREE_META_ROWS`, so `WorktreeRepo.remove` drops it with the worktree's other rows (need 4).

### The lock turn

Measured before and after with card 7's method (`../../../011-core/tasks/011-357/notes.md`): the catch-up fake runner, a scratch `HOME`, a private store, one run at a time, the host's real load stated. The probe and its outputs are in `probe/` (this folder). Results: section "The lock turn" below.

### What the wip branch brings, and what it does not

From `origin/wip/005-93`: `src/core/scheduler/edit-timings.ts` (the record, `readEditTimings`), `src/core/delivery/late-timings.ts` (`pastBound`, `worktreeMedians`) with the pure bound it calls, `src/core/delivery/late-bound.ts`, the registry line, and the tests `test/scheduler/edit-timings.test.ts` and `test/delivery/late-bound.test.ts`. `late-bound.ts` is not in the brief's list; `late-timings.ts` imports `lateBoundMs` and `median` from it and the contract's `late-bound.test.ts` tests it, so it comes too, unchanged. Nothing of `late.ts`, `late-format.ts` or the delivery paths (row 005-97). Nothing calls `pastBound` in product code yet: 005-97 does.

## What changed

- `src/core/scheduler/tiers.ts`: `startTier`'s marks gain `started(tier)`, called last in the start's transaction, after `ledger.commit()`, only when a tier starts. It must not throw. The slow lanes' `#start` passes none.
- `src/core/scheduler/tier-start.ts`: `act` passes `started: (t) => recordEditTier(context, t, grantOf(t))`. `grantOf` is the grant expression `act` already used for a batch's estimate, now written once.
- `src/core/scheduler/edit-timings.ts` (from the wip branch, changed): `recordEditTier` returns at once for a tier that is not `edit` or has no `startedAt`; otherwise it writes in a nested `store.transaction` (a savepoint inside the start's transaction) and catches every error, so a failed write rolls back to the savepoint and loses only the sample. No `context.now()` fallback: the first start is `tier.startedAt`. `readEditTimings` is unchanged.
- `src/core/types/store.ts`: `editTimings: { prefix: "edit-timings:", owner: "scheduler/edit-timings" }` in `WORKTREE_META_ROWS`, so `WorktreeRepo.remove` drops the row.
- `src/core/delivery/late-timings.ts`, `src/core/delivery/late-bound.ts`: from the wip branch, unchanged. No product code calls them yet (row 005-97 will).

## Tests

- `test/scheduler/tier-start-timings.test.ts` (new):
  - **R2-B1 regression**: the store's busy timeout is 10 ms; a write observer makes a second connection take the write lock as soon as the first transaction ends and hold it; `startNext` with a `fly` counter. It asserts no error, one flight, the run row unfinished, the file off the queue, `tier.startedAt` equal to the clock, and the record holding `firsts: [{ revision, delayMs: 1500 }]` and the tier's run id. **Discrimination**: with the wip placement (`recordEditTier` called in `act` after `startTier`, a temporary edit, reverted) it failed with `database is locked` (`expected Error: database is locked ... to not be an instance of Error`), which is R2-B1's failure. With the record in the start's transaction it passes.
  - A record write that throws (`meta.set` for the key throws `disk I/O error`): the tier starts and flies once, its run row is unfinished, the file is off the queue, and no record exists. With the wip placement it failed (`Error: disk I/O error` out of `startNext`).
  - A row that does not parse is replaced by this tier's record.
  - A backlog tier records nothing.
  - The tier's estimate is the scheduler's own at the grant (two files of 1 s and 2 s at two workers: 2,500 ms).
- `test/scheduler/edit-timings.test.ts` (from the wip branch): the contract's three cases (`pastBound` at width 1 and at tier size 2; more than 20 tiers at one revision, then a later edit: the first start stays 1 s, then the median is 2 s), only edit tiers record, the overhead read. Added: 25 revisions with one edit tier each keep the newest 20 first starts and the newest 20 tiers, newest first.
- `test/delivery/late-bound.test.ts` (from the wip branch, unchanged): the pure bound.
- `test/store/worktree-meta.test.ts` (unchanged): it derives its cases from `WORKTREE_META_ROWS`, so the new row is covered by "drops every row of the removed worktree" and the owner and prefix rules.

The contract's five needs: 1, freshness: the record commits with the start (R2-B1 test reads it right after `startNext`). 2, no stranded launch, a failed write loses only the sample: the R2-B1 test and the throwing-write test. 3, the start stamp: `tier.startedAt`, asserted in the R2-B1 test. 4, bounded and removed with the worktree: the 20-entry test and `worktree-meta.test.ts`. 5, only edit tiers: the backlog test here and the wip's "records only edit tiers" (backlog, slow, turn, focused).

## The lock turn

Two probes in `probe/` (README there). Load is the host's real load, one minute, on 24 CPUs; other projects' processes were running and it was far above the CPU count (34 to 52). Not made on purpose.

**The step's turn that starts an edit tier** (`probe.test.ts`; catch-up fake runner, 2 files per project, 30 rounds of one edit of the source every file imports, `selecting the next tier [start-tier]`). Paired runs on a detached tree at the base `23f67d006` (before) and this branch at `e0d52baec` (after), alternately, 00:10 to 00:11 UTC. Median / p95 / max, ms:

| projects | before 1 (load 37.8) | after 1 (load 41.2) | before 2 (load 41.4) | after 2 (load 42.8) |
|---|---|---|---|---|
| 1 | 3.6 / 5.6 / 5.7 | 4.1 / 8.1 / 9.0 | 3.2 / 4.8 / 5.1 | 3.7 / 9.8 / 10.9 |
| 4 | 3.8 / 5.6 / 8.0 | 4.6 / 8.8 / 9.6 | 4.7 / 9.9 / 11.2 | 5.4 / 10.8 / 13.0 |
| 12 | 5.3 / 12.3 / 40.2 | 5.3 / 10.0 / 20.1 | 5.5 / 8.9 / 13.9 | 7.3 / 19.3 / 29.3 |

The medians grow by 0.0 to 0.8 ms in five of the six pairs and by 1.9 ms in one (12 projects, pair 2). In that run the turn this row does not touch, `recording the results of a tier`, also grew (median 5.6 to 7.5 ms), so that pair is mostly the load rising (42.6 to 44.5). At this load the whole-turn probe cannot separate a change below about 1 ms. The record was written in every after run (1.9 to 2.3 kB) and in no before run.

**The record alone, inside a start transaction** (`record.test.ts`, `record.txt`; a private store, 300 iterations, each one `BEGIN IMMEDIATE` with a stand-in start write, alternately without and with `recordEditTier`; one tier of 4 files; the width map filled to 1, 12 and 100 projects first). Load 47.2. Added cost, median / p95 / max, ms: **1 project 0.073 / 0.47 / 5.6; 12 projects 0.058 / 0.34 / 7.2; 100 projects 0.14 / 0.37 / 8.7**. The maxima are load spikes: the transaction without the record had maxima of 0.9 to 10.2 ms in the same runs. No extra commit and no second lock acquisition: the old wip placement's own `BEGIN IMMEDIATE`/`COMMIT` is gone, and it could wait a whole busy slice under a competing writer, which this placement cannot.

So the growth is a tenth of a millisecond at the median, below the "few milliseconds" that would need the coordinator before landing. Review N1 (an uncapped width map) is bounded in practice by the worktree's project count; at 100 projects the record adds 0.14 ms.

## Decisions the brief and contract did not settle

- **The start stamp is `tier.startedAt`** (`newTier`'s action stamp), not the step's `at`. The contract says "the step's reading (row 011-372), the one the tier's start stamp uses"; row 011-372's notes keep `newTier`'s `startedAt` as the tier's own start reading, and review 0.1.530-r2's closure 2 accepted it. Reading `at` would date the start before the work done in the turn. No clock read is added, so `step-reading.test.ts`'s list is unchanged.
- **The slow lanes' edit-kind tiers do not record.** A check group at normal priority starts `edit`-kind tiers through `slow-tier.ts`'s `#start`, which calls `startTier` too. The wip branch recorded only from `act`, and `slow-tier.ts` is not this row's, so `#start` passes no `started` and records nothing. If 005-97 needs group lanes' widths or starts, `#start` would pass the same callback.
- **A SQLite error that aborts the whole transaction** (`SQLITE_FULL`, `SQLITE_IOERR`, which roll back more than the statement) inside the record would make the start's commit fail too. The start's own writes have the same exposure, so this row adds no new failure kind; an ordinary error rolls back to the savepoint only (tested).
- `late-bound.ts` came from the wip branch though the brief does not name it: `late-timings.ts` imports it and the contract's `late-bound.test.ts` tests it.

## Type changes

- `startTier`'s marks: added `started?: (tier: Tier) => void` (additive).
- New module `src/core/scheduler/edit-timings.ts`: `TIMINGS_KEPT`, `editTimingsMetaKey`, `EditTimings`, `readEditTimings`, `recordEditTier`.
- New modules `src/core/delivery/late-bound.ts` (`LATE_FACTOR`, `BoundFile`, `LateBoundInput`, `median`, `tierEstimate`, `lateBoundMs`) and `src/core/delivery/late-timings.ts` (`worktreeMedians`, `pastBound`).
- `WORKTREE_META_ROWS`: added `editTimings`.

Not changed: `KEY_FORMAT_VERSION`, any key, tier order or width, status payload, note text, CLI output.

## Checks

On `306d1ce5d`. No `pnpm run build`, no full suite, no `squeal run --all`. Load is the host's real one-minute load on 24 CPUs.

- `pnpm run lint`: `Checked 3580 files ... No fixes applied.` `pnpm run typecheck` (`tsrs --fast --noEmit`): exit 0.
- The model test once with key-format (`vitest run test/scheduler/model-scheduler.test.ts test/keys/key-format.test.ts`, load 50 to 52): 2 files, 20 tests passed, 37 s. No `KEY_FORMAT_VERSION` raise.
- Direct (`vitest run --maxWorkers=4`, load 36 to 37): every test file that reaches `startTier`, `startNext`, `recordEditTier` or `WORKTREE_META_ROWS`, plus `late-bound` and `catch-up`: `capacity/pool`, `cli/next-step-pending`, `cli/status-wait-paths-slow`, `cli/status-wait-reasons`, `scheduler/busy-record`, `edit-timings`, `request-progress-ends`, `step-reading`, `step`, `tier-start-batch`, `tier-start-timings`, `tier-start`, `status/outstanding`, `store/worktree-meta`, `delivery/late-bound`, `scheduler/catch-up`: 16 files, 165 tests passed.
- `squeal status --wait 60000` over the 9 changed `src/` and `test/` paths at revision 27: 28 selected test files current, all pass (`edit-timings`, `edit-cut` among them); **1429 pending**, queued while the host was busy (20 of 24 cores in use); 0 known failures. `src/core/types/store.ts` selects 1456 test files, so most of the worktree waits. Pending is pending: no verdict on them.
- Not run: `test/e2e/**` (excluded by `squeal.config.json`); the bundles (`plugins/*/dist` are not this row's).

## For the next worker (row 005-97)

- Read the record with `readEditTimings` / `pastBound` / `worktreeMedians`; the shape is the contract's, unchanged.
- Check-group tiers started by the slow lanes (`slow-tier.ts` `#start`) do not record (see "Decisions").
- The probes in `probe/` can be rerun at a lower load; the paired whole-turn numbers here were taken at load 38 to 45.

## Repair after review 0.1.535

Review `../../../011-core/reviews/0.1.535.md` B1: a real `SQLITE_FULL` in the timing write ends the whole start transaction. The savepoint's `ROLLBACK TO` then fails, `recordEditTier` caught that, and `startTier`'s outer `COMMIT` threw `cannot commit - no transaction is active` after the ledger's in-memory moves. The file was off the queue with a running key, with no run row and no flight. Repair brief: `../../../011-core/tasks/wave-119.md`, "W1 repair: after review 0.1.535 (FAIL)".

### Where the write goes now

**After the flight owns the launch.** `startNext` (`tier-start.ts`) calls `recordEditTier(context, tier, grant)` right after `options.fly(tier)` returns. In the live scheduler `fly` is the step's `start-tier` decision, carried in the turn: `Scheduler.#fly` puts the tier in the in-flight map and starts its flight, whose error path puts the files back. So by the time the record writes, the launch has its owner. `act` returns the grant with the tier (`{ tier, grant }`), the same grant its batch estimate uses, now in `grantOf` (this also takes `act` from complexity 22 to 19). `startTier` is back to the base (no `started` mark).

`recordEditTier` writes in a transaction of its own, under `withBusySliceSync(0, ...)`: it never waits on a busy store, so it cannot hold the step's turn or the flight back. It never throws. A busy store loses the sample silently (contract need 2 allows a lost sample under contention). Any other error loses the sample and adds a status note, `squeal: could not record an edit tier's timings: <message>`, once per text (it reads the worktree's stored notes first). A `SQLITE_FULL` now rolls back only the record's own transaction; nothing of the start is in it.

The facts captured at the start are the tier's `startedAt` (on the tier) and its grant (from `act`). The rest is read at write time and does not change between the two: the revision's `createdAt` from the store, the tier size from the policy, widths and parts from the runner's traits.

Conditions this needs: no store transaction is open around `startNext`'s fly in production (none is: `step-live.ts`, `step.ts` and `scheduler.ts` open none around the step's tier start; a step run from inside a lock turn with no reads never starts a tier). A `startNext` with no `fly` records nothing: its caller flies the tier. Every production caller passes `fly` (`step-live.ts`).

### Regressions

- **New, automatic rollback** (`tier-start-timings.test.ts`, "a write that SQLite rolls back whole (SQLITE_FULL) loses the sample, not the launch"): the review's probe, `PRAGMA max_page_count = page_count + 10` and a 200,000-character runner part. It asserts one flight, the run row unfinished, the file off the queue, no open transaction, no record. **On the candidate (`e3ac46929`) it failed** with `Error: cannot commit - no transaction is active`; on the repair it passes.
- **Kept, competing writer** (R2-B1): the same two-connection setup. Now the record's write meets the held lock with a 0 ms slice and loses the sample with no note; the test asserts one flight, the run row unfinished, the file off the queue, no record and no note, then, with the writer gone, the next edit's tier records at its own start stamp (`delayMs` 700). This case also failed on the wip placement (first round).
- **Kept, a throwing write**: two starts whose record write throws: both tiers fly, no record, exactly one note.
- **New**: a `startNext` with no `fly` records nothing. The other cases (an unreadable row is replaced, a backlog tier records nothing, the estimate at the grant) now start with a `fly`.

The contract's five needs: 1, freshness: the record holds the tier as soon as `startNext` returns from its flight (the estimate and replace tests read it right after); a lost sample under contention is allowed. 2, no stranded launch, a failed write loses at most the sample: the three failure tests (busy, thrown, `SQLITE_FULL`). 3, the start stamp: `tier.startedAt`, asserted in the competing-writer test; no clock read. 4, bounded and removed with the worktree: unchanged (`edit-timings.test.ts`, `worktree-meta.test.ts`). 5, only edit tiers: unchanged.

### Agreed edit outside the file list

`test/scheduler/busy-record.test.ts` line 159, in its own commit (`d177b3764`): the one-shot fault `"not a busy store"` meant for the tier's record now names its target, `"recordTier"`. The new write is the store's next transaction after the flight starts, so it took that untargeted fault first, the tier record never failed, and "starts nothing from a resume armed before a stall on another error" timed out at 30 s (twice). Targeted, the case passes, and it keeps its meaning: it was written to fail the tier's record, which the new timing write now precedes. The coordinator agreed (reply to request `3a18e67a`, 2026-11-17: "A: keep d177b3764"). `busy-record.test.ts` sits next to card 9's files; no `src` file of card 9 or 10 changed (`git diff 23f67d006 -- src/core/scheduler/busy-resume.ts src/core/store/busy.ts src/core/scheduler/local-permits.ts src/core/capacity/ src/core/scheduler/record-tier.ts` is empty). The row's whole `src` diff against the base: `late-bound.ts`, `late-timings.ts`, `edit-timings.ts` (new), `tier-start.ts`, `types/store.ts` (one line). The other scheduler tests that replace `store.transaction` pass unchanged (`adoption`, `busy-released`, `commit-transaction`, `full-suite-pass`, `runtime-files-rollback`, `superseded-claim`, every `busy*`: 14 files, 38 tests).

### The lock turn, again

The path changed (a second, short write transaction in the step's turn, after the flight), so both probes ran again. Load is the host's real one-minute load on 24 CPUs; other projects' work held it at 56 to 86, far above the CPU count. My Squeal daemon was stopped during the probes.

**The record's own write after a start transaction** (`probe/record.test.ts`, now with the record in its own transaction; output `probe/record-own-write.txt`; 300 alternating iterations; load 86.0). Added cost, median / p95 / max, ms: **1 project 0.080 / 0.19 / 7.5; 12 projects 0.145 / 0.69 / 5.7; 100 projects 0.195 / 0.61 / 9.4**. The first round's in-transaction numbers (load 47.2) were 0.073 / 0.058 / 0.14 ms median (`probe/record-in-transaction.txt`). The own commit costs a few hundredths of a millisecond more at the median. Under contention it does not wait: a 0 ms busy slice.

**The step's turn that starts an edit tier** (`probe/probe.test.ts`), paired on a detached tree at the base `23f67d006` (before) and this branch at `88ea38856` (after), alternately, 00:37 to 00:38 UTC. Median / p95 / max, ms:

| projects | before 1 (load 84.3) | after 1 (load 81.0) | before 2 (load 79.6) | after 2 (load 79.6) |
|---|---|---|---|---|
| 1 | 3.9 / 10.0 / 27.2 | 4.4 / 9.4 / 16.6 | 7.4 / 13.0 / 15.2 | 3.9 / 5.6 / 6.2 |
| 4 | 4.6 / 11.1 / 25.4 | 5.4 / 21.9 / 77.4 | 5.1 / 17.1 / 18.2 | 4.5 / 14.1 / 18.7 |
| 12 | 6.6 / 18.2 / 29.1 | 6.4 / 15.1 / 27.0 | 5.9 / 16.0 / 30.5 | 6.5 / 14.5 / 53.5 |

At this load the medians move by -3.6 to +0.8 ms between runs of the same kind of turn, in both directions; the whole-turn probe cannot see a 0.2 ms change here. The record was written in every after run (1.9 to 2.3 kB) and in no before run. The first round's paired files are `probe/paired-before-0.1.535-{1,2}.txt` and `probe/paired-after-in-transaction-{1,2}.txt`.

So the growth stays about two tenths of a millisecond at the median, below the few milliseconds that would need the coordinator before landing.

### Review N1, for row 005-97

Normal-priority check-group lanes record nothing: `slow-tier.ts` `#start` starts edit-kind tiers through `startTier` and flies them without `startNext`, so no width, part, first start or overhead sample comes from them. The reader then uses width 1 for such a project and medians from the other tiers only. Row 005-97 decides: record at that start too (the same call after its flight), or state and test the fallback. This row leaves it, as the repair brief says.

### Type changes in the repair

- `tier-start.ts`: `Act`'s tier answer gains `grant: number` (internal). New internal `grantOf`.
- `tiers.ts`: the first round's `started?` mark on `startTier` is gone; the file equals the base.
- `edit-timings.ts`: `recordEditTier`'s signature is unchanged; it now owns its transaction and notes its failures.

Not changed: `KEY_FORMAT_VERSION`, any key, tier order or width, status payload, CLI output. One new note text, only when a timing write fails for a reason other than a busy store.

### Checks of the repair

On `7192e4c0b` (code at `d177b3764`). No `pnpm run build`, no full suite, no `squeal run --all`. Load is the host's real one-minute load on 24 CPUs.

- `pnpm run lint`: `Checked 3574 files ... No fixes applied.` `pnpm run typecheck`: exit 0.
- The model test once with key-format (direct, load 69 to 56): 2 files, 20 tests passed, 36 s. No `KEY_FORMAT_VERSION` raise.
- Direct, the regressions and their neighbours (load 58 to 67): `tier-start-timings` (8 cases, the new `SQLITE_FULL` case failed on `e3ac46929` before the repair), `edit-timings`, `tier-start`, `tier-start-batch`, `step-reading`, `late-bound`, `worktree-meta`: 44 tests passed. The 16 files of the first round's direct set: 166 of 167 passed before the busy-record edit (the one failure was the untargeted fault, above); after it, `busy-record` 3 of 3 and the 14 write-fault scheduler files 38 of 38.
- `squeal status --wait` over the changed `src/` and `test/` paths at revision 40, two waits of 540 s: 504 test files current, all pass among the selection; **398 pending** (queued, the host's load 30 to 50); known failures 0 in the selection. Among the current: `tier-start-timings`, `busy-record`, `edit-timings`, `tier-start`, `step`. Pending in Squeal at the end: `model-scheduler`, `key-format`, `worktree-meta` (each passed in the direct runs above).
- One failure outside the selection, expected: `test/harness/pi/package.test.ts` "has the bundles exactly as `npm run build:plugin` produces them" (`cli/ps.mjs differs from the build`). The committed bundles are older than this row's `src`; the brief forbids `pnpm run build`, and the coordinator's release step rebuilds them.
- Not run: `test/e2e/**` (excluded by `squeal.config.json`).
