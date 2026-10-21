# 011-91 to 011-93: worker notes (W3 of `host-load-wave-1.md`)

Code rows of design 011-84 (`../011-84/design.md` section 6), one commit each, in order. Worker 4e68650a, 2026-10-21 and 10-22.

## Seam map

| Row | Seam | Files |
| --- | --- | --- |
| 011-91 | `resumesRest` in `src/core/delivery/liveness.ts`: the rest mark is later than every heartbeat the row records. The daemon reads it in `#register`, before its own heartbeat ends the rest, and passes `SchedulerOptions.resumesRest`. `scan` adds `WorktreeKeys.seededAtStart` to the start revision's paths; `baseline` computes the cut and queues the reach of the unseen revisions when it resumes. | `daemon.ts`, `liveness.ts`, `options.ts`, `keying.ts`, `bootstrap.ts`, `scheduler.ts` (passes the flag to `scan` and `#baseline`) |
| 011-92 | `Scheduler.inUse()` replaces `busy()`: `#editPending()` (runner work, the first group with promoted files, an edit's or turn tier in flight), `owedWork()`, and `SlowTier.requested` while slow files are pending. `Scheduler.queued()` counts fast and slow entries. `lifecycle.ts` reads `work.inUse`; `unusedText` names the queued count. | `scheduler.ts`, `slow-tier.ts`, `lifecycle.ts`, `daemon.ts`, `types/scheduler.ts` |
| 011-93 | `Scheduler.pauseBacklog(on)` sets `Ledger.backlogPaused` and `SlowTier.draining`. `Ledger.ordered` and the new `Ledger.fastQueued` keep only the drain's files, so `#hasWork`, `#fastIdle` and `#freeLaneQueued` read `fastQueued` and `tiers.ts` is unchanged. A draining slow tier yields to another worktree's fresh mark on every turn and writes no mark. The lifecycle pauses when the drain starts and resumes when `countPresence` finds a session. | `ledger.ts`, `scheduler.ts`, `slow-tier.ts`, `lifecycle.ts`, `daemon.ts`, `types/scheduler.ts` |

## Decisions the design left open

1. **The resume read.** `restState` requires the record to be cleared. The daemon reads before it registers, and a record the resting daemon left counts too: its heartbeat came before the mark. With no `lastHeartbeatAt` there is no rest, as `restState` reads it.
2. **New files at a resume with no start revision.** When nothing cached changed, the files hashed for the first time form a set of their own, as a revision would.
3. **`WorktreeKeys.seededAtStart` is a public field, not a getter.** A getter's body ran in no validity case, and the key-format alarm (`test/keys/key-format.test.ts`) named its lines. A field initializer and the assignment in `bootstrap` run in the `assemble` cases.
4. **The unused note names a count**, not paths: "with 1 session registered and 50 test files queued; the next hook starts it again". With nothing queued the text is as before.
5. **`run --slow` as use.** `#requested` is cleared only when the slow tier next looks at its candidates, so `inUse` reads it together with `slowPending()`.
6. **A slow file an edit queued is no use under the unused bound.** The C9 text lists slow files no request asked for as backlog. The edit itself restarts the bound, so the edit's slow files have the 30 minutes after it.
7. **What a drain runs.** Every first-group entry (recent or promoted) counts as an edit's work. A predecessor's handed-over files in the first group (its own edits' work, 011-33) run too. Those in the second group or catch-up stay paused. Telling them apart would need the queue to keep where a recent entry came from.
8. **A backlog tier in flight when the drain starts** stores, and the slow lane waits for it, as `#fastIdle` still needs every fast lane free. Backlog tiers are bounded by their wall budget (C4 step 5).
9. **A pause before the scheduler starts** is kept and applied to the ledger at start. The daemon does not do this, but the slot test uses it.

## Tests

- `test/scheduler/rest-resume.test.ts`: red before (no runs), green after. `test/daemon/unused-stop.test.ts`'s lookup-only case: red with the daemon's pass-through off, green with it. `test/delivery/resumes-rest.test.ts` pins the read.
- `test/scheduler/in-use.test.ts`: under the old `busy()` rule, 3 of its 5 cases fail. `test/daemon/unused-timers.test.ts`: red, then green.
- `test/scheduler/slow-backlog.test.ts` (drain block) and `test/scheduler/slow-slot-fair.test.ts` (drain block): red with `pauseBacklog` a no-op, green. `test/daemon/drain-timers.test.ts`: red, then green.
- Not added: a real-daemon drain test with a paused backlog (`test/daemon/drain.test.ts`). The daemon's part is one line, `pauseBacklog: (on) => this.#loop?.scheduler.pauseBacklog(on)`, and the lifecycle and scheduler tests cover both sides of it.

## For the next worker

- `slow-slot-fair.test.ts`'s "a guard wait gives way" and "below the threshold" failed in a direct `npx vitest run` at load 60 on 24 CPUs. Both passed under Squeal at revision 30.
- `capacity-pool.test.ts`'s "runs an edit's tier without a grant" failed once at load 63 and passed on Squeal's load retry. Squeal had already recorded it as flaky.
- 011-83 (`slow-tier.ts`, the waiter's 2 s re-check) meets 011-93 in `next()` and `#waitAtSlot`. The drain's yield reads the slot's marks (`slot.ts`), not the pool's.
