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
- `scheduler/tier-live.ts`: the live view's `quietWakeMs`, each look at the waits, calls `context.capacity?.expectBacklog(quietDemand(...))` first.
- Tests: `test/capacity/quiet-demand.test.ts` and `test/scheduler/quiet-demand.test.ts` (new); one case added to `test/scheduler/tier-plan-share.test.ts` (10 CPUs: `fullWidth` 8).

Type changes, all additive: `PermitPool.expectBacklog` (new required member; `LockFilePool` is the only implementer), `TierCapacity.expectBacklog`, `backlogShareSlots`, `QuietDemand`, `QUIET_DEMAND_WRITE_MS`, `QUIET_DEMAND_LEAD_MS`, `QUIET_DEMAND_FILES`, `quietDemand`. The pool's private `#share` gained a `kind` parameter.

## Decisions the brief did not settle, and one change from it

1. **Rounded up, not down** (coordinator's answer to request 54e2992e, 2026-11-21). The CPU gate (`gatedPermits`) takes a permit while the cores are below the ceiling, so on an idle host it admits `ceil(ceiling)` workers. With the default share 0.75, a machine of 6, 10, 14, 18 or 22 CPUs has a ceiling of 4.5, 7.5, 10.5, 13.5 or 16.5. The brief's floor would give one daemon alone one worker fewer than before there (10 CPUs: 7, not 8), against "no change with one daemon". On 12 CPUs (ceiling 9), where the probe ran, both give 9. Test: 10 CPUs, 9 slots: one daemon alone gets 8, two get 4 and 4.
2. **Only the wait for catch-up states demand, not the 20 s wait after a cancel.** The probe counted both. The wait after a cancel (`BACKLOG_QUIET_MS`, 20 s) is shorter than the 30 s lead, so it would state demand from its first second, and an edit that starts it again would not withdraw it: an agent editing every few seconds would hold another daemon to half the ceiling, the risk the brief rules out. The catch-up wait is 120 s, so its demand starts after 90 s of quiet, and an edit (which starts the wait again at 120 s) withdraws it at the next look. The measured case is the catch-up wait: both copies' first backlog tiers after an edit. Within the last 30 s of a catch-up wait, a wait after a cancel in the same lane can only be younger than 20 s if a tier was cancelled without a revision queuing the lane; such files are not counted.
3. **Where the look happens.** As in the probe: the live view's `quietWakeMs`, which the tier plan's idle answer (`idleOf`) reads at each pump look that starts nothing; while a wait holds, the pump looks every 1 s. The demand is therefore not updated at a look where claims wait (`idleOf` answers `claims` first) or where a tier starts. Then the mark keeps the last number; a tier's `acquire` ends it, and the next idle look states the new one. A view read with a side effect is not ideal; the brief's ownership (`tier-live.ts`, not `step-live.ts` or `tier-plan.ts`) put it there.
4. **What ends it when no tier asks.** A wait that ends with no backlog tier started: the next idle look states 0 and the mark goes. An edit's tier that runs meanwhile keeps the demand in its refreshed mark until that look.
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

## Checks run

- `timeout 300 pnpm exec vitest run test/capacity/quiet-demand.test.ts`: 12 passed. With the share's total put back to the slots, 2 failed (the 5 + 4 split and the 7.5 ceiling): the tests discriminate the ceiling share. On 0.1.578 every quiet-demand test fails: `expectBacklog` does not exist.
- `timeout 300 pnpm exec vitest run test/scheduler/quiet-demand.test.ts`: 4 passed.
- Every test file that imports `capacity/{pool,background,quiet-demand}` or `scheduler/{quiet,capacity,tier-live}`, and every file naming 011-417, 011-418 or 011-419: `timeout 900 pnpm exec vitest run <58 files>`: 58 files, 390 tests passed.
- No file under `test/e2e` or `test/integration` names the changed paths.
- `pnpm run typecheck`, `pnpm run lint`: clean.
- Benchmark: not run here. The brief forbids `pnpm run build` in this worktree, and `bench/boat-run.sh --ref .` needs the built plugin; the wave runs it on the candidate before review.

## For the next worker or the reviewer

- The pump-look gap (decision 3): if the reviewer wants the demand stated at every step, the call belongs in `step-live.ts`, outside this row's files.
- `LockFilePool.acquire` was 22 on the complexity count before this row and still is; this row adds no branch to it.
- `pool.ts` is about 780 lines; the quiet's state went to its own file to add as little as possible.
