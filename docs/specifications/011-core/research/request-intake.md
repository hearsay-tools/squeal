# Request intake: one place where the scheduler takes a request

Design brief from the architecture review of 2026-11-12 (Cezar task af6c0b3f, report artifact d8b46fe2, card 2), rechecked on main at `c601627a6` (0.1.467) on 2026-11-13 by design session b3f9b586. Terms: `GLOSSARY.md` (Request, Request intake, Covered files). The decisions below are the human's, taken one at a time on 2026-11-13. Rows 011-322 to 011-325.

## Problem

A daemon takes a request in seven methods of `src/core/scheduler/scheduler.ts`: `requestFullSuite` (639-707), `requestSlowSuite` and `requestGroup` (717-766, a lint group at 733-745), `requestGroupPaths` (777-821), `requestRetries` (824-837, `#takeRetries` 844-846), `promote` (855-864), `focus` (873-888) and `refreshObserved` (901-910). Each applies the rules all requests share in its own shape (read in source code at `c601627a6`; the file is unchanged since `9fc1a9bc7`, 2026-11-11):

| Rule | `run --all` | `run <group>` | `run <group> <path>` | `retry` | promote, focus | import (`refreshObserved`) |
|---|---|---|---|---|---|---|
| Start, closed | `#started` throws | `#started` throws | `#started` throws | `#closed`: nothing | `#closed`: nothing | `#closed`: `false` |
| Install wait | a pass that may end it, then an abandoned checkpoint | `queued: 0` | a reason in the answer | nothing | none (writes no store) | `false` |
| Runner work it waits for | when pending, with runner recovery | none | always (`selectNarrow`) | none | none | queued after |
| Busy-store retry (`#request` + `#transact`, spec 021 D2) | 4 stages | yes; lint release outside | the stage | yes | no write | the imports-waiting write outside |
| Progress record (`#requests.ask`, row 018-12) | its checkpoint's files | the group's files | the selection | in `#takeRetries` | none | none |
| Wake lanes, cut tiers | all lanes, before the lock | its lane's `request()` | its lane's `preempt()` | none | `#cutTiers` | none |
| Start work | `#pump` | `#pump` | `#pump` | `#pump` | `#pump` | `#pump` |

A rule then reaches one path, and a review finds the others. Review blockers since 2026-11-04 where one request path skipped a rule, or a request's answer or progress record was not what it decided:

| Review | Blocker | Rule |
|---|---|---|
| 018 `reviews/wave-3.6.md` B1 | A fast-lane request joined to a baseline recorded the baseline's slow files as its own; the daemon stayed awake for them | progress record |
| 018 `reviews/wave-3.6.md` B3 | The retry's progress record existed only in `requestRetries`; the start and reconciliation paths that take stored retries skipped it | progress record |
| 021 `reviews/0.1.434.md` B2 | Socket requests' writes ran outside the busy-store retry | busy-store retry |
| 021 `reviews/0.1.434.md` re-review B2 | `run --all`'s runner recovery still wrote outside it; after this second FAIL the chain went to the human (process step 6) | busy-store retry |
| 019 `reviews/0.1.411.md` B2 | A narrow run's answer was read as "current" by the CLI; fixed by `a45ae2179`, which classifies in the scheduler | answer |

Five blockers in three reviews. Five fix commits added the busy-store retry one path at a time: `9f6623beb`, `9fc1a9bc7`, `7fc5d4f7b`, `1ad5df20c`, `52bcd4126` (the last two are pass and baseline writes, not requests). This is spec 016 `research/core-defects.md`'s mechanism "a path that skips a rule" (6 FAIL rounds in the scheduler), whose best catch is a single owner for the rule.

The tests repeat the same races per request (test inventory, read in source code): the lock-holder race in 6 cases in 3 files (`test/scheduler/busy-requests.test.ts:71,93,111`, `test/daemon/busy-requests.test.ts:71,86`, `test/daemon/busy-writes.test.ts:60`); the held-baseline progress setup in 8 cases in 3 files (`test/scheduler/request-progress.test.ts:98,111,121,134,147`, `request-progress-forced.test.ts:43`, `request-progress-retry.test.ts:19,37`). The install wait is tested through `run --all` only (`install-wait.test.ts:230`, `reinstall.test.ts:159,200,272`); no test covers it for a group, a narrow run, a retry or an import.

## Decisions (the human, 2026-11-13)

1. **Scope: the scheduler's side now, the bridge later** ("C: scheduler now, bridge later"). One request intake inside the scheduler takes every request. The daemon's request bridge (`types/daemon.ts`, `protocol.ts`, `handlers.ts`, `front-desk.ts`, `desk-messages.ts`, `desk.ts`, and the `#loop === null || #phase === "stopping"` guard written 9 times in `daemon.ts`) becomes a separate proposed row. Its record: the two newest requests each touched 7 or 8 of these files; 2 blockers in one review (021 `reviews/0.1.450.md` B1, the 32 MiB line limit reached `write` but not `keep`; B2, a lost answer); one drifted copy (`String(error)` against `error.message`).
   - Rejected: the scheduler side only, with no bridge row; both together (twice the work, a second worker, spec 021's files, one large review).
2. **Move first, then one row per fix** ("A: move, then each fix"). Row 011-322 moves every request into the intake and changes nothing a user sees. Rows 011-323 and 011-324 each change one behaviour. Row 011-325 records covered files for the waits (card 3).
   - Rejected: move and fixes in one row (one review cannot tell a move mistake from an intended change); the move only, fixes proposed for later.
3. **Shape: one entry point, every rule on by default** ("Shapes 1 and 3 together"). From three read-only designs (minimal entry point; a request as a plan of data; every rule on by default):
   - A request reaches the intake through one entry point. It states what it queues and what it answers, its install-wait answer, and its covered files. The intake applies every other rule in one fixed order: the start or closed answer, the install-wait answer, the runner work the request waits for, the store write in one transaction tried again while the store is busy, the progress record of its covered files after the commit, waking the lanes, starting work.
   - Leaving out the install-wait answer or the covered files does not compile. A request skips a rule only by a named reason in its declaration, which a reviewer can search for (for example "writes no store" for promote and focus).
   - Rejected: a request as a plan of data (the largest first move, 7 files; several stages read the store or ask the runner while deciding, so "nothing changed" is hard to prove; its direction stays open for card 7); the minimal entry point alone (a request could leave out its covered files without a word, the mistake of wave-3.6 B1).

## The differences between request paths

Read in source code on 2026-11-13; not run.

| # | Difference | Today | After |
|---|---|---|---|
| 1 | An import's waiting mark (`markImportsWaiting`, row 018-28) is written outside the busy-store retry; spec 021 D2 lists CI import among retried writes | On a busy store it fails after one 5 s wait; `squeal import` ignores the error (`src/cli/import.ts:224`); the daemon takes the import at its next pass instead of at once, and status does not name the import it waits for | 011-323: inside the retry |
| 2 | `squeal retry` is the only request that queues work and wakes no lane | A retried slow-lane file may wait for the slow lane's next planning round. Not verified | 011-323: a test first; if it holds, the retry wakes the lanes of the files it queued |
| 3 | `squeal run <group>` while no dependencies are installed: the scheduler answers `queued: 0` | It prints "No test files of group tests to run at revision N: the group has none or all are current." and exits 0. Both claims are false. `squeal run <group> <path>` says "no dependencies are installed in this worktree" | 011-324: the group answer carries the reason; the receipt says it |

Kept as they are (coordinator's calls below): promote and focus take no install-wait answer; a lint group's release writes its own lint store outside the retry; `run --all` wakes the lanes before it takes the scheduler's lock.

## Coordinator's calls (repo-local; the human may overturn)

- **Location.** A module under `src/core/scheduler/` named for the term, with one entry file (no barrel, row 015-110). `#transact` and `#request` move into it. Each request's declaration sits beside the code that queues its files (`checkpoint-requests.ts`, `narrow-run.ts`, `retries.ts`, and so on); a group request's declaration sits in the intake's files, not beside `slow-tier.ts`'s `queueGroup` (coordinator 9ddca779, 2026-11-13: card 8 and the later scheduler cards edit `slow-tier.ts`). The scheduler's public request methods stay, as one-line calls into the intake, so `daemon.ts` and the bridge do not change.
- **011-322 preserves today's behaviour exactly, including the order quirks the designs found:**
  - a request without runner work takes the scheduler's lock again on each busy try (today's 671, 746, 827); a request with runner work holds it from that work through every try;
  - `run --all` wakes all lanes before it takes the lock (today's 669), as a named exception in its declaration: moving it after the transaction would widen the window in which a slow selection misses it (`slow-tier.ts:357`);
  - a group request marks its lane requested inside the stage, as today;
  - a failed request does not start work (no pump after a throw), as today;
  - `run --all` still waits for a pass delivered after the request (row 011-198) and runs the pass that may end an install wait first (review wave 11 B1).
  The worker reports any of these the fixed order cannot hold without a change, before changing it.
- **Retries.** Start and every reconciliation pass also take stored retries (`takeRetries`); their progress record stays where all three meet (wave-3.6 B3). The callback that records it becomes required, so no caller can leave it out. The retry request states its covered files through it.
- **Imports.** In 011-322 the import's observed refresh keeps its write outside the retry, as a named skip that cites row 011-323. The lifecycle's refresh that writes nothing (`daemon.ts:416`) stays a synchronous call with a named reason; its boolean answer does not change.
- **The pump is opaque to the intake.** The intake ends by waking lanes and starting work. It does not read or change the pump's admission checks or tier selection (cards 5 and 6). Card 5 may later replace "wake these lanes" with "these facts changed"; card 7 may take the intake's answer and the lanes to wake as data. That is the seam the later scheduler cards use.
- **Tests: replace, don't layer.** The new test surface is one table at the intake's interface, with a probe request over a real store and a real ledger (the store is local-substitutable: a second connection holding `BEGIN IMMEDIATE` makes it busy, `test/helpers/busy-store.ts`):
  - busy store: the stage runs once, after the holder ends; busy at the daemon's stop answers with the operation named and records nothing;
  - install wait: each reason gives the request's install-wait answer; nothing is recorded or woken;
  - progress record: only the covered files the stage queued, after the commit; a stage that throws records nothing and leaves the ledger and store as they were;
  - stop: closed and not started;
  - order: record, then wake, then start work;
  - typecheck: a request without an install-wait answer or covered files does not compile (`@ts-expect-error`).
  Then:
  - deleted once the table covers their cases: `test/scheduler/busy-requests.test.ts:71` and `:93` (the per-request race), and the per-request registration cases of `request-progress.test.ts`, each named in the row's notes;
  - stay: the runner-recovery race (`busy-requests.test.ts:111`; its key writes run outside the stage), the wave-3.6 B1 regression (a fast-lane request joined to a baseline), `request-progress-forced.test.ts`, `request-progress-retry.test.ts` (start and pass paths), the daemon's socket tests (`test/daemon/busy-requests.test.ts`, `busy-writes.test.ts`: the bridge), and every test of what a request queues and answers (`checkpoints`, `run-lanes`, `narrow-run`, `retry*`, `promotion`, `focused*`, `slow-tier`, `group-lanes-*`, `commit-lint`, `manual-lint`, `observed-growth`);
  - `install-wait.test.ts` and `reinstall.test.ts` stay in 011-322 as proof that `run --all` did not move. The worker lists which existing tests the table repeats; removing those is a later quality row.
- **Covered files (011-325).** A store record keyed by a request id, read by the wait; `run --all` keeps its checkpoint record (`testFiles`) and adds what it lacks. The socket answer carries the record's id, not the list: a group of 1,700 test files is about 100 KB, over the 64 KiB line limit of a request's answer (`protocol.ts:12`; review 0.1.450 B1). The narrow run's answer keeps its `selected` list. Agreed with card 3 (task c86019be) on 2026-11-13, with its five conditions:
  1. written in the same transaction that queues the files, so one read sees both;
  2. read through one reader function under `src/core` that returns the decided set by id (queued, already current, not queued with the reason); no CLI code parses the row;
  3. kept while any of its files is queued or running, and at least 10 minutes after; older records are pruned when the worktree writes a new one (a bare `--wait` has no deadline);
  4. an answer without the id (an older daemon) leaves the wait on today's guess, so mixed versions work;
  5. it survives a daemon handoff (it is in the store).
  This row records; card 3's row switches its wait from today's guesses (`src/cli/run-lanes.ts:52` `laneFiles`, `src/cli/run-group-wait.ts:143` `ownOf`) to the record, for `run <group>` and a one-lane checkpoint. `run --slow`'s record is read only once the status waits move, which the human decides later.

## Not in scope

- The daemon's request bridge: proposed row `request-bridge`, below.
- The pump's admission checks, tier selection and the scheduler's decisions as one step (review cards 5, 6 and 7).
- The CLI's wait loops and the switch of `--wait` to covered files (card 3).
- The progress tracker's own end events (`request-progress.ts`, wave-3.6 B2).
- A lint group's release outside the retry (its own store; spec 021 D2 does not list it).
- Edits and reconciliation passes: they are not requests.
- Any change to a key, the store format or a request's response type in 011-322.

## Rows (spec 011; approved by the human, 2026-11-13, "Approve, land, start")

1. **011-322, one request intake, behaviour preserved.** Every request goes through it. Done when: no request method of the scheduler calls `#transact`, `#request`, `#requests.ask`, `#groups.preempt`, `#cutTiers` or `#pump` itself; each skipped rule is a named reason in that request's declaration; a request without an install-wait answer or covered files fails typecheck; the intake's table covers busy store, install wait, progress record, stop and order with a probe request; the scheduler's and the daemon's existing request tests pass unchanged, less the cases the table replaced, each named in the notes; no answer, response type, CLI output or key changes.
2. **011-323, the shared rules reach every request.** After 011-322. Done when: an import's waiting mark is written inside the busy-store retry, and with a second connection holding the write lock, `squeal import` into a running daemon re-keys once the holder ends and status names the import meanwhile; a test shows whether a `squeal retry` of a slow-lane file waits for the slow lane's next planning; if it does, the retry wakes the lanes of the files it queued; the named skips for both are gone.
3. **011-324, `squeal run <group>` names the install wait.** After 011-322. Done when: while no dependencies are installed, `squeal run <group>` prints the narrow run's reason, "no dependencies are installed in this worktree", and not "the group has none or all are current"; the scheduler's group answer carries the reason, as one optional field on the daemon's answer that an older CLI ignores; the exit code is unchanged.
4. **011-325, the intake records each request's covered files.** After 011-322. Done when: each request's covered files are recorded as the scheduler decided them (queued, already current, not queued with the reason), keyed by a request id, in the transaction that queues them; one reader under `src/core` returns them by id; a record is kept while any of its files is queued or running and at least 10 minutes after; `run-all`, `run-group` and `run-slow` answers carry the record's id as one optional field, and a CLI that gets no id keeps today's guess; a table row per request shows its covered files, including a fast-lane request joined to a baseline (its own files only) and the install wait (not queued, with the reason). Card 3's row reads the record.

Proposed, separate (board row `request-bridge`, not approved): one table for the daemon's request bridge, so a new request type is one entry and the "is a scheduler running" guard is written once, with the measurement above.

## Process

This is product code in `src/`. A coordinator for spec 011 runs the four rows, one worker each. Each candidate needs a passing review before main (`docs/process.md` steps 5 and 6). Order and collisions:

- 011-322 first. 011-323, 011-324 and 011-325 after it; they share the intake's declarations, so the coordinator orders or splits their ownership.
- Card 3 (waits, task c86019be): its first row may move the request-taken loop out of `src/cli/run-group.ts` (`taken`, about line 164); 011-324 changes only `requestedText` there. Whichever lands second rebases. Its switch to covered files follows 011-325.
- Card 8 (runner traits, task 238ba474): edits the runner-trait lines of `tiers.ts`, `slots.ts`, `slow-tier.ts`, `revision.ts`, `omitted-test-files.ts` and `focused.ts`, not the request methods. `focus` calls `mayFocus` from `focused.ts`; no line is shared.
- Cards 5, 6 and 7 follow in `scheduler.ts`; they start after 011-322 lands.
- Spec 020's coordinator (31e1d860) is told before dispatch.
