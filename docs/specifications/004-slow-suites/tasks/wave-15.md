# Wave 15: slow-slot fairness under the load guard, and the status line that names the wait (004-84, 004-85)

The human, 2026-10-21: take 004-84 and 004-85 after 011-29 ships. They run side by side on disjoint files and ship in one release. Spec: D2, D3 and D8 (`spec.md`), 011 C6 as amended 2026-10-20. Board rows 004-84 and 004-85 hold the evidence and the contract.

## 004-84

Use /worker. Shape: slice. Outcome: the load guard decides whether the slow lane runs at all, never which worktree runs it: a daemon with slow files due waits at the slot as a marked waiter while another worktree holds it, and takes it at the handover without a new guard wait.

Read D2, D3 and the 004-84 board row. Seam: `SlowTier.next()` in `src/core/scheduler/slow-tier.ts:176`, which awaits `#waitForCapacity` (`:315`) before it tries the slot, and the waiter mark in `src/core/slow/slot.ts:146` (`SLOT_WAITER_FRESH_MS`). First edit, as a lead: a failing test with two daemons over one slot directory and injected load above `slow.maxLoadPerCpu`, one daemon past its `slow.maxDeferMs` budget and one fresh, both with slow files due; today the fresh one waits the whole budget while the other takes the slot file after file. Then try the slot (or mark the waiter) before the guard when another worktree holds it, and keep the guard's wait only for a free slot.

Owns `src/core/scheduler/slow-tier.ts`, `src/core/slow/slot.ts` and `src/core/slow/guard.ts`, and their tests. Leave alone: `src/core/status/` and the status texts (011-29's), the slow trigger and ranking (`slow-trigger.ts`, `src/core/slow/rank*.ts`; 004-80, 004-82), the D8 texts unless a wording names the old order, the board, the specs, `package.json` versions and `plugins/*/dist`. No `npm run build`. If the key-format alarm fires, stop and ask.

Done when:
- the fresh daemon runs a slow file within one handover, not after `slow.maxDeferMs`, in a test red on the baseline;
- with the slot free and the load above the threshold, a file still defers;
- below the threshold nothing changes;
- 004's suites, `npm run lint`, `npm run typecheck` and `squeal run --all --wait` green (paste its output);
- `tasks/004-84/notes.md` names any D3 sentence the change contradicts, for the coordinator's amendment.

## 004-85

Use /worker. Shape: slice, tests only. Outcome: regressions prove that status, after 011-29 (0.1.234), never reads as a stuck daemon when only slow files wait: 011-29 deleted `src/core/status/work-line.ts`, which printed `Idle: nothing is running and no run is open; N queued`, and `Outstanding:` leaves out the slow files the `Slow tier:` line counts (`src/core/status/outstanding.ts:106`).

Read the 004-85 board row, 004 D8, 011 C6 as amended 2026-10-20 and `../../011-core/tasks/011-29/notes.md` ("The groups"). Seam: a new `test/status/slow-only-wait.test.ts` over `test/status/slow-tier-seed.ts`, through `readStatus` and `formatStatus`, and the pathless wait's text through `waitText`. First edit: every queued file slow and held for the load guard, then for the slot held by another worktree; each prints no `Idle` line, no `Outstanding:` group for those files, and names the wait once, in the `Slow tier:` line. Then the control: a fast file queued with nothing running still prints its `Outstanding:` queued group.

Owns the new test file only. Leave alone: every `src/` file (a needed product change is a finding for the coordinator, not an edit), 004-84's files, the board, the specs, `package.json` versions and `plugins/*/dist`. No `npm run build`.

Done when: the three cases pass on the baseline, and a mutation that puts the held slow files back into `Outstanding:` fails them (say how you checked); `npm run lint`, `npm run typecheck` and `squeal run --all --wait` green (paste its output).

## Review of cand/0.1.235

Use /reviewer. Shape: review. Pinned to the `cand/0.1.235` SHA named in the spawn; the range is from the base named there to that SHA. It holds 004-84 (four commits), 004-85 (one test commit), the coordinator's D3 amendment and `status.md` line, the release commit (0.1.235 and the bundles) and this section, all cherry-picked with `-x`. Key format 20 is expected unchanged.

Read rows 004-84 and 004-85, the sections above, D2 and D3 as amended 2026-10-21, `status.md`'s 2026-10-21 line and both rows' `notes.md`. Check that:
- with two daemons under load above `slow.maxLoadPerCpu`, one past its budget and one fresh, the fresh one runs within one handover; with the slot free and the load high a file still defers; below the threshold nothing changes. The "most likely false" claim: that the slot probe (`slowSlotHeld`, which locks and releases each permit) never makes a daemon that holds or is taking the slot lose its turn or run a second file, and never leaves a permit or holder row wrong. Try to break it, with two real daemons if a probe needs them, in a throwaway repo with `HOME` and `XDG_*` pointed there;
- a marked waiter that takes the slot under load runs one file (D2's width) and carries no load note; time at the slot spends no `slow.maxDeferMs`;
- 004-85's tests pass on this candidate and fail when the held slow files return to `Outstanding:`;
- D3 as amended says what the code does.

Run `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4` once in the candidate tree; name each file that fails loaded and passes alone. Write `reviews/0.1.235.md` with a PASS or FAIL verdict and commit it.
