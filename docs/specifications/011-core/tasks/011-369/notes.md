# Row 011-369: two clocks, named by purpose

Worker 53e1f045, wave 108 "W1 rework" (`tasks/wave-108.md`), from main at 0.1.519. The human's decision of 2026-11-16, "Timers: D: name both by purpose", after review `reviews/0.1.520.md` S1. Candidate 0.1.520 (one calendar clock) is abandoned.

## What changed

- `Clock` (`src/core/scheduler/clock.ts`) reads two times:
  - `now(): EpochMs` is calendar time.
  - `elapsed(): ElapsedMs` is elapsed time. `ElapsedMs` is a branded number, and on the host it comes from `performance.now`.
  - `arm(ms, fire)` counts its delay in elapsed time.
- `ticks` is gone, and `SchedulerOptions.now` is gone. `clockOf` takes `clock` only.
- The old `elapsed(earlier, later)` helper was a calendar span. Its last two users moved to elapsed time, so it is gone.
- `Wakes` keeps due times on elapsed time only:
  - A slot states a delay: `after(ms)`, or `within(ms)` (the earlier of the stated wake and one `ms` from now). In a pass, the delay counts from the pass's elapsed reading.
  - `WakeSlot.wake` and `at`/`atMost` are replaced by `due: ElapsedMs | null` and `after`/`within`.
  - A pass reads calendar and elapsed time once each. Owners get the calendar reading for their stamps; the elapsed reading decides what is due.
  - `Wakes.elapsed()` gives owners that reading.
  - `RestWake.at` stays calendar time. It is calendar now plus the delay left, so a reader that moves the clock by `at - now()` reaches the wake.
- The owners state delays:
  - The runner-part bound uses `after(ms)`. `RunnerPartBound` lost its unused `now` parameter.
  - The slot gather uses `after(gather)`. The commit's time is measured on `Wakes.elapsed()`, and `SlotRecordsOptions.now` is gone.
  - The merge-hold poll uses `after(pollMs)`.
  - The claims poll uses `after(CLAIM_POLL_MS)`, then `after(next - at)`.
  - The slow lane's recheck uses `within(ms)`, from the step's arm, not from its calendar reading `at`.
  - Owners whose deadline is a calendar time state the delay to it. These are the command hold's stored `until`, the yield bound, the slow release's lane end, and the pump's `#eventOrAt(at)`.
- The slow lane's load budget (`slow-tier.ts`, `#deferred.from`) is measured on elapsed time. A calendar change spends none of it and gives none back.
- Daemon wiring: `daemon.ts` passes `clock: hostClock(this.#now)`, which is calendar time from the daemon's `now` with the host's elapsed time. `daemon-loop/index.ts`: the change feed reads calendar time from `options.clock`. `one-loop-source.test.ts` lists `core/daemon/daemon.ts` as a host-clock user, with its reason.
- `test/helpers/virtual-clock.ts`:
  - `advance` and `jump` move both readings.
  - The new `shiftCalendar(ms)` moves the calendar alone.
  - `harnessClock`'s host path hands the scheduler `{ clock: hostClock(read) }`.
- `GLOSSARY.md`, "Deciding what runs next": "Calendar time" and "Elapsed time" are added. "Wake" now says it is a delay, kept on elapsed time.

Kept from the 0.1.520 work:
- `SchedulerOptions.now` gone.
- The fixed-`now` test moves: `feed-delivered`, `heldBatch` on the host clock, and `batch-line` case 7 on the virtual clock.
- Review N1: the `batch-fixture.ts` comment.

Dropped from that work:
- Due when `clock.now() >= wake`.
- The `quietSide` comment and the `harnessClock` comment, which described wakes due on the calendar.

## Clock reads under `src/core/scheduler/`

```
$ grep -rnE "\bnow\(\)|\.elapsed\(\)|elapsed\(\)|performance\.now|Date\.now" src/core/scheduler --include=*.ts \
    | grep -vE "^\S+:\s*[0-9]+:\s*(\*|//|/\*)"
```

The output is 102 lines, each listed below with its kind. Four are declarations, not reads: `clock.ts:30` and `:32` (the `Clock` interface), `slow-release.ts:17` and `step-live.ts:54` (their hosts' `now`).

### Elapsed time: every wake, and the waits this row moved

| Read | Reason |
| --- | --- |
| `wakes.ts:161`, `:227-228` | The elapsed reading a slot's delay counts from: the pass's, else the clock's. |
| `wakes.ts:237`, `:263`, `:324` | A rest's delay left, whether a slot is due, the timer's delay. |
| `wakes.ts:286` (`elapsed`) | The pass's one elapsed reading: what is due. |
| `slot-records.ts:91`, `:94` | How long a commit took, which sizes the next gather: a span inside one daemon. |
| `slow-tier.ts:285`, `:599` | The load guard's budget: a wait inside one daemon. |
| `clock.ts:52` | The host's elapsed time, `performance.now`. |

The runner-part bound, the slot gather, the merge-hold poll, the claims poll and the slow lane's recheck read no clock now. They state a delay.

### Calendar time: stored, published or compared with other processes

| Read | Reason |
| --- | --- |
| `wakes.ts:236`, `:286` (`at`) | A rest's `at` for a reader; the pass's calendar reading, which owners stamp with. |
| `accept.ts:51`, `:53` | Stored results looked up by key at a time. |
| `checkpoints.ts:80`, `:175`, `:192`, `:258`, `:280`, `:318`, `:342` | Stored checkpoint records. |
| `claims.ts:54`, `:110`, `:169`, `:196` | Other worktrees' stamped claims and their liveness (row 011-372's read paths). |
| `command-hold.ts:179`, `:219` | Stored holds' `until`, which `squeal hold` processes compare. The wake is the delay to it. |
| `covered-files.ts:59` | Published "known since". |
| `decide-yields.ts:259` | A published `yieldsAt`. |
| `focused.ts:58`, `:75`; `focused-record.ts:56`, `:138` | A named wait's entries and their stored deadlines. |
| `head-move.ts:134` | A stored head move. |
| `hold.ts:170` | The merge hold's published "since". |
| `keying.ts:370` | Stored environment records. |
| `ledger.ts:200`, `:691`, `:702`, `:714`, `:725`, `:887` | Published promotions, stored re-key moves, unknown runs, pending times (row 011-372's file). |
| `mutex.ts:45`, `:59` | The lock holder's published "since". |
| `pool-wait.ts:107`, `:123`, `:138` | The published pool wait's "since". |
| `promotions.ts:135`, `:149`, `:153-154`, `:228`; `queue.ts:563`; `beside.ts:36` | A named wait's deadline, published for `status --wait` (`queue.ts` and `beside.ts` are row 011-372's). |
| `quiet.ts:150`, `:168`, `:208` | The quiet wait's `until`, published for status. |
| `record-tier.ts:75`; `rerun.ts:125`; `store-results.ts:44`; `revision.ts:386`; `runner-work.ts:40` | Stored records and revisions. |
| `request-intake-requests.ts:45`, `:74` | A request's deadline, published as a promotion. |
| `retries.ts:143`, `:181` | Other worktrees' liveness; stored retry ends. |
| `scheduler.ts:115`, `:266`, `:1561` | The scheduler's calendar reading; the stored keys' read time; a stored note. |
| `scheduler.ts:988` | The drain's busy time, compared with the lanes' stamped end (`groups.endedAt`). |
| `scheduler.ts:1401` | The pump's deadline `at` is a calendar time (a quiet end, a deadline): the wake is the delay to it. |
| `slow-release.ts:103`, `:128`, `:143` | A lane's stamped end and its idle bound; the wake is the delay to it. |
| `slow-tier.ts:671`, `:768` | The published activity's "since"; the lane's end, read by the release. |
| `slow-trigger.ts:27`, `:42` | Consumers' stored "last seen"; the latest revision's stored `createdAt`. |
| `step-live.ts:132`; `tier-live.ts:43` | The step's one reading, which its decisions compare with stored times (row 011-372's `step-live.ts`). |
| `stored-keys.ts:59` | Stored results' `recordedAt`. |
| `tier-start.ts:132`; `tiers.ts:193`, `:233`, `:436` | Stored run start and end; the published batch end. |
| `tiers.ts:287`, `:323` | A tier's `durationMs`, a span stored as a run's duration. Still calendar, as on 0.1.519. |
| `yield-waits.ts:87`, `:152`, `:191`; `yields.ts:118`, `:171`, `:185`, `:204`, `:212` | Ranks at a time, the remainder from the stamped `startedAt`, the published yield row. The yield bound's wake is the delay to it. |
| `clock.ts:41` | The host's calendar time, `Date.now`. |

### Waits still measured on calendar time

These compare a stored calendar time, so a calendar change moves them as it did on 0.1.519:
- The quiet wait (`quiet.ts`).
- The `edit` trigger's quiet (`slow-trigger.ts:42`).
- A named wait's deadline (`promotions.ts`).
- The claims window (`claims.ts`).
- A command hold's `until`.
- The slow release's idle bound.
- The yield bound and remainder.
- The drain's busy time.

Their wakes are kept on elapsed time and come after the delay stated at the time. The owner then reads the calendar again, and states the new delay. `tiers.ts:287`/`:323` measures a duration on calendar time.

Moving any of these to elapsed time would change what is stored or published (an elapsed time means nothing to another process), or it would touch row 011-372's decision helpers. I left them as they were.

`clock-port.test.ts` pins one of them: a calendar set back 1 h, past the edit, holds an `edit` group for about that hour, through its stored revision time.

## Tests

- `test/scheduler/clock-change.test.ts` (new), on the virtual clock, each with the calendar set back 1 h and set forward 1 h:
  - Review S1's probe: a held runner call's 400 ms bound ends after 400 ms, and not 1 ms sooner.
  - Review S1's probe: a finished slot is committed after its 25 ms gather, and not 1 ms sooner.
  - Every owner's wake (all nine `WAKE_ORDER` reasons, 100 ms apart) fires once, after its delay, on one timer. There are nine arms in all: no extra arm, and no wake lost.
  - A wake stated after a set-back still fires after its delay and moves the one timer.
  - A rest reports each wake's `at` from the calendar now.
- `wakes.test.ts`: statements move to `after`/`within`. The `ticks` setup becomes `elapsed`. A past wake on a closed loop reads as due now (`at: 100`, was `50`: a wake is a delay, and its calendar time is projected from now).
- `clock-port.test.ts`:
  - The `clockOf` shorthand case becomes "takes `clock`, else the host adapter".
  - The span clamp case is gone with the helper. The host adapter's case checks that `elapsed` reads `performance`.
  - The load budget rows run on a prompt virtual clock: frozen, 1 ms left, two waits, calendar set back (gives none back), calendar set forward 1 h (spends none), and calendar set back 1 h past the edit (held by the stored revision time).
- `wake-lane-order.test.ts`, `model-harness-clock.test.ts`, `step-reading.test.ts`, `runner-part-bound.test.ts`, `slot-records.test.ts`, `test/harness/test-command-listing.test.ts`: changes to the new slot and constructor surface only.

## Type changes

- Added: `ElapsedMs`, `Clock.elapsed`, `Wakes.elapsed`, `WakeSlot.after`, `WakeSlot.within`, `WakeSlot.due`, `VirtualClock.shiftCalendar`.
- Removed: `Clock.ticks`, `SchedulerOptions.now`, `WakeSlot.wake`, `WakeSlot.at`, `WakeSlot.atMost`, `SlotRecordsOptions.now`, `RunnerPartBound`'s `now` parameter, `clock.ts`'s `elapsed(earlier, later)`.
- Changed: `clockOf`'s argument, and `HarnessClock.scheduler`, which is `{ clock }` only.

## For the next worker

- A wake is a delay. An owner with a calendar deadline states `after(deadline - now())`, read once.
- A fixture's `now` (`CatchUpOptions.now`, `HarnessOptions.now`) is calendar time only. Wakes keep the host's elapsed time, so a calendar reading that stands still no longer stalls a wake.
- To test a clock change, use `virtualClock(...).shiftCalendar(ms)`.

## Rebase onto 0.1.521

The two commits were rebased onto cand/0.1.521 at `42acd3b9c`, which holds row 011-372 (every decision in a step reads the step reading `at`) and row 011-375. Each change keeps both intents: row 011-372's decisions read the step's calendar reading, and row 011-369's wakes are delays kept on elapsed time.

- `slow-tier.ts`, `#candidates`: a text conflict. Row 011-372 reads the queue at the step's reading (`const { at, context, ledger } = view; this.#queued(ledger, at)`). I keep that, so `at` stays in the destructuring that this row had dropped.
- `slow-tier.ts`, the trigger's quiet wait: a text conflict. Row 011-372's `quietLeftMs(context, group, at)` stays, a decision on calendar time. This row's `this.#arm(ms)` stays, a delay on elapsed time without `at`.
- `scheduler.ts` (the claims and pump wakes) and `slow-release.ts` (the release wake): these merged without a conflict. Only this row's wake lines changed in them; row 011-372's step-reading changes in those files are unchanged.
- `test/scheduler/step-reading.test.ts`: a text conflict. Row 011-372 replaced the hand-made `tickingClock`, to which this row had added `elapsed` and `shiftCalendar`, with a spy on the virtual clock's `now`. I took row 011-372's version. The virtual clock has `elapsed` itself, so nothing else is needed.

After the rebase, the clock reads in the list above keep their kinds. Row 011-372 routes more decisions through the step's reading; those reads are calendar time, as the list says for `step-live.ts`.
