# 011-340: one admission answer, behaviour preserved (worker notes)

Worker 29e1f6d0, wave 92 W1, 2026-11-14. Design: `research/admission.md`. Branch `cez/29e1f6d0`, base `64cbaa996`.

## What moved

- `src/core/scheduler/admission.ts` (new): `StartFacts`, `admit(facts): Admission`, `LaneAnswer`, `Refusal`, `HALT_REASONS`, `checkTurn`. Pure. `Admission` is a class with lazy getters: each costly fact (`holdsFollowers` per group, the stored slow activity, `queued` per group) and each derived flag (`editPending`, `fastIdle`, `normalIdle`) is read at most once per answer, and only when a member needs it.
- `src/core/scheduler/mutex.ts`: `Mutex.turn`, one per started task (a failed task counts).
- `scheduler.ts`: `#facts()` (memory only), `#probe()` (runtime folder, then the hold check), `#admit()`, and the `#installMissing` memory fact the pump sets after its install check.
- `slow-tier.ts`: `SlowHost` is `lock`, `started`, `ready`, `closed`, `pump`, `probe`, `admit`. `SlowRun` gains `turn`.

### Each moved read (file, function)

| Before | Now acts on |
|---|---|
| `scheduler.ts` `#pump` entry: `#halted()` | `admit().halted` |
| `#pump` loop guard: `#halted()` | `admit().halted` |
| `#pump` before the lock: `#awaitingInstall \|\| #reinstalled` | `admit().halts` has `install-wait` or `reinstalled` |
| `#pump` before the lock: `#inFlight.size > 0 && !#freeLaneQueued() && !#someLaneMayStart()` | `!admit().any` |
| `#pump`: `#runtimeMissing()`, then `#holdCheck()` | `#probe()`: `gone`, `held`, `released`, `free` |
| `#pump` under the lock: halted, install wait, reinstalled, `#onHold()`, `install.missing`, `#runnerWork.size` | `admit().fast`, read in the lock turn; `#fly` checks its turn |
| `#pump` after the selection: `#reinstalled` | `admit().halts.has("reinstalled")` |
| `#pump` finally: `#reinstalled`, `#runtimeGone` (which note), `#hasWork()`, `#halted()` (re-arm) | one `admit()` for the note; a second, after the note, for the re-arm |
| `#groupLanesNext`: `#halted()`, `#laneMayStart()` per lane | `admit()` per lane: `halted`, `asked(group)` |
| `#queueRewalk` before the lock: `#halted()` | `admit().halted` |
| `#queueRewalk` in the lock: `readSlowActivity(...)` | `admit().rewalk` (holds the halt too; see "Changed orders") |
| `#isIdle`: `#hasWork()` | `admit().hasWork` |
| `#cutTiers`: `#onHold()` | `admit().halts.has("held")` |
| `#slowEnded`: `#onHold()` | `admit().halts.has("held")` |
| `inUse`: `#closed`, `#onHold()`, `#editPending()` | `admit().quiet`, `.editPending` |
| `slowPending`, `owedWork`: `#closed`, `#onHold()` | `admit().quiet` |
| `slowWaiting`: `#closed`, `#onHold()`, `#editPending()`, `#fastIdle()` | `admit().quiet`, `.editPending`, `.fastIdle` |
| `slow-tier.ts` `#mayStart`: `host.runtimeMissing()`, `host.holdCheck()` | `host.probe()` and the preemption count |
| `#candidates`, `ended`: `#waitsForAfter` (`host.editPending`, `host.fastIdle`, `host.groupHolds`) | `host.admit().lane(group, load).waits` |
| `#select`: `host.halted()`, `host.held()`, `#waitsForAfter`, width `!low \|\| host.normalIdle()` | `host.admit().lane(group, load)`: `refusal`, `width`, read in the lock turn; the launch carries its turn |
| `#want`: width `normal \|\| (guard.idle && host.normalIdle())` | `host.admit().lane(group, load).width` |

Gone from `scheduler.ts`: `#halted`, `#onHold`, `#holdCheck` (in `#probe`), `#hasWork`, `#editPending`, `#fastIdle`, `#normalIdle`, `#groupHolds`, `#groupInFlight`, `#laneMayStart`, `#someLaneMayStart`. Gone from `slow-tier.ts`: `#waitsForAfter`, 8 `SlowHost` members.

The width is written once: `Admission#width` (`normal`, or `low` with the guard's `idle` and `normalIdle`). `#select` reads it with the guard's `idle` too: today's `!low || normalIdle()` gave the same answer, since the slot's permits already carried `#want`'s (difference 3).

## The done-when grep

```sh
grep -nE "#halted|#onHold|#awaitingInstall|#reinstalled|#runtimeGone|runnerWork\.size|#editPending|#fastIdle|#normalIdle|#groupHolds" \
  src/core/scheduler/scheduler.ts src/core/scheduler/slow-tier.ts
```

No hit in `slow-tier.ts`. Each hit in `scheduler.ts` at the last commit, and why it decides no start, re-arm or status answer:

| Line (read) | Where | Why it stays |
|---|---|---|
| `#awaitingInstall`, `#reinstalled`, `#runnerWork.size` | the request intake's host (`waiting`, `awaitingInstall`, `runnerPending`) | whether a request is taken: card 2's intake, out of scope |
| `#awaitingInstall`, `#reinstalled`, `#runtimeGone` | field declarations | |
| `#reinstalled` | `TierRecords` host (`reinstalled`) | the record's read, `record.ts`, out of scope (card 1) |
| `#awaitingInstall =` | `start` | writes the fact |
| `#reinstalled` (twice), `#awaitingInstall` (three times) | `#handleBatch` | whether a batch is taken, and the install wait's reconcile; no start |
| `#reinstalled` | after `#handleBatch` | which note to tell (`#tellReinstall`) |
| `#runnerWork.size` | `#adopt` | whether stored keys are adopted, not a start |
| `#reinstalled = true` | `#reinstall` | writes the fact |
| `#runtimeGone`, `#awaitingInstall`, `#reinstalled` | `#facts()` | the one memory read |
| `#runtimeGone` (three) | `#runtimeMissing` | `#probe`'s first step; the record also calls it (out of scope) |
| `#awaitingInstall` | `#close` | ends the stored wait; no start |
| `#runnerWork.size` | `#drain` | whether runner work is applied; no start |

`#facts()` reads the runner work as `work.size`, so the pattern does not list it.

## Changed orders (the coordinator, request 8f07ef96, 2026-11-14)

1. **Slow lane `#mayStart`.** Before: runtime stat, preemption count, hold check, preemption count. Now: `probe()` (runtime stat, then hold check), then the preemption count. The middle count goes, as the design says. Effect: after a preemption during the runtime stat, the hold check (an index stat; it may reconcile released paths) runs one pump turn earlier, with the same result. Covered by `command-hold-slow.test.ts` and the `merge-hold*` cases staying green; no new test (the coordinator's call).
2. **Re-walk.** The design says its halted check "also runs inside its lock block, as today". Corrected: today it ran before the lock only. Now `admit().rewalk`, read in the lock block, holds the halt too: a stop that begins between the check before the lock and the lock block queues no chunk. Before, the chunk was queued as runner work that no stopped pump applies, and `idle()` never resolved. Pinned by `test/scheduler/admission-rewalk.test.ts` (red before the move: `idle` false after 15 s; green after).

## Paths whose order the answer holds without a change

- The pump under the lock: `fast` is the first of `HALT_REASONS` (stopping, runtime gone, not started, install wait, reinstalled, held, install missing), then `runner-work`: today's order. `not-started` returns `null` where today `#started()` threw; it cannot happen there (the pump needs the ledger, and the lock block runs after `start` set the context).
- A lane under the lock (`LaneAnswer.refusal`): stopping, runtime gone, held, then `after`. A lane reads no install fact and no runner work, as today: the install facts were read by the pump before it asked the lane; the runner work is difference 1 (pinned).
- The status answers: `quiet` is `closed || held`, both before any work; the `!ledger` and `!context` guards stay in the callers (they type the reads, and are not start facts in the done-when). Where `#closed` moved after `!#ledger` the outcome is the same `false`/`null`.
- `#groupLanesNext` reads a new answer for each lane, since the lane before may have waited, as `#laneMayStart` read fresh facts today.
- The pump's finally reads a second answer after the reinstall note, since a daemon may close on it.

## Lazy facts: cost and order

`#facts()` reads eagerly only fields in memory: flags, the runner work's size, the tiers in flight, the policy's groups (cached `groupView`). Read when a member needs them: `editQueued` (`queue.hasFirstGroup`), `fastQueued`, `focused`, `freeLaneQueued` (only for `any`, only with tiers in flight), `lanes` (only for `any` and `ask`; it syncs `GroupTiers`, as `#someLaneMayStart` did), `queued`, `holdsFollowers` (only when `fastIdle` is true, as today), `slowWaiting` (only in `rewalk`, after the halt). Table rows "reads no group's holds while fast work is pending" and "reads each group's holds and the stored activity once per answer" pin this.

## The stamp

`Mutex.turn` counts started tasks. `#facts()` stamps `turn` with it. `#fly` calls `checkTurn(admitted, lock.turn, tier.lane)` first: the pump passes its lock block's answer, a slow lane its `LaneAnswer`'s turn on `SlowRun.turn`. A mismatch throws `squeal scheduler: an admission read in lock turn N was acted on in lock turn M, lane L`, which stops the pump with its note as any tier error. With this code it never fires. Tested in `admission.test.ts` ("the lock turn stamp").

## Tests

New: `test/scheduler/admission.test.ts` (42 cases, pure, a `facts(overrides)` builder), `test/scheduler/admission-rewalk.test.ts` (1 case, real scheduler).

Table rows by the design's list: each halt reason and their order; runner work for the fast lanes; nothing in flight, every lane asked; a group in flight; `after: [tests]` with an edit pending, with a backlog and no request, with a request open; `after: [lint]` while lint holds (queued and in flight) and while lint holds only unasked files (019-26); width normal, low idle with no normal work, low under load, low with fast work, low while a normal group holds, low beside an unasked commit file (019-27); the re-walk with the default slow lane waiting, and on a halt; `hasWork` on hold and while waiting or reinstalled; `quiet` while stopping but not closed; differences 1 and 2 pinned; the stamp.

**Deleted width cases: none.** Every case of `group-lanes-width.test.ts` and `slow-width.test.ts` drives a real scheduler:
- `slow-width.test.ts` "leaves the rest queued past an edit..." and "starts none of the rest once the scheduler closes" test the runner's `slowWidth` (review 001-394 B2), not the facts' width. Not repeated by the table.
- `group-lanes-width.test.ts` "takes both files in one tier while the commit group's unasked file stays queued" repeats the table's 019-27 width row, but it is the only test that the real lane's `holdsFollowers` reaches the width through `#facts()`: the table fakes that fact. Kept; a later quality row may remove it once a wiring test covers `#facts()`.
- `group-lanes-width.test.ts` "runs one file a tier while the commit group's requested file runs" holds a run (a race). Kept.

Existing tests the table repeats (kept, as the design says; removal is a later quality row):
- Halts: `runtime-gone-slow` B3; `runtime-gone-tier` B2 cases; `command-hold` 1, 3 and the slot case; `command-hold-slow` both; `merge-hold` 1; `install-wait` "lists and runs nothing..."; `reinstall` "exits at the check before a tier...".
- `hasWork` on hold and `quiet`: `command-hold` 1 (an edit starts nothing on hold); `in-use` all five; `slow-waiting` all three.
- `after` and width: `group-lanes-limits` "takes `maxParallel` files a tier for a `normal` group" and "holds an `after` group until its predecessor settles"; `commit-group-after` all four (019-26); `group-lanes-width` both; `slow-tier` "lets an edit's fast file run between two slow files".
- The re-walk: `import-rewalk` cases.

## Type changes (all additive or internal)

- `Mutex.turn` (new getter).
- `SlowRun.turn` (new member).
- `SlowHost`: 8 members removed, `probe` and `admit` added. `SlowHost` has no implementation outside `scheduler.ts`; no test fake implements it (`request-intake-probe.ts` fakes a `SlowTier`, not a `SlowHost`, and needed no change).
- New exports in `admission.ts`. `src/core/types/scheduler.ts` is untouched (row 011-339's).

## For the next worker (011-341, 011-342)

- Difference 1: `Admission#laneHalt` reads no runner work; the pinned row is "difference 1, row 011-341" in `admission.test.ts`. Flipping it: add `runner-work` after `held` in `#laneHalt`, and the 011-341 scheduler test.
- Difference 2: `StartFacts.slowWaiting` reads only `readSlowActivity` (the default `slow` group's key). Flipping it: read every lane's activity (`readGroupActivity` per group) in `#facts()`. The pinned row is "difference 2, row 011-342".
- A scheduler test that sets the daemon's stop flag uses `Reflect.get(h.scheduler, "options")` (`admission-rewalk.test.ts`): `openHarness` passes no `stopping`.
