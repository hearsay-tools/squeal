# Wave 15: slow-slot fairness under the load guard, and the status line that names the wait (004-84, 004-85)

The human, 2026-10-21: take 004-84 and 004-85 after 011-29 ships. Spec: D2, D3 and D8 (`spec.md`), 011 C6 as amended 2026-10-20. Board rows 004-84 and 004-85 hold the evidence and the contract.

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

Briefed after 011-29 lands. 011-29 removes `src/core/status/work-line.ts`, which printed the `Idle:` line, and leaves slow files the `Slow tier:` line counts out of `Outstanding:`. The row then needs its regressions over the landed text: every queued file slow and held for load, then for the slot, gives no `Idle` line and names the wait once; a queued fast file with nothing running keeps its line.
