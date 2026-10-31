# 011-272: a retry receipt says queued (gh-114)

Wave 60 W2, repair. Wording only: no scheduler change, no new scheduler field.

## What changed

- `squeal retry --reason environment` and a `load` retry the load lets through: "runs once more in its turn at its normal priority", then where the run stands: "it has not started: <what holds it>", "it has not started; what holds it is not known", or "a run of it at these inputs is running since HH:MM:SS". A `load` retry the gate holds keeps its gate text and names no blocker: the gate is the first one.
- A file with no result at its inputs: "It runs once in its turn at its normal priority" (was "runs once now").
- Status, a pending retry no daemon has queued yet: "the daemon queues its run at its next look" (was "runs at once" and "runs at the daemon's next look"). The closed load gate's texts are unchanged.
- Status, a retry this worktree's daemon queued and has not started: "queued and not started: <what holds it>" or "queued and not started; what holds it is not known". JSON: the retry group's standing has `waits` (`RetryWait`).
- Status, another worktree's daemon queued it: "queued by another worktree's daemon; whether its run started is not known here" (was "runs at once, queued by another worktree's daemon").
- `squeal --help` retry lines: "environment is queued at once; the run waits its turn, which status names".

## Seam map

- `src/core/retry/waits.ts` `retryWaitOf(ref, {isSlow, activity, runs})` is the one rule; `src/core/retry/text.ts` `holdText`/`retryStartText` the words.
- Status feeds it from `outstandingOf`'s reads: `header.slowTier.activity` (the live activity `readSlowTier` computes, the `Slow tier:` line's), `reads.runs` (the live daemon's open runs).
- The receipt feeds it from `src/cli/retry-queue.ts`: the same reads, only while the daemon is live (`worktreeLiveness`); with none, `unknown`.
- `retry` groups split by `waits` in `outstanding.ts` (`waitsId`), not in `standing-groups.ts` `groupId`, which this row does not own.

## Blocker rule and its evidence

- A slow file: the slow tier's published wait (`fast`, `slot`, `load`, `idle`) or run of other files (`slow`); with nothing published, an open run of fast files is `fast`. An edit's fast tier keeps `#slowMayStart` false, so the slow tier publishes no wait while it runs (`research/issue-114.md` F1; seen again in `test/status/retry-holds-live.test.ts`).
- A fast file: an open run holding a fast file of its own project is `tier` (one project, one runner, one lane). Two Vitest projects share a lane; a run of the other one reads `unknown`, never a wrong blocker.
- The file's own open run is `running`.
- `slot` covers the slow slot and the shared worker pool (C10): the slow tier publishes `waiting: slot` for both (`WAIT_FOR_CAPACITY`). The words say "the slow slot", as the `Slow tier:` line does.

## For the next worker

- A test that makes the slow slot's directory itself must make it private (0700, as `mkdtempSync` does), or leave it to `acquireSlowSlot`, which creates it so. The slot throws for a 0755 one (`checkPrivateDir`); in the `side` fixture the slow file then never runs and the slow tier's activity stays at its last `waiting: fast`, which reads as a scheduler stall. Seen while writing `retry-holds-live.test.ts`.
- `plugins/claude-code/dist` still carries the old help and receipt words; this row does not own the bundles.
- The eval reference sessions (`test/evals/retry-texts.ts`, `retry-claim.test.ts`) keep the old receipt as recorded history; the eval parser keys on "Retry queued" and the group prefix, both unchanged.

## R1: review 0.1.382 B1, the `slot` words

Wave 60.5 RP1, on `cand/0.1.382` `a4821729c`. Wording only: no scheduler change, no new scheduler field.

- The slow tier publishes `waiting: slot` for two resources: a slow slot it cannot take (`#waitAtSlot`) and a shared worker pool that refuses a permit (`WAIT_FOR_CAPACITY`, `slow-tier.ts` `#tryRun`). `retryWaitOf` copies either to `{kind: "slot"}`, so the old words "the slow tier waits for the slow slot" claimed one resource the record does not prove. The seam bullet above ("The words say 'the slow slot'") no longer holds.
- `holdText` (`src/core/retry/text.ts`), one renderer for the receipt and status, now says: "the slow tier waits for capacity; whether the slow slot or the shared worker pool holds it is not known". JSON keeps `waits: {kind: "slot"}`.
- New regression, `test/status/retry-holds-live.test.ts`, second test: a real scheduler with a private pool of one permit (`hostSlots: 1`) and a private slow slot. Another owner holds the pool's permit; a third owner takes and gives back the slow slot to prove it free. The receipt and status read the capacity words, the JSON `waits: {kind: "slot"}`, the FAIL stays counted; once the pool's permit is free the retry runs and passes. It failed on the candidate at the receipt assertion, after the full-pool, free-slot setup held.
- Kept: the occupied-slot live steps, the failure count and the JSON `waits` in the first live test; the store-level `slot` cases in `test/status/retry-holds.test.ts` and `test/cli/retry-queued.test.ts`, with the new words.
- Fixture, by the coordinator's agreement: `side()` in `test/scheduler/claims-fixture.ts` takes an optional `capacity` (`SchedulerOptions["capacity"]`), passed through to `createScheduler`.

Left alone, outside this repair: the `Slow tier:` status line still says "waiting for the slow slot another worktree's slow tier holds" for the same published state (row 011-58's text). It has the same ambiguity when the pool, not the slot, refused.
