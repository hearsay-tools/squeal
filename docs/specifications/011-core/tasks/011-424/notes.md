# 011-424: two worktrees changed at once share the background ceiling from the start

Worker e943e0b5, wave 126 W1, 2026-11-21. Shape: slice. Brief: `tasks/wave-126.md` W1. Source: `research/simultaneous-demand.md` (row 011-420) and `research/simultaneous-demand-2.md` (row 011-423), arm qc; the probe `research/probes/simultaneous-demand-2/qc-ceiling-share.patch`.

## What changed

- `capacity/background.ts`: `backlogShareSlots(ceiling, hostSlots)`: the workers a backlog tier's fair shares divide, `max(1, min(hostSlots, ceil(ceiling)))`.
- `capacity/quiet-demand.ts` (new): `QuietDemand`, what a wait for quiet states and when the mark was last written for it; `QUIET_DEMAND_WRITE_MS` = 5 s.
- `capacity/pool.ts`:
  - `PermitPool.expectBacklog(files)`: the mark states `files` as demand with no grant, `since` null. Written when the number changes, and at most every 5 s when it does not. 0 ends it: the mark is cleared, unless a tier runs or the daemon waits, when the mark is written again without it. The next `acquire`, of any kind, ends it too: from then on the tier states its own demand.
  - `#share` takes the tier's kind: a `backlog` tier's fair shares divide `backlogShareSlots`, a `checkpoint` tier's the slots, as before. `offer` passes its kind too.
  - When the last tier ends while the quiet states demand, the mark is written again without the tier, not cleared (`#deactivate`). `close` still clears it.
- `scheduler/capacity.ts`: `TierCapacity.expectBacklog(files)` passes it on; `fullWidth` is `min(backlogShareSlots(ceiling, slots), project slots)`.
- `scheduler/quiet.ts`: `QUIET_DEMAND_LEAD_MS` = 30 s, `QUIET_DEMAND_FILES` = 64, `quietDemand(context, ledger, now)`: the catch-up files queued in the lanes whose catch-up wait ends within 30 s, at most 64.
- `scheduler/step-live.ts` (since the repair of review 0.1.584 B2; first `tier-live.ts`'s `quietWakeMs`): each step calls `context.capacity?.expectBacklog(quietDemand(...))` first.
- Tests: `test/capacity/quiet-demand.test.ts` and `test/scheduler/quiet-demand.test.ts` (new); one case added to `test/scheduler/tier-plan-share.test.ts` (10 CPUs: `fullWidth` 8).

Type changes, all additive: `PermitPool.expectBacklog` (new required member; `LockFilePool` is the only implementer), `TierCapacity.expectBacklog`, `backlogShareSlots`, `QuietDemand`, `QUIET_DEMAND_WRITE_MS`, `QUIET_DEMAND_LEAD_MS`, `QUIET_DEMAND_FILES`, `quietDemand`. The pool's private `#share` gained a `kind` parameter.

## Decisions the brief did not settle, and one change from it

1. **Rounded up, not down** (coordinator's answer to request 54e2992e, 2026-11-21). The CPU gate (`gatedPermits`) takes a permit while the cores are below the ceiling, so on an idle host it admits `ceil(ceiling)` workers. With the default share 0.75, a machine of 6, 10, 14, 18 or 22 CPUs has a ceiling of 4.5, 7.5, 10.5, 13.5 or 16.5. The brief's floor would give one daemon alone one worker fewer than before there (10 CPUs: 7, not 8), against "no change with one daemon". On 12 CPUs (ceiling 9), where the probe ran, both give 9. Test: 10 CPUs, 9 slots: one daemon alone gets 8, two get 4 and 4.
2. **Only the wait for catch-up states demand, not the 20 s wait after a cancel.** The probe counted both. The wait after a cancel (`BACKLOG_QUIET_MS`, 20 s) is shorter than the 30 s lead, so it would state demand from its first second, and an edit that starts it again would not withdraw it: an agent editing every few seconds would hold another daemon to half the ceiling, the risk the brief rules out. The catch-up wait is 120 s, so its demand starts after 90 s of quiet, and an edit (which starts the wait again at 120 s) withdraws it at the next look. The measured case is the catch-up wait: both copies' first backlog tiers after an edit. Within the last 30 s of a catch-up wait, a wait after a cancel in the same lane can only be younger than 20 s if a tier was cancelled without a revision queuing the lane; such files are not counted.
3. **Where the look happens.** *Superseded by the repair of review 0.1.584 B2, below.* As in the probe: the live view's `quietWakeMs`, which the tier plan's idle answer (`idleOf`) reads at each pump look that starts nothing; while a wait holds, the pump looks every 1 s. The demand is therefore not updated at a look where claims wait (`idleOf` answers `claims` first) or where a tier starts. Then the mark keeps the last number; a tier's `acquire` ends it, and the next idle look states the new one. A view read with a side effect is not ideal; the brief's ownership (`tier-live.ts`, not `step-live.ts` or `tier-plan.ts`) put it there.
4. **What ends it when no tier asks.** A wait that ends with no backlog tier started: the next step states 0 and the mark goes. With an edit's tier running, the mark is written again without the demand, and the tier's refreshes write that one.
5. **A refused waiter keeps its mark** when the quiet's demand ends (`#marked`: a tier runs, the daemon waits, or the quiet states demand).
6. **The remote runner host's admission** (`runner-host/remote/admission.ts`) asks the pool as a `backlog` tier, so its share now divides the ceiling's workers too. Its tests pass unchanged.

## 011-418's `shareBudget` and `fullWidth` against the share

Before this row they did not quite agree. `fullWidth` was `min(ceiling, slots, project slots)`, the ceiling unrounded (7.5 on 10 CPUs), while a backlog share divided the slots and the gate admitted `ceil(ceiling)`: one daemon alone was offered 8 against a full width of 7.5, and `shareBudget` capped the ratio at 1. Now `fullWidth` is `min(backlogShareSlots, project slots)`, the number the shares divide, so a daemon alone offered its whole share gets the whole budget (8 / 8), and each of two daemons at 4 gets half. The project cap stays outside the share, as before (`#share` applies it to the target).

## The 30 s lead and the 64 files

Both are rules, not tuned to a host. The lead must be shorter than the catch-up wait (120 s), so that an edit withdraws the demand, and no longer than a mark's freshness (30 s), so the quiet's demand never outlives what a dead daemon's mark would. The gap between two worktrees' quiet ends depends on when the agents edit, not on the machine, so I would not derive it from the machine. 64 files is more than any fair share of the ceiling on the machines measured; a cap at `backlogShareSlots` would give the same shares to a reader of this release, but an older reader divides the slots, and 64 keeps the mark the same for both. I would not derive either from the machine.

## Proposed spec text (the coordinator lands it)

Started from `research/simultaneous-demand.md`, "Spec text", with decisions 1 and 2.

**011 C10** (Backlog and checkpoint tiers): replace "the host's slots divided by the daemons with backlog work (holders, and waiters marked in the last 30 s)" with:

> the host's slots divided by the daemons with backlog work (holders, waiters marked in the last 30 s, and daemons whose wait for catch-up, C4 step 5, holds files and ends within 30 s: their mark states those files, at most 64, as demand with no grant, until a tier asks or the wait ends or starts again; amended, rows 011-420, 011-423 and 011-424: with two worktrees edited at once, the second reached more than 3 workers a median 178 s after the first's backlog started, at 0.1.578). A backlog tier's share divides the workers the background ceiling admits (021 D18), its busy CPUs rounded up, at most the slots, instead of the slots; a checkpoint tier's divides the slots.

**011 C4 step 5**, after the catch-up quiet's paragraph:

> While a lane's wait for catch-up holds files and ends within 30 s, the daemon states them in its pool mark (C10), so a daemon whose wait ends first leaves this one its fair share. The wait after a cancel states nothing: at 20 s it is shorter than the lead, and an edit that starts it again would not withdraw the demand (row 011-424).

**021 D18** may want one line: the ceiling also sets the total that backlog fair shares divide (011 C10), rounded up, at most the slots.

## Repairs after review 0.1.584 (FAIL, B1 and B2)

Worker e943e0b5, 2026-11-21, on `83d4dbc62` (the row's two commits rebased onto main 0.1.582 with the coordinator's spec amendment; the build commit left out).

### B1: a ceiling below a tier's fewest workers starved it

Cause: `backlogShareSlots` made a backlog tier's fair shares divide the ceiling's workers, 1 on 4 CPUs at a share of 0.25. `fairShares(1, [me])` gives 1, and `raiseToLeast` has no junior share to raise it from, so a tier of `least` 2 had a target of 1. The floor (021 D18) offered 2, `acquire` took `min(target, gated)` = 1, below `fewest`, and refused it at every look. Before the row the shares divided the 3 slots, and the floor gave 2.

Repair, at the share: `backlogShareSlots(ceiling, hostSlots, least)` raises the total to the most fewest workers of the demands the shares divide (`least` of this daemon's tier and of each waiter's mark), at most the slots (`LockFilePool.#shareTotal`). The shares then reach the tier's fewest workers, and `raiseToLeast` serves them in seniority order as before; the ceiling still gates every permit, and only the floor (no background tier runs, no waiter served first) admits the fewest above it. The project cap still bounds the target. With `least` 1, as in every tier but an `isolate: false` Vitest project's or a slow lane's, the total is unchanged: the 5 + 4 split, the rounding and `fullWidth` (no `least`) stay as they were.

Tests (`test/capacity/least-floor.test.ts`, 6, all fail without the raise): an idle lone daemon on 4 CPUs and 3 slots, `least` 2, at ceilings 0, 0.75 and 1, gets 2; with a holder and an older waiter of `least` 2, a younger waiter gets nothing and the older one gets its 2 once the holder releases; the remote runner host's admission (`createHostAdmission`) gets 2; and the total's bounds.

### B2: a step that chose the wait on claims kept a restarted quiet's demand

Cause: the demand was stated in the live view's `quietWakeMs`, which `idleOf` reads only after the claims. An edit that started a lane's wait again while another lane's files waited on claims left the old demand in the mark; with an edit's tier running, its refreshes kept it fresh.

Repair: `StepLive.step` states it first (`#stateQuietDemand`), at each step, before any rule chooses between a start, a wait on claims and a wait for quiet. `quietWakeMs` is the plain wake again, and keeps its place after the claims. A step in a lock turn (a revision's) states it too, so an edit withdraws the demand at its own step. `expectBacklog(0)` still clears only the quiet's demand: a waiter's mark and a held tier's stay (unchanged tests).

Tests:
- `test/scheduler/quiet-demand-live.test.ts` (new), two live schedulers on one virtual clock: lane one's catch-up waits to 140 s; lane two's catch-up, ended at 125 s, waits on the other worktree's held run of the same keys. At 126 s nothing runs and lane one's demand is in the mark; an edit of A at 127 s starts lane one's wait again, and the mark states no demand, and a peer is offered every slot the other's tier leaves. On the candidate's step and view this fails: the mark still states 9 files. The other worktree's heartbeat is written on the virtual clock: its own interval writes real time, and its claims would read as a dead daemon's 126 s later.
- `test/capacity/quiet-demand.test.ts`: the quiet's demand ended under an edit's tier (`running`, no `acquire`): the mark states 0 and a peer is offered the whole ceiling after the tier's refreshes.
- `test/scheduler/quiet-demand.test.ts` reads `quietDemand` directly; its calls of `quietWakeMs` tested the old place.

### Checks of the repair

- `timeout 300 pnpm exec vitest run test/capacity/least-floor.test.ts`: 6 passed; with `backlogShareSlots` back to `ceil(ceiling)`, 6 failed.
- `timeout 300 pnpm exec vitest run test/scheduler/quiet-demand-live.test.ts`: passed 4 times; with `step-live.ts` and `tier-live.ts` of `83d4dbc62`, failed: `expected 9 to be +0`.
- Every test file that imports `capacity/{pool,background,quiet-demand}`, `scheduler/{quiet,capacity,tier-live,step-live,tier-plan}` or `runner-host/remote/admission`, and every file naming 011-417, 011-418, 011-419 or 011-424: `timeout 900 pnpm exec vitest run <66 files>`: 66 files, 454 tests passed (`step-reading.test.ts` included: the step's statement reads no clock of its own).
- No file under `test/e2e` or `test/integration` names the changed paths.
- `pnpm run typecheck`, `pnpm run lint`: clean (lint's one warning and one info are in the unchanged `test/ci/endpoints.test.ts`).
- Squeal reports `test/harness/plugin.test.ts` and `test/harness/codex/packaging/runtime.test.ts` failing: the bundles differ from the build because the base leaves the build commit out, as the coordinator said. Not this repair's.

## Checks run (first round)

- `timeout 300 pnpm exec vitest run test/capacity/quiet-demand.test.ts`: 12 passed. With the share's total put back to the slots, 2 failed (the 5 + 4 split and the 7.5 ceiling): the tests discriminate the ceiling share. On 0.1.578 every quiet-demand test fails: `expectBacklog` does not exist.
- `timeout 300 pnpm exec vitest run test/scheduler/quiet-demand.test.ts`: 4 passed.
- Every test file that imports `capacity/{pool,background,quiet-demand}` or `scheduler/{quiet,capacity,tier-live}`, and every file naming 011-417, 011-418 or 011-419: `timeout 900 pnpm exec vitest run <58 files>`: 58 files, 390 tests passed.
- No file under `test/e2e` or `test/integration` names the changed paths.
- `pnpm run typecheck`, `pnpm run lint`: clean.
- Benchmark: not run here. The brief forbids `pnpm run build` in this worktree, and `bench/boat-run.sh --ref .` needs the built plugin; the wave runs it on the candidate before review.

## For the next worker or the reviewer

- `LockFilePool.acquire` was 22 on the complexity count before this row and still is; this row adds no branch to it.
- `pool.ts` is about 780 lines; the quiet's state went to its own file to add as little as possible.
