# Design: a named wait's batch does not wait for the CPU pool, and the wait says when it waits for CPU

Rows 011-308 and 011-309. Coordinator 83be4a7a, 2026-11-07. Source: `research/wait-timeouts.md` (main `bc58ad12f`), change 1 and the recommendation's output line; the human chose both on 2026-11-07 (task 7d611fc4). Not in scope: change 2 (a busy-core ceiling for background tiers, rejected as too tied to one machine), changes 3 and 4. Status: draft, awaits the human.

## Today

`squeal status --wait <ms> <test file>...` promotes the named test files into a batch (C15, row 011-268). In a lane that runs its backlog in tiers (Vitest), the batch runs as one backlog tier: up to `runner.backlogTierSize` files at the pool's whole grant. That tier asks the per-user pool for permits (`selectTier`, `src/core/scheduler/tiers.ts`, `granted = backlog || turnTier`). The pool's CPU gate (`gatedPermits`, `src/core/capacity/cores.ts`) refuses while the host's busy cores are at or above `hostSlots` and the daemons' grants are at or above half of them. On a refusal the batch starts nothing and asks again every 2 s, with no bound. An edit's tier never asks. In a lane of slots (node:test, pytest) the named files already run in an edit's tier.

Measured on this host (`research/wait-timeouts.md` Q1, Q3): "promoted, no tier ahead" is 0 timeouts in 100 waits at 0-6 busy vCPUs and 7.6 in 100 at 20-24. In the sampled cases a free worktree ran nothing for 60 to 291 s, then ran the batch in a few seconds. The wait printed only `queued, promoted`.

## D1. The batch never starts later or narrower than an edit's tier would (row 011-308)

The batch asks the pool as today. When the pool refuses, or grants fewer workers than an edit's tier of the same files would run with, the batch's next tier starts at once without a permit, as an edit's tier: at most `runner.tierSize` files of the batch, longest first as today, run as wide as an edit's tier of those files. Like an edit's tier it states its CPU in the daemon's mark (row 011-98), so other daemons' backlog gates count it. The rest of the batch stays promoted and leads the lane's next selection; on a busy host it moves one edit-sized tier at a time.

- On a host where the pool grants, nothing changes: the batch still runs as one wide tier (row 011-268's measured gain: 364 s against 1,978 s for the 56-file gate).
- The permit-free tier is a batch tier in every other respect: an edit's work does not cancel it, it does not count toward the four first-group tiers, and the backlog's turn is due after it (`batchTurnDue`). The backlog's turn still asks the pool.
- **Ahead of new runs.** No new ordering rule. The batch already leads its lane (row 011-268), and a running tier with more than 30 s left already yields to a promoted file (`yields.ts`). Today the refusal was the gap: while the batch waited, other tiers could take the lane. With D1 the batch no longer waits, so it starts ahead of tiers queued after it. A running tier keeps today's yield rule.

**Width bound, on any machine.** No new guard is proposed. The permit-free tier adds at most one edit-sized tier per waiting worktree per lane, and only while an agent waits on named files: the same bound edits already have. Ten agents that wait at once add what ten agents that edit at once add today. The bound uses no host-specific number: `runner.tierSize` is per project, and the rest of the backlog's gate shrinks while these tiers run because their CPU is counted in the marks.

## D2. The wait says when its files wait for CPU (row 011-309)

When the pool refused a tier that holds a pending named file, the daemon publishes the refusal with the file's state: since when, the host's busy cores, `hostSlots`, and the grants other daemons hold. The named line and the deadline line read it:

`queued, waiting for CPU since 10:02:17: the host is busy (21 of 24 cores in use; Squeal's daemons hold 7 of 12 test slots); the daemon asks again every 2 s`

After D1 a promoted test file no longer reads this, so the line reaches what still waits on the pool: files a named source selects (C15: source paths are not promoted), checkpoint tiers, and the backlog's turn. `--json` carries the same fields. The daemon also writes one log line when a tier starts to wait for the pool and one when it is granted, with the seconds it waited; not one per 2 s recheck. That answers the research's open question (refusals per wait) and measures D1 after release.

## Spec changes on approval

C15 "What the wait says" gains the D2 line form; C15 Rank and C4 step 5 gain D1's fallback; C10 Capacity says a named batch's tier falls back to an edit's tier when refused. One dated line each in `status.md`.

## Done when

- A scheduler test: with the pool refusing every permit, a named wait's batch of 6 test files starts at once, 4 files (`runner.tierSize`) in the first tier and 2 in the next; with the pool granting, it runs as one tier as before; an edit queued after the wait runs after the batch's tier.
- A status test: a source-path wait whose selected file sits behind a refused backlog tier reads the D2 line, in text and `--json`.
- The daemon log has the start and end lines of a pool wait.
