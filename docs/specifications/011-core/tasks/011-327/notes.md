# 011-327: the run waits take the status waits' rules

Worker 664d4f3e, 2026-11-13. Brief: `tasks/wave-83.md` W1. Record: `research/waits.md`, decision 4. Starts from row 011-326's module (`tasks/011-326/notes.md`) and review `reviews/0.1.469.md` N2.

## Commits, one per step

| Step | Commit | What |
|---|---|---|
| N2 pinned | `f76860341` | Port rows: a run-all and run-slow status request, and a checkpoint ping, that get no answer throw today. |
| 1, late answers | `7f347dc7e` | Every socket request of a wait or a request loop ends by the deadline (`askWithin`). The N2 rows flipped. |
| 1, first requests | `ef8536f8f` | The coordinator's call (request ae112da0, "bound them"): the first `run-all` and `run-slow` request ends by the deadline too. |
| 2, busy and unopened store | `ded5c7d65` | The worktree store read through `withStatusStore`; a busy read is read again; a store that does not open gives why, exit 3. |
| 3, gone daemon | `2e1a335e7` | The `GONE` rule reads daemon presence's wait view (`watchDaemon`); the stopped lines name why. |
| 4, lint group at the deadline | `3663b66ef` | `nothing to lint` before `late`. |
| Repair of review 0.1.474 B1, tests | `b0a1b7c74` | Two loop rows over a real exclusive lock on the lint store, red; a damaged lint store pinned as `unread`. The lint group's loop rows move to `lint-loop.test.ts`. |
| Repair of review 0.1.474 B1, change | `0814d4a5c` | A busy lint store is read again until the deadline's read; any other failure stays `unread`. |

## Each cell before and after

The status wait each change now matches is `waitForStatus` (`src/cli/status-wait.ts`) unless the row says otherwise.

### Run waits (`RUN_WAITS`)

| Cell | Before (011-326) | After (011-327) | Status wait rule it matches |
|---|---|---|---|
| checkpoint `socket` (the ping) | `unbounded`: `askDaemon`'s 2 s; a late answer threw a stack, exit 1 | Step 1: `askWithin`, a late answer is a busy daemon, the wait goes on. Step 3: no ping at all; the cell is gone | The status waits never ping in the loop; `watchDaemon` asks the socket in the background, and a socket that accepts and does not answer is a stalled daemon that goes on (`wait-liveness.ts` `listening`) |
| group and lint group `socket` | `deadline` | Gone: no row differs, and after step 3 no run wait pings | as above |
| checkpoint and group: the store read | `inStore`: 1 s busy timeout, no transaction; a busy error threw a stack | `withStatusStore`: one read transaction; busy timeout `min(1000, left)`, at least 50 ms; the deadline's read waits the full `STATUS_BUSY_TIMEOUT_MS` (`readBound` in `wait/presence.ts`) | `status-wait.ts:244-249` |
| checkpoint and group: chain head | `store unopened → stopped` | `STORE`: `store unopened → unopened` (why); `store busy ∧ late → unopened` (why); `store busy → go on` | A read that fails with a busy lock is skipped; the deadline's read that cannot read ends the wait with the store's reason (`status-wait.ts:395-398`) |
| `GONE` | `ping due ∧ no daemon → stopped`: a ping on every fifth read (`PING_POLLS`) | `daemon down → stopped`, with the reading: at every read that reaches the rule, `watch.judge(record, at, stoppingOf(store, worktree, at))` | `status-wait.ts:296-301` and its `settled && daemon.state === "down"` (line 356) |
| lint group chain | `late → deadline` before `nothing to lint → ended` | `nothing to lint → ended` before `late → deadline` | The group wait's own order (`files settled` before `late`) |
| lint group outcome order | off, unread, then deadline > ended, then stopped | off, unread, a busy lint store at the deadline's read, then ended > deadline, then stopped | |
| lint group: the lint store read (review 0.1.474 B1) | `withLint(lintStoreSource(commonDir, root))`, the lint store's default 1 s busy timeout; a busy store and a damaged row both `failed`, read as `unread`, which ended the wait at once | The CLI's own read (`lintRead` in `wait/reads.ts`): `lintStoreSource(commonDir, root, { busyTimeoutMs })` with `readBound`'s timeout; an error at the open or in the read that `isBusy` tells is `counts: "busy"` with why and `late` as the read began; any other failure, a missing store and an unreadable one stay `unread` | The worktree store's rule above (`STORE`), itself `status-wait.ts:244-249` and `395-398` |
| lint group chain head (review 0.1.474 B1) | `lint off → off`; `lint unread → unread` | then `lint busy ∧ late → unopened` (why); `lint busy → go on` | as the worktree rows' `STORE` |

Common to every row now, so not a cell: every socket request ends by the deadline (`askWithin`).

### Request loops (`REQUEST_LOOPS`)

| Cell | Before | After |
|---|---|---|
| `run-all` `socket` | `unbounded`: a status request with no answer in 2 s threw a stack | Gone: `askWithin` for every loop. No answer within 2 s is `unanswered`; one the deadline cut short is `pending` |
| `run-slow` `socket` | `unbounded`, as `run-all` | as `run-all` |
| `run-group` `socket` | `deadline` | Gone (no row differs) |

Unchanged: `askBy`, `wrong`, `pause`. The `run-all` and `run-slow` pause stays a fixed 100 ms: a pause, not a socket request, so such a loop can still end up to 100 ms past the deadline (named, not changed).

### Outside the table (the coordinator's call)

The first `run-all` request (`run.ts` `requestRunAll`) and the first `run-slow` request (`run-slow.ts`) ask through `askWithin`, by the `--wait` deadline, or without `--wait` by the request loop's 10 s bound (`RECORD_WAIT_MS`), so 2 s through `socketBound`. No daemon (`null`) keeps today's line.

## The exact new lines

`<why>`, `<reason>` and `<id>` are filled as listed under each.

### A busy daemon (decision 4 item 1)

1. `run --all`, a status request with no answer (the `run-all` request loop). With `--wait`, stdout, exit 3: `No verdict: the daemon did not answer about request <id> within 2 s; the daemon records the checkpoint once its current work allows`. Without `--wait`, stderr, exit 1: `squeal: ` and the same text. A socket error replaces ` within 2 s` with `: <error>`. A request the deadline cut short keeps today's pending line (`the deadline passed before request <id> was recorded; …`).
2. `run --slow`, a status request with no answer. Without `--wait`, exit 0: `Slow tier requested (request <id>); the daemon did not answer about it within 2 s and takes it once its current work allows`. With `--wait`, exit 3: `Returned without a verdict after <s> s: the daemon did not answer about slow tier request <id> within 2 s; the request is pending and this command has no verdict for it. The daemon takes it once its current work allows; \`squeal status --wait 60000 <slow test file>\` then waits for that file's result.` This is the run-slow pending path (exit 0 or 3), not its failure path (exit 1): the request may still be taken.
3. The first request with no answer, `run --all` and `run --slow` alike (`<cmd>` is `run --all` or `run --slow`). With `--wait`, stdout, exit 3: `No verdict: the daemon did not answer the <cmd> request before the deadline; it may still take it once its current work allows` (or ` within 2 s` when the 2 s bound ended it first). Without `--wait`, stderr, exit 1: `squeal: the daemon did not answer the <cmd> request within 2 s; it may still take it once its current work allows`.

### A busy or unopened store (decision 4 item 1)

4. `Checkpoint <id> has no verdict: <why>`, `Group <g> has no verdict: <why>`, `Selected test files of group <g> have no verdict: <why>`; exit 3. `<why>` is `withStatusStore`'s reason without its lead `status unavailable, ` (`unavailableText`):
   - `no Squeal store at <path>/store.sqlite`
   - `store version newer than this Squeal (store <n>, supported <m>)`
   - `store at <path> is corrupt`
   - `store unreadable: <error>`
   - `<cwd> is not inside a git worktree`
   - at the deadline's read only: `store busy, waited <n> ms: another process holds the store's lock; run the command again once it is released`

   Was: `… the daemon stopped before it ended` (a store that did not open), or a stack trace and exit 1 (a busy store).

4a. Review 0.1.474 B1, the lint group: `Group <g> has no verdict: lint store busy, waited <n> ms: another process holds the lint store's lock; run the command again once it is released`, exit 3, at the deadline's read only. A busy lint store before the deadline is read again. Was: `Group <g> has no verdict: the lint store cannot be read` after about 1 s of a busy store, whatever the deadline. A damaged, newer or missing lint store keeps that line.

### A gone daemon (decision 4 item 2)

5. The stopped lines keep their lead and name why in parentheses, in the status waits' words (`noDaemonText`, `status-wait-lines.ts`):
   - checkpoint: `has no verdict: the daemon stopped before it ended (<reason>)`, then today's `; the next daemon resumes it, and \`run --all --wait\` then waits for it` when owed
   - group: `has no verdict: the daemon stopped before the group's test files had results (<reason>)`; narrow: `have no verdict: the daemon stopped before the selected test files had results (<reason>)`
   - lint group: `has no verdict: the daemon stopped before the group's lint checks were linted (<reason>)`

   `<reason>`, by the wait view's `DownReason`:
   - `stopped` (a cleared record: `squeal stop`, or a handoff whose claim's bound passed with the record cleared): `no daemon has validated since <ISO time>: the daemon stopped`
   - `silent` (a heartbeat past its grace and a socket dead for `WAIT_DOWN_MS`): `no daemon has validated since <ISO time>: its heartbeat stopped and nothing listens on its socket`
   - `handoff` (a recorded stopping daemon past its handoff's bound): `the handoff to <version> did not finish within 130 s; \`squeal start\` finishes it`
   - no time known: `no daemon is running`

   Was: the lead alone, decided by a ping on every fifth read (a ping with no daemon: about 4 to 5 s after the daemon went; a handoff with its socket closed read as stopped).

### The lint group at the deadline (decision 4 item 3)

6. No new line. A lint group whose checks are all linted at the deadline's read now prints its ended line (`Group <g> completed: no lint findings in <n> files`, exit 0, or its findings, held or unknown lines) in place of `has no verdict: the deadline passed with 0 lint checks pending; the group goes on in the daemon`.

## For spec 005 D1 and spec 019 D6

What changes in how a run wait ends:

- **005 D1, exit 3 list.** "no daemon" now also covers: the daemon did not answer within its bound (the first request or a status request), and the store did not open (named by its reason). The daemon is judged gone as `status --wait` judges it: a cleared record at the next read, a handoff waited through to its bound, a dead daemon after the heartbeat's grace and 10 s of a dead socket (15 to 20 s after its last heartbeat). The first line names which.
- **019 D6.** The same for `run <group> --wait` and its narrow run; a lint group whose last check ended by the deadline's read gives its verdict, as a test group does. A busy lint store is read again until the deadline's read, as the worktree store is; one still busy then ends the wait with why, exit 3 (review 0.1.474 B1). A damaged lint store still ends the wait with `the lint store cannot be read`.

## Flipped or replaced test cases

| File | Was | Now |
|---|---|---|
| `test/cli/wait/request-loop.test.ts` | "run-all and run-slow: a status request with no answer throws" (N2, pinned in `f76860341`) | "… with no answer within 2 s is a busy daemon, no throw" (`unanswered`) |
| same | (none) | "… a status request the deadline cut short leaves the request pending": the deadline bound for `run-all` and `run-slow`, new with the bound |
| `test/cli/wait/run-loop.test.ts` | "a ping with no answer throws out of the wait" (N2) | step 1: "a ping with no answer is a busy daemon: it goes on"; step 3: "a busy daemon: a lapsed heartbeat whose socket holds a daemon goes on, no throw" |
| same | "stopped: a store that does not open (accidental, 011-327 gives its reason)" | "unopened: a store that does not open ends the wait with why" |
| same | "a busy store throws out of the wait (accidental, 011-327 reads again)" | "a busy store is read again, no stack"; and "a store busy at the deadline's read ends the wait with why, after the full busy timeout" |
| same | "asks the daemon on the fifth read, and goes on while it answers" | "reads the daemon's presence at every read, and sends no ping while it heartbeats" |
| same | checkpoint "stopped: the fifth read's ping finds no daemon" | "squeal stop: the wait ends at its next read and names the stop"; "a handoff is waited through to its bound"; "a daemon that died is found once its heartbeat's grace and WAIT_DOWN_MS passed" |
| same | group "a ping with no answer within the deadline is a busy daemon: it goes on (019-24)" | "a busy daemon: a lapsed heartbeat whose socket holds a daemon goes on" |
| same | group "stopped: the fifth read's ping finds no daemon" | "stopped: no daemon record at a read ends the wait there and names the stop" |
| same | (none) | lint group "stopped: squeal stop ends the wait at its next read and names it, read in the worktree's store" |
| same | "deadline at the deadline's read, though nothing is left to lint (accidental, 011-327)" | "ended at the deadline's read with nothing left to lint: the verdict" |
| `test/cli/wait/table.test.ts` | "stopped: the store did not open (accidental, 011-327)", checkpoint and group | "unopened: the store did not open, with why"; with "go on: a busy store before the deadline is read again" and "unopened: a busy store at the deadline's read, with why", each wait |
| same | "stopped: the fifth read's ping found no daemon", each wait; "go on: the ping on the fifth read was answered"; "go on: a ping with no answer within the deadline …", group and lint | "stopped: the wait view found …" (cleared record, handoff, dead socket); "go on: a lapsed heartbeat …"; "go on: the worktree's store unread proves nothing of the daemon" (lint) |
| same | "… asks the daemon on the fifth read only", each wait | "… reads the daemon at every read that goes on" |
| same | "deadline beats ended at the deadline's read: no verdict (accidental, 011-327)" | "ended beats deadline at the deadline's read: the verdict, as a test group" |
| `test/cli/wait/lines.test.ts` | the stopped rows, the lead alone | the lead with `(<reason>)`; new rows for `unopened`, a handoff, and the busy-daemon request lines |
| `test/cli/wait/first-request.test.ts` | (new file) | four command rows: `run --all` and `run --slow`, with and without `--wait`, on a daemon that holds the request |
| `test/cli/wait/lint-loop.test.ts` | (new file; the lint group's loop rows moved here from `run-loop.test.ts`, unchanged) | review 0.1.474 B1: "a busy lint store is read again: released at the first pause, the next read gives the verdict"; "a lint store busy through the deadline: the deadline's read ends the wait with why"; "a damaged lint store still ends the wait as unread" |
| `test/cli/wait/table.test.ts` | (none) | "go on: a busy lint store before the deadline is read again"; "unopened: a lint store busy at the deadline's read, with why"; the lint group's outcome set gains `unopened` |
| `test/cli/wait/lines.test.ts` | (none) | "unopened: the lint store busy at the deadline's read" |

## Decisions the record did not settle, and my choice

1. **A store that does not open ends the wait at any read**, not only at the first. `waitForStatus` skips every failure after its first read until the deadline's read. A bare `run … --wait` has no deadline, so a skipped missing store would wait forever. Only a busy read is read again.
2. **A store busy at the deadline's read** ends as `unopened` with the busy reason, exit 3. The run waits have no verdict without a read. `status --wait` ends the same read as `unavailable`, exit 1.
3. **`late` on a busy read** is whether the deadline had passed when the read began, as `waitForStatus`'s `final`: the read's busy timeout was chosen from it. Otherwise a busy read bounded by what is left would always end late and never get the full timeout at the deadline's read.
4. **No settle time.** `waitForStatus` never ends on no daemon before 750 ms (`STATUS_WAIT_SETTLE_MS`), for a daemon a hook just spawned. A run wait starts after the daemon answered its request, so the record is there; a `squeal stop` before the first read ends it at that read.
5. **The lint group's presence read.** The lint group reads the lint store, not the worktree's. Its `GONE` rule reads presence in a read of the worktree's store of its own, bounded as the other reads (`presenceRead`). A worktree store that does not open there proves nothing: `unread`, and the wait goes on.
6. **The lint store's busy read (repaired after review 0.1.474 B1).** The first candidate left a busy lint store ending the wait as `unread` after about 1 s, because `withLint` reports a busy store and a damaged row alike as `failed`. The repair needs no `src/core` change: the lint read opens the store itself through `lintStoreSource(commonDir, root, { busyTimeoutMs })` with `readBound`'s timeout, runs the counts, closes it, and tells a busy error with `isBusy` (`src/core/store/connection.ts`) at the open and in the read. A busy read is `counts: "busy"`: read again before the deadline, and at the deadline's read the wait ends as `unopened` with why, exit 3. Any other failure stays `unread`, so a damaged row is never read again forever. One attempt per read, with SQLite's busy handler waiting the bound; `withStatusStore` also tries again within the bound for a store that answers busy at once (row 011-113). The lint read does not: before the deadline the next read comes a second later, and only the deadline's read could end early that way. A busy read's `late` is whether the deadline had passed when it began (decision 3); the read loop now keeps a field a read already gave, so the row's `late` read does not replace it.
7. **The stopped line** keeps its lead (`the daemon stopped before …`) and names why in parentheses with `noDaemonText`. The liveness it reads is built from the same store read as the wait view (`worktreeLiveness` with the stopping reading), not from a second status read: `noDaemonText` reads only the state, the time since and a handoff's successor.
8. **A handoff with the record cleared, past its claim's bound,** reads `stopped`, not `handoff`: presence's `stoppingOf` reads a cleared record's claim only before its bound. The `handoff` reason is a recorded stopping daemon past its bound. This is presence's rule; the row does not change it.
9. **The watch is a port** (`WaitPorts.watch`, production `watchDaemon` as `waitForStatus` builds it). The cleared-record and handoff rows run the real `watchDaemon`. The stale-heartbeat rows (died, busy) use `presenceWatch` in `test/cli/wait/fixture.ts`, presence's own `waitView` with a socket state the row sets: `watchDaemon` asks the socket in the background, and a stepped clock does not wait for that answer.
10. **`run --slow`, a status request with no answer,** takes the pending path (exit 0 without `--wait`, 3 with), not the failure path (exit 1): the request may still be taken.
11. **Cells removed, not set.** The `socket` cells were removed once every row read `deadline` (decision 3: a cell exists only for a difference). `PING_POLLS` and the record's `poll` went with the ping.
12. **`holds` is a table of predicates** (`HOLDS` in `decide.ts`). Each new condition raised the switch's complexity (27, then 28); the table is 1, and each predicate is one line.
13. **`inStore` stays for the reads beside the waits** (`run.ts` `filesText`, `owedText`, `joinedCheckpoint`; `group-pending.ts`), and still throws on a busy store there. They are not the waits' reads; changing them is a user-visible change beyond the four cells. Named here.

## Type changes

- `wait/table.ts`. Removed: `SocketBound`, `RunWaitRow.socket`, `RequestRow.socket`, `PING_POLLS`, `WaitRecord.poll`, the conditions `ping due` and `no daemon`. Added: the conditions `store busy` and `daemon down`; `ReadField` `unavailable`; `WaitRecord.store` `busy`; `WaitRecord.unavailable`; `DaemonReading`, `DaemonDown`, `UnopenedOutcome`; `unopened` in `CheckpointOutcome` and `GroupOutcome`; `Rule.then` `go on`; `PayloadField` `unavailable` and `daemon`. Changed: `WaitRecord.daemon` is a `DaemonReading` (was `answered`, `none` or `unanswered`); each wait's `stopped` outcome carries `daemon: DaemonDown`; `FIELD_OF` maps to `ReadField` only.
- `wait/socket.ts`: `WaitPorts.watch`, a new required member, in `REAL_PORTS`.
- `wait/reads.ts`: `waitReads(ask, ports)` (was `(ask, now)`); `StoreField` now has `daemon` and not `unavailable`; new `unavailableText`.
- `wait/presence.ts` (new): `readBound`, `presenceOf`, `presenceRead`, `stoppedText`.
- `run.ts`: new exports `recordedOf` and `Recorded`; private `requestRunAll`.
- `run-slow.ts`: new exports `pendingText` (it takes a `Pending`) and `Pending`.
- `run-lint-group.ts`: `lintGroupVerdictLine(outcome, group, command)`, a new parameter; it words `unopened` (review 0.1.474 B1).
- Review 0.1.474 B1: the condition `lint busy`; `WaitRecord.counts` may be `busy`; `LintGroupOutcome` has `UnopenedOutcome`. In `wait/reads.ts` the private `lintCounts` became `lintRead` (it returns the record's fields) and `countsIn`.
- `status-wait-lines.ts`: `noDaemonText` exported; its body unchanged.

## For the next worker

- **011-328.** `WaitFiles` is still the seam; `ownOf` and `laneFiles` still guess a request's files.
- **status-waits-join.** The run waits now share the status waits' store read (`withStatusStore` with `readBound`) and daemon watch (`watchDaemon` through `WaitPorts.watch`). What still differs: the settle time, the status waits' skipping of a later non-busy store failure, and the `unavailable` exit 1 against the run waits' `unopened` exit 3 (decisions 1, 2 and 4).
- **Bundles.** This row changes CLI code, so the committed plugin bundles differ from the build; the coordinator rebuilds them on the candidate, as for 011-326.
