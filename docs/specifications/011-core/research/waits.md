# Waits: one module for how Squeal's commands wait, the run waits first

This is the design brief from the architecture review of 2026-11-12, report card 3. Sources: main at `6eb3c3a0a`, rechecked at `c601627a6`; Cezar task af6c0b3f, report artifact d8b46fe2. The design session is task c86019be.

- Terms are in `GLOSSARY.md`: Wait, Status wait, Run wait, Wait outcome; Daemon presence for the gone rule; Covered files from card 2's section Requests.
- The decisions below are the human's, taken one at a time on 2026-11-13.
- Rows 011-326, 011-327 and 011-328, approved by the human on 2026-11-13 ("Approve, land, start").

## Problem

Seven loops in the CLI wait on results. Each repeats the deadline, the poll, the store read, the daemon watch and the outcome order.

| Wait | Command | Where (at `c601627a6`) |
|---|---|---|
| status wait, edit form | `status --wait`, `run --slow --wait` | `src/cli/status-wait.ts:214` `waitForStatus` |
| status wait, named form | `status <path> --wait` | `status-wait-paths.ts:218` `waitForNamed` |
| status wait, snapshot | `status <path>` | `status-paths.ts:60` `readNamedSnapshot` |
| run wait, checkpoint | `run --all --wait` | `run.ts:333` `ended`, `pollCheckpoint` |
| run wait, group | `run <group> --wait` | `run-group-wait.ts:226` `ended`, `pollGroup` |
| run wait, lint group | `run <lint group> --wait` | `run-lint-group.ts:136` `linted` |
| `squeal code <path>` | complexity report | `code.ts:246` `waitForPass` |

Four more loops wait for the daemon to take a request before a run wait starts:

- `run.ts:221` `recorded`
- `run-slow.ts:96` `taken`
- `run-group.ts:164` `taken`
- `run-lint-group.ts:85` `taken`

The rules the loops repeat differ between them:

- **Is the daemon gone.** Three rules:
  - The status waits use daemon presence's wait view (`watchDaemon`).
  - The snapshot reads the raw heartbeat.
  - The run waits ping the socket every 5 polls and read a store that does not open as "stopped". `run.ts` pings with no deadline bound.
- **Has the daemon's pass reached this read.** It is decided in 5 places in the status waits (`isSynced`, `readiness`, the snapshot's `ready`, `unsynced`). The run waits do not ask it.
- **Store errors.** Two helpers:
  - `withStatusStore` retries a busy store, then says unavailable.
  - `inStore` (`run-lanes.ts:67`) returns `null`, which prints "the daemon stopped", and lets a busy error throw.
- **Outcome orders.** Six:
  - status: news > no daemon > quiet > on hold > timeout
  - named: no daemon > decided > on hold > timeout
  - snapshot: as named, on the raw heartbeat
  - checkpoint: moved > abandoned > on hold > ended > deadline
  - group: on hold > deadline or ended
  - lint group: ended or deadline, then stopped

### What the history shows

Counted on 2026-11-13 from the review files and git; each cause was judged by one reader.

- **Review blockers since 2026-11-04:** 4 in this code, out of about 84 blocker headings in 101 review files.
  - Only one is in a loop's read path: `011-core/reviews/0.1.409.md` B1. An optional heartbeat read in a group request threw "database is locked" and ran about 1 s past a 300 ms wait.
  - The other three are text or file selection beside the loops: `019-run-triggers/reviews/0.1.411.md` B2, `0.1.412.md` B1 and `0.1.412-r2.md` B1-R1.
  - For 2 of the 4, another wait already had the right rule: `withStatusStore`'s busy catch for 0.1.409 B1, and `run.ts` `filesText` for 0.1.411 B2.
- **Fix commits since 2026-10-20:** 39 on these files. By family: 27 in the status waits, 9 in the run waits, 3 in `code.ts`.
  - **By cause:** deadline 5, daemon gone 7, store errors 5, synced 4, hold 1, which files 5, wording 6, other 6.
  - **Daemon gone:** all 7 fixes landed in the part the status waits share (`wait-liveness.ts`). The run waits got none of them.
  - **Already elsewhere:** for 4 of the 39, another wait already had the rule.
- **Since 2026-11-04:** no fix to the status waits' loops; 5 fixes to the run waits (`03d57de22`, `16e27c590`, `a45ae2179`, `df5b3001d`, `2412b4240`).
- **Earlier record:** `016-extensions/research/core-defects.md` counts status and wait as 75 of 415 core defects. Within that, "status and wait, order" is 12 items over 6 FAIL rounds, and its catch is "owner".

These are small counts. They show where the cost has been, not how large it will be. They also show the pattern this card addresses: a rule reaches some waits and not the others. The on-hold rule (row 011-73) was added to five loops one by one.

### Gaps open today in the run waits

Read in source code on 2026-11-13; not run; no issue reports them.

- **Busy daemon.** `askDaemon` throws on a socket timeout (2 s). `run.ts` `recorded` and `ended`, and `run-slow.ts` `taken`, call it unbounded and uncaught. A busy daemon then ends `run --all` or `run --slow` with a stack trace and exit 1. The group loops use `askWithin` and go on.
- **Busy store.** A busy error inside an `inStore` read throws. This affects `run.ts:340` and `run-group-wait.ts:229`.
- **Unopened store.** A store that does not open (missing, corrupt, newer schema) prints "the daemon stopped".
- **Lint group at the deadline.** With nothing left to lint at the deadline's read, the lint group returns `deadline`, so it gives no verdict (`run-lint-group.ts:157`). A test group gives its verdict.
- **Edits not yet stored.** The run waits never ask the daemon to store the edits made before the command (lessons defect 30). The checkpoint wait ends on a newer revision instead. The group wait may give a verdict at the revision before an edit (inferred).

## Decisions (the human, 2026-11-13)

1. **The run waits first ("B: run waits first").**
   - The run waits move into one wait module first: checkpoint, group, lint group, and the loops that wait for the daemon to take a request.
   - Then they get the status waits' rules.
   - The status waits (edit, named, snapshot) move in later, in a row of their own. The human decides on that row after 011-326 and 011-327 pass review.
   - Rejected:
     - Fix the run waits in place. Each next rule would again be added per wait.
     - All waits at once. About 3,500 lines and about 75 test files in one move review; the last move of this kind, the daemon presence readers, took three rounds.
2. **`squeal code <path>` stays out ("Leave it out").**
   - It waits up to 750 ms for the daemon to count changed files. It has no deadline and no daemon check.
   - It starts a sync only to make the daemon store the edit sooner, and never reads the answer.
   - Spec 020's coordinator works in that command.
3. **Named waits with a rule table, and a pure decision inside ("1 with 2 inside").**
   - The module knows each wait by name.
   - A command asks with plain data: which wait, which files, the deadline. It passes no functions.
   - Each difference between waits that is there on purpose is one cell in one table, beside the others: the outcome order, whether a newer revision ends the wait, which gone reading applies, what an unopened store means, and whether socket requests are bounded by the deadline. A cell exists only for a difference between two waits.
   - The decision is pure. It reads one record of what a read found and answers "go on" or "end, with this outcome and this reason". One polling loop owns the reads, the clock, the socket and the daemon watch.
   - This is daemon presence's pattern.
   - Rejected:
     - The table with a decision that reads the store itself.
     - A pure decision with no table.
     - Moving each wait's chain unchanged.
4. **The second row's changes ("1, 2, 3").** The run waits take the status waits' rules for:
   1. **A busy daemon, a busy store, an unopened store, a late end.**
      - A busy read is skipped and read again.
      - A late socket answer counts as a busy daemon.
      - An unopened store gives its reason, with exit 3.
      - Every socket request ends by the deadline.
   2. **Daemon presence's wait view for "is the daemon gone".**
      - After `squeal stop`, the wait ends at its next read and names the stop.
      - A daemon update's handoff is waited through, up to its bound.
      - A daemon that died is found after 15 to 20 s, not within 5 s. That is the status waits' rule: the heartbeat interval is 5 s, the grace is 2 intervals, and the socket must stay dead for 10 s (`WAIT_DOWN_MS`).
      - The human accepted the slower notice of a crash in exchange for no false "stopped" during an update. There were 53 releases in the 8 days to 2026-11-13.
   3. **A lint group gives its verdict** when its last check ended by the deadline's read.
5. **An edit made just before `run <group> --wait` ("Proposed row, reproduce first").** It is a proposed row of its own, and a reproduction comes first. It is not in 011-327.
6. **The rows ("Approve, land, start").** Rows 011-326 to 011-328 are approved, and a coordinator starts them.
7. **The older planned rows of the status waits stay planned ("Stay planned").** These are 011-44 (fewer closure reads), 011-45 (fewer state reads) and 011-49 (the snapshot's end time). The human's decision on status-waits-join places them.

## Agreed with sibling designs

- **Card 2 (request intake, task b3f9b586), 2026-11-13, requests 121590bc and e07b00ac.**
  - Card 2's intake records each request's covered files as the scheduler decided them: queued, already current, or not queued with the reason.
  - The record is in the store, written in the request's own transaction and keyed by a request id. The socket answers carry only that id, because a group's list would pass the 64 KiB line limit.
  - The conditions card 3 set:
    - one transaction with the pending files;
    - a reader in `src/core`, never a raw row read in the CLI;
    - the record is kept while any of its files is pending;
    - an answer with no id keeps today's guess;
    - the record survives a daemon handoff.
  - Card 2's row 011-325 records them; row 011-328 switches the waits to read them. Card 2 changes no `src/cli` file except one wording function, `run-group.ts` `requestedText`.
- **Card 4 (the daemon's progress records)** follows in this lane. The module reads those records in one file of its own: the refined revision, the checkpoint end and progress, and the install wait. Card 4 replaces that file's reads and nothing else.

## Coordinator's calls (repo-local; the human may overturn)

- **Location.** `src/cli/wait/`, with one entry file and no barrel (row 015-110).
  - It lives in the CLI because its adapters are CLI code: the daemon sync, the presence wait's I/O (`wait-liveness.ts`), `askWithin` and `verdict.ts`.
  - No file in `src/core` imports from `src/cli`.
- **Interface (for 011-326).**
  - One entry for the run waits: the wait's name with its data (the checkpoint, the files, the group) and the deadline. It returns today's outcome union for that wait, and the command renders it as today.
  - One entry for "until the daemon takes this request" serves the four request loops. Each keeps its own response type and wording.
  - Ports, each with a production and a test adapter:
    - the clock (`Date.now`, `performance.now`, the pause);
    - the socket (`askDaemon`, `askWithin`);
    - the daemon watch (`watchDaemon`, from 011-327).
  - The store stays local-substitutable: a scratch store in tests, because the waits read too many tables for a narrow stub.
  - The files a run wait is for are an input: a lane, a group, or a list. This is the seam for 011-328.
- **011-326 keeps behaviour.**
  - Each wait's chain of conditions becomes its row of the table in the same order. Each accidental difference listed above stays as a cell value named in the table.
  - Every outcome, printed line and exit code stays the same.
  - `run --slow --wait` keeps its file wait in the status wait (`waitForStatus` with `holdSlow`). Only its request loop moves.
- **011-327 changes only the cells of decision 4.** Spec 005 D1 and spec 019 D6 are amended where they name how a run wait ends:
  - the daemon-gone reasons;
  - the unopened store;
  - the lint group's verdict at the deadline.
  "The daemon stopped" lines name why, using the reasons the status waits print.
- **Tests: replace, don't layer.** The new test surface is one table at the module's interface.
  - **Pure rows:** a read record in; the outcome and its reason out. Every outcome of every run wait, with no store, socket or real clock.
  - **Loop rows:** a scratch store, the existing fake daemon socket and a stepped clock. They cover a busy store, an unopened store, a late socket answer, the deadline's last read and the request loops.
  - **Deleted** once the table covers their cases (the worker names each):
    - the decision cases of `test/cli/run-all-verdict.test.ts`: on hold, abandoned, moved, deadline, stopped;
    - the same in `run-group-wait.test.ts` and `run-lint-group.test.ts`;
    - the socket-bound cases of `run-group-stall.test.ts`.
  - **Stay:**
    - the receipt and wording tests (`run-group.test.ts`, `run-slow.test.ts`, `run-slow-unchanged.test.ts`, `run-all-owner.test.ts`, `run-group-narrow.test.ts`);
    - one real-daemon test per wait (`run-all-verdict-daemon.test.ts`, `run-group-daemon.test.ts`);
    - the slow file waits (`run-slow-wait`, `run-slow-held`, `slow-wait-liveness`), which test the status wait.
  - 011-326 keeps all of them passing; the cases it deletes are named in its notes.
- **Progress reads.** One file of the module reads the progress records the run waits use: the checkpoint end and progress, the latest revision, and the install wait with its command. It reads them through today's parsers and adds no meaning. Card 4's seam.

## Not in scope

- **The status waits** (edit, named, snapshot), until the human decides on the proposed row below. The same holds for their own differences:
  - the snapshot's raw heartbeat;
  - the five copies of the synced rule;
  - the raw SQL in `status-wait-listing.ts`;
  - `anyPending`'s copy of `isPending`;
  - the planned rows 011-44, 011-45 and 011-49. They stay planned (decision 7); the human's decision on that row says where they go.
- **`squeal code <path>`** (decision 2).
- **The daemon's side of requests.** That is card 2's.
- **The meaning of the daemon's progress records.** That is card 4's.
- **Daemon presence's rules.** The module reads presence's wait view and does not change it. A faster notice of a crash would be a presence change for every wait.
- **Gate verdicts** (spec 020) and the delivery model (ADR 0003).

## Rows (spec 011; approved by the human, 2026-11-13, "Approve, land, start")

1. **011-326 One wait module for the run waits, behaviour preserved.**
   - Decisions 1 and 3 and the coordinator's calls.
   - `run --all --wait`, `run <group> --wait` (test and lint) and the four request loops take their polling, deadline, store read, daemon check and outcome from the module.
   - Done when:
     - no polling loop for these waits is left outside `src/cli/wait/`;
     - each wait's outcomes, lines and exit codes are byte for byte as before;
     - the rule table names each difference between the run waits;
     - the table test covers every outcome of every run wait and the request loops;
     - the existing run tests pass, less the cases the table replaced, each named in the notes.
2. **011-327 The run waits take the status waits' rules.** After 011-326.
   - Decision 4, items 1 to 3.
   - Done when:
     - the table's run-wait rows read the presence wait view, the busy-store retry and the deadline bound;
     - no stack trace is left on a busy daemon or store, with one loop row each;
     - an unopened store gives its reason with exit 3;
     - after `squeal stop` the wait ends at the next read and says so;
     - a handoff is waited through;
     - the lint group's deadline row gives the verdict;
     - specs 005 D1 and 019 D6 are amended.
3. **011-328 The run waits read a request's covered files from the scheduler's record.**
   - After 011-326 and card 2's record row, 011-325.
   - The run waits read the request's covered files through card 2's reader, by the request id in the answer, in place of `laneFiles` and the group view in `ownOf`. An answer without an id keeps today's guess.
   - Done when:
     - no CLI file derives a request's files from the policy when the answer names a record;
     - a loop row covers an older daemon's answer;
     - a narrow run's "not queued" files read from the record.

Proposed; not approved and not dispatched:

- **group-wait-edits: an edit made just before `run <group> --wait` may be missing from its verdict.**
  - Decision 5. A reproduction comes first: an edit, then at once `run <group> --wait`, on a loaded and an idle host, in a sandbox that does not reach the real `HOME`.
  - If it reproduces, the group wait reads only after the daemon's pass over the edits made before the command. That is the status waits' sync, at the cost of that pass's time.
  - The human decides from the reproduction.
- **status-waits-join: the status waits move into the wait module, behaviour preserved.**
  - The human decides after 011-326 and 011-327 pass review.
  - Its decision also places 011-44, 011-45 and 011-49, and the status waits' own differences listed under Not in scope.

## Process

This is product code in `src/`. A coordinator for spec 011 runs the rows, one worker each, in order: 011-326, then 011-327. 011-328 runs once card 2's record row, 011-325, has landed. Each candidate needs a passing review before main (`docs/process.md` steps 5 and 6).

- **Shared files.**
  - `src/cli/run-group.ts` is shared with card 2's wording row (`requestedText`). Whichever lands second rebases.
  - `src/cli/run.ts` and `run-group-wait.ts` have no other running row on 2026-11-13.
- **Other coordinators.**
  - Spec 020's coordinator (31e1d860) works in `src/cli/code*.ts`. These rows do not touch them.
  - Card 2's rows 011-322 to 011-325 have their own spec 011 coordinator. Its rows stay in `src/core/scheduler` except 011-324, which changes `run-group.ts` `requestedText`. The two coordinators agree their version claims and the order of `run-group.ts`.
