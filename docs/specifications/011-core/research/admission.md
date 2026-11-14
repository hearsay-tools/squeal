# Admission: one answer to "may a tier start in this lane now, one file or several"

Design brief from the architecture review of 2026-11-12 (Cezar task af6c0b3f, report artifact d8b46fe2, card 5). Rechecked on main at `cda899453` on 2026-11-14 by design session b711eb60. Terms: `GLOSSARY.md` (Start facts, Admission, Lane, Request intake). The decisions below are the human's, taken one at a time on 2026-11-14. Rows 011-340 to 011-342. Approved row 011-321 runs in the same lane as a separate row.

## Problem

Before a tier starts, the scheduler checks about seven facts:
- the daemon stops, or its runtime folder went;
- a merge hold or a command hold holds;
- it waits for an install, or the install went;
- runner work is pending;
- the lane's own rules: one tier per group, the groups named in `after` go first, an edit's work goes first;
- for a slow lane, whether it takes one file or several.

Each path that starts a tier, or reports whether work is left, reads these facts in its own shape (read in source code at `cda899453`):

| Path | Where | What it reads |
|---|---|---|
| The pump, before the lock | `scheduler.ts` `#pump` 1008-1038 | halted; install wait or reinstalled; a free lane or a lane that may start (`#freeLaneQueued`, `#someLaneMayStart`); the install stamp (I/O); the runtime folder (I/O); the hold check (I/O, may reconcile released paths) |
| The pump, under the lock | 1040-1048 | halted, install wait, reinstalled; on hold; install missing; runner work |
| The group lanes | `#groupLanesNext` 1448, `#laneMayStart` 1422 | halted; nothing in flight, or queued and no tier of the group in flight, and no edit's work when the group follows `tests` |
| A slow lane, after its waits | `slow-tier.ts` `#mayStart` 357 | the runtime folder (I/O), preemptions, the hold check (I/O) |
| A slow lane, under the lock | `#select` 643 | halted, held, `#waitsForAfter`; width `!low \|\| normalIdle()` |
| A slow lane, before its slot | `#want` 370 | width `normal \|\| (guard.idle && normalIdle())` |
| A slow lane, listing and publishing | `#candidates` 518, 782 | `#waitsForAfter` |
| The import re-walk | `#queueRewalk` 945 | halted; the default slow lane's stored activity is "waiting" |
| Re-arming the pump | `#hasWork` 1375 | install wait, reinstalled; on hold (runner work only) |
| Status answers | `inUse` 774, `slowPending` 807, `owedWork` 840, `slowWaiting` 861 | on hold |
| Cuts and slow ends | `#cutTiers` 509, `#slowEnded` 1207 | on hold |

About 30 reads of these facts in all. `SlowHost` passes them to each slow lane as 12 callbacks (`slow-tier.ts:47-91`).

**What card 2 changed.** The request intake (rows 011-322 to 011-325) took 6 of the 9 copies of the install-wait check out of `scheduler.ts`. All 6 were in requests, which answer whether a request is taken. The paths that start a tier did not change.

**Defects by cause.** Counted from every review file and the fix commits, read in source:

| | Since 2026-10-20 | Since 2026-11-04 |
|---|---|---|
| Review blockers where the start rule was wrong | 9, in 9 FAIL rounds, 2 of them failed on this alone | 3 |
| Of those, in this card's scope | 6 | 1: 019 `reviews/0.1.398.md` B2, `after` counted queued files no commit asked for |
| Fix commits that added a start check to one more path | 6 | 3 (`ff9912603` and `f732f87f4`, one rule in two places on one day; `ba04bbde2`) |

The most common cause: a fact checked before a wait and not again after it. It caused 3 blockers:
- 004 `reviews/wave-1.md` B1, the idle trigger;
- 011 `reviews/0.1.262.md` B3, the runtime folder;
- 011 `reviews/0.1.269.md` B1, the command hold.

The last was on 2026-10-23. Outside this card's scope:
- 011 `reviews/0.1.413.md` B1, the fast batch's width (card 6);
- 019 `reviews/0.1.396.md` B1, the order the pump asks the lanes in (card 7);
- 021 `reviews/0.1.445.md` B1, the remote lane (card 10).

Spec 016 `research/core-defects.md` lists a group "scheduler, path" with 6 FAIL rounds. 7 of its 8 items are about saving a run's results, which card 1 moved (rows 011-319, 011-320). Only R373 (`0.1.269.md` B1) is start admission.

A single admission answer is expected to prevent few defects: 1 in-scope blocker in the last ten days. Its main value is as the base for cards 6 and 7, and its table test makes "check again after the wait" one row.

**Differences between the copies** (read in source code; not run):

| # | Difference | Today | After |
|---|---|---|---|
| 1 | A configured group whose `after` does not name `tests` reads no runner work in `#select`. Only `editPending` covers runner work, and only for groups that follow `tests`. The pump never selects a tier while runner work is pending ("its keys would come from a revision the runner has not invalidated yet"). | A batch that queues runner work between the lane's listing and its selection may let such a group start a tier at keys the runner has not refined yet. Plausible; not verified. | 011-341: a test first; if it holds, no lane starts while runner work is pending |
| 2 | `#queueRewalk` reads only the default `slow` group's stored activity. Other groups publish under their own key (`publishGroupActivity`). | The import re-walk takes a chunk while a configured group's file waits for its slot or the load guard. | 011-342: a test first; if it holds, the re-walk gives way to every lane's waiting files |
| 3 | The width is written twice: `#want` (`normal \|\| (guard.idle && normalIdle())`) and `#select` (`!low \|\| normalIdle()`). | Same answer today: the slot's permits already carry `#want`'s answer. | 011-340: written once |

## Decisions (the human, 2026-11-14)

1. **Scope: a small card** ("Card 5: A: small card"). One module answers, for each lane: may a tier start, one file or several, and if not, why. The pump, the slow lanes, the import re-walk and the status answers act on it. The first row changes nothing a user sees. Then one row for each difference a test proves.
   - Rejected: stop the card and leave the facts to card 7 (card 7 grows; the differences stay unexamined); the full card from the review, with the fast batches' width and the result recording (card 6 owns the fast width; card 1 owns recording).
2. **Shape: one stamped answer for all lanes** ("Shape: B: one stamped answer"). Three interfaces were designed in parallel (design-it-twice, 2026-11-14):
   - one call by kind of caller;
   - one answer for all lanes;
   - a gate that reads the facts again itself after every wait.
   All three agreed on a pure rule over facts in memory, a separate step for the reads from disk and Git, a smaller `SlowHost`, the width written once, and the differences pinned in the move row. The chosen shape:
   - one pure call takes the start facts and returns the admission of every lane: whether anything may start, which lanes the pump asks, each lane's answer and width, and the flags the status answers read;
   - each answer carries the lock turn it was read in. Starting a tier with an answer from an earlier turn throws, so a fact read before a wait cannot start a tier after it.
   - Rejected: one call by kind of caller (the module names its callers; only a code check guards a stale answer); the gate (wrapped snapshots, special typing and the lock inside the rule module, which card 7 would partly undo; more machinery than 3 blockers in a month justify).

## Agreed with sibling designs

- **Card 4** (one owner for the daemon's progress records, task 6f1379b9, reply of 2026-11-14): card 4 owns the stored install-wait row and the install command row: keys, formats, and what a missing value means. `install.ts` still decides when to write them. `#awaitingInstall` and `#reinstalled` stay in the scheduler's memory, and admission reads them there as two start facts. Admission never writes the row. No card 4 row touches `scheduler.ts`, `slow-tier.ts` or `record.ts`.
- **Card 2** (request intake, done): the intake keeps its own install-wait answer, which says whether a request is taken. Admission says whether a tier starts. Both read the same two memory fields, and neither calls the other.

## Coordinator's calls (repo-local; the human may overturn)

- **Location.** `src/core/scheduler/admission.ts`, pure, with the start facts type and the reason set. One entry file, no barrel (row 015-110). The scheduler builds the facts in one synchronous method, `#facts()`, from memory only.
- **The interface.** `admit(facts): Admission`. Total and synchronous: no I/O, no timers, no store writes, never throws. `Admission` holds:
  - `halt`: why no lane starts, or `null`;
  - `any`: the pump's check before the lock (`scheduler.ts:1017`);
  - `fast`: the fast lanes' answer (`runner-work` or start);
  - `ask`: the group lanes the pump asks, in `GroupTiers.lanes` order (today's `#laneMayStart`);
  - `lane(group, load)`: a group lane's answer, with `width: "one" | "wide"` and its reason (`after-tests`, `after-group` with the group it waits for, `lane-busy`, `nothing-queued`, or a halt reason);
  - `rewalk`: the import re-walk's answer;
  - `quiet`: the status answers' gate;
  - `editPending`, `fastIdle`, `normalIdle` and `hasWork`.
  The reasons form a closed union in one fixed order, the pump's order under the lock today: stopping, runtime gone, not started, install wait, reinstalled, held, install missing, runner work, then the lane's own rules.
- **The stamp.** `Mutex` counts its turns. `admit`'s caller passes the current turn into the facts, and the answer carries it. The pump's `#fly` and the slow lane's launch check it against the lock's current turn. A mismatch throws an `Error` naming the lane and both turns, which stops the pump with a note as any tier error does. With today's code it never fires.
- **Reads from disk and Git.** One `#probe()` in the scheduler, shared by the pump and the slow lanes. It reads the runtime folder, then the hold check, which may reconcile released paths, in today's order. It writes what it finds into memory and returns `"gone" | "held" | "released" | "free"`. The install stamp check and its effects (`refreshInstall`, `#reinstall`) stay in the pump; `#installMissing` becomes one memory fact.
- **`SlowHost`** loses `halted`, `held`, `holdCheck`, `runtimeMissing`, `editPending`, `fastIdle`, `normalIdle` and `groupHolds`. It gains `probe()` and `admit()`. It keeps `lock`, `started`, `ready`, `closed` and `pump`. The slow lane's `#mayStart` becomes the probe plus the preemption count. `#select` acts only on an `admit()` read in its own lock block.
- **What stays in the slow lane:** triggers and moments, claims, the load guard and its budget, the slot, the pool grant, preemptions, and the explicit-request exception (a `run --slow` request or a narrow run's ask skips the guard and the grant, rows 004-59 and 019-49). These depend on time, the slot or the pool, not on the start facts. The load guard's `idle` enters `lane(group, load)` as an argument.
- **Costly facts.** `holdsFollowers` (per group) and the stored slow activity are read lazily, at most once per answer, so the cost and evaluation order stay as today: `holdsFollowers` only when `fastIdle` is true.
- **011-340 preserves today's behaviour exactly.** Differences 1 and 2 are table rows that pin today's answers, each marked with the row that changes it. The re-walk's halted check also runs inside its lock block, as today. A path whose order the answer cannot hold without a change is reported in the notes before it is changed.
- **The remote lane (card 10).** The facts' lane entries carry `kind: "local"`. A remote kind and its reasons come later; the closed union makes the compiler list every reader.
- **Tests: replace, don't layer.**
  - **New table** (`test/scheduler/admission.test.ts`, pure, a `facts(overrides)` builder, no scheduler, store or timer):
    - each halt reason, and their order;
    - runner work for the fast lanes;
    - with nothing in flight, every lane is asked;
    - a group in flight;
    - `after: [tests]` with an edit pending, with a backlog and no request, and with a request open;
    - `after: [lint]` while lint holds, and while lint holds only files no commit asked for (row 019-26);
    - width: normal, low with idle load and no normal work, low under load, low while a normal group holds, low beside an unasked `commit` group's file (row 019-27);
    - the re-walk with the default slow lane waiting;
    - `hasWork` on hold;
    - `quiet` while stopping but not closed;
    - differences 1 and 2 pinned.
  - **New stamp test:** an answer read in one lock turn and acted on in the next throws.
  - **Deleted** once the table covers their cases: the rule-only cases of `test/scheduler/group-lanes-width.test.ts` and `slow-width.test.ts` that only vary the facts and check the width. The worker names each case in the notes.
  - **Stay:** every test that drives a real scheduler through a wait or a race. These are `runtime-gone-slow`, `runtime-gone-tier`, `command-hold-slow`, `command-hold`, `merge-hold*`, `install-wait`, `reinstall`, `in-use`, `slow-waiting`, `commit-group-after`, `group-lanes-*` (less the deleted cases), `import-rewalk*` and `tier-holds`. They prove that nothing a user sees changed. The worker lists the cases the table repeats; removing them is a later quality row.
- **Key format.** Unchanged. Admission decides when a tier starts, never a key. `test/keys/key-format.test.ts` passes without a version raise.

## Not in scope

- What a run's result may store, and the record's reads of the hold, the runtime and the install (`record.ts`): card 1's run evidence module. The focused record's missing merge-hold read, noted by the review's explorer, is a question for that module, not a start rule.
- The fast tiers' width, the batch's grant and the CPU pool (`selectTier`, `context.capacity`): card 6, which consumes `lane().width`. Spec 021 D18's per-machine budget.
- The order in which the pump asks the lanes, and the scheduler's decisions as one step: card 7, which calls `admit` inside it.
- The remote lane's admission: card 10, after spec 021's measurement on 2026-11-19.
- Whether a request is taken: card 2's intake.
- The stored install-wait row: card 4.

## Rows (spec 011; approved by the human, 2026-11-14, "Rows: Approve, land, start")

1. **011-340, one admission answer, behaviour preserved.** Done when:
   - no path in `scheduler.ts` or `slow-tier.ts` reads `#halted`, `#onHold`, `#awaitingInstall`, `#reinstalled`, `#runtimeGone`, the runner work's size, `#editPending`, `#fastIdle`, `#normalIdle` or `#groupHolds` to decide a start, a re-arm or a status answer, except `#facts()` and `#probe()` (the notes give the grep);
   - `SlowHost` has the members above;
   - the width is written once;
   - the table and the stamp test pass;
   - the scheduler's existing tests pass unchanged, less the deleted cases, each named;
   - no answer, status payload, note text, CLI output or key changes.
2. **011-341, no lane starts while runner work is pending.** After 011-340.
   - A test first: a configured group with `after: []` and a queued file; a batch queues runner work after the lane listed its files and before its selection. The test shows whether the group's tier starts before the runner work is applied.
   - If it does, done when the admission refuses every lane with `runner-work` while runner work is pending, the pinned table row flips, and the test passes. A dated line in spec 019 `status.md` says D3's "groups that follow no `tests` start beside fast work" means beside fast tiers, not before pending runner work.
   - If it does not, the notes say why, and the table row records it.
3. **011-342, the import re-walk gives way to every lane's waiting files.** After 011-340.
   - A test first: a configured group's file waits for its slot or the load guard while the re-walk has a chunk left. The test shows whether the chunk is queued.
   - If it is, done when the re-walk reads every lane's waiting activity, the pinned table row flips, and the test passes.

Row 011-321 (the key alarm reaches the run evidence module) is approved already (the human, 2026-11-12) and joins this lane (the human, 2026-11-14). It shares no file with these rows.

## Process

This is product code in `src/`. A coordinator for spec 011 runs the rows. Each candidate needs a passing review before main (`docs/process.md` steps 5 and 6).
- 011-340 first, one worker.
- 011-341 and 011-342 after it; both are small, so one worker can take both in one candidate.
- 011-321 can run beside 011-340: its files are `test/keys/validity/entries/` and the run evidence module's tests, not the scheduler.

Workers run `claude` `opus` at medium effort (high for 011-340). Reviewers run `codex` `gpt-6.1-sol` `high` (the human, 2026-11-14).

Collisions:
- **Card 4** (task 6f1379b9): its row 011-339 (`research/progress-records.md`, approved 2026-11-14) edits `install.ts`, `ledger.ts`, `refine-apply.ts`, `bootstrap.ts`, `checkpoints.ts`, `head-move.ts`, `rekeyed-moves.ts` and new files beside them. It shares no file with these rows; a shared file goes to whichever lands second.
- **Cards 6 and 7** follow in `scheduler.ts`, `slow-tier.ts` and `tiers.ts`, and start after 011-340 lands.
- **Spec 021's coordinator** is told before dispatch: its remote lane reads none of these files today, and card 10 uses the lane kind seam.
