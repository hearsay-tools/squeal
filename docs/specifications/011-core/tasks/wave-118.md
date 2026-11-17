# Wave 118: the pool's wait keeps its times on elapsed time (row 011-389)

Coordinator 4c0bbe28, 2026-11-17. Approved by the human on 2026-11-17 ("Row 389: Approve"). Base: main at 0.1.529. The candidate takes the next version after coordinator 4d2ecbfc's 0.1.530 (the number is settled with the live coordinators before the raise).

Host policy, as in `wave-85.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on test commands; private `/tmp` fixtures; never the real `HOME`; never make load on purpose. Run vitest with a `timeout` and make sure each run ends; state the load with every timing. Stop your Squeal daemon before you finish and leave no process running. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, `package.json`.

## W1: row 011-389

Use /worker. Shape: slice. Effort medium.

Outcome: after a calendar set-back or set-forward, the pool's wait (`PoolWaits` in `src/core/scheduler/pool-wait.ts`) shows fresh gate fields, refreshes its row on time and never logs negative seconds; the stored row keeps its shape and its calendar `since` and `at` for status.

Read: board row 011-389; `tasks/011-386/notes.md` "Effects and limits"; `reviews/0.1.529.md` (the pool probe); `tasks/011-377/notes.md` (Design: how wait owners keep elapsed time or move their kept times by a calendar step); `src/core/scheduler/calendar-steps.ts`.

Lead: test first, on the virtual clock with `shiftCalendar`: a refusal, a 1 h set-back, more refusals (today: old gate fields kept, negative seconds in the grant log), and a 1 h set-forward (today: a new wait starts). Then keep `last` and `#publishedAt` (the refresh and freshness limits) on elapsed time, or move them by the step as row 011-377's owners do; `since` stays the stored calendar fact. Owns: `src/core/scheduler/pool-wait.ts` and its tests (`test/scheduler/calendar-steps-rows.test.ts` or a new file). Leave alone: `src/core/capacity/` and `local-permits.ts` (card 10; `SLOT_WAITER_FRESH_MS` is theirs to read, not to change).

Done when: row 011-389's done-when; the new cases failed before; behaviour without a calendar change unchanged (no status payload, note text, CLI output or key change); `key-format` without a raise; lint, typecheck, `squeal status --wait 60000` on the changed paths (report pending as pending); `tasks/011-389/notes.md`.

## R1 (W1): review of cand/0.1.531

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/0.1.531` at `73d25081b1932068cffc8e06495f0954bf6eda72`; candidate CI run 43978473588. Range `ee39fb9da..73d25081b1932068cffc8e06495f0954bf6eda72` (main at 0.1.529): worker 36ba3ab8's four commits (row 011-389: a red test commit, the fix, notes), cherry-picked without conflict, then the 0.1.531 raise and bundles (0.1.530 is coordinator 4d2ecbfc's, in review). Read: board row 011-389; this file's W1; `tasks/011-389/notes.md`; `tasks/011-386/notes.md` "Effects and limits"; `reviews/0.1.529.md` (the pool probe).

Check, each as proven, plausible or unverified:

1. **Elapsed time.** `PoolWaits` counts its 30 s freshness limit, its 10 s refresh and the grant line's seconds on elapsed time (`PoolWaitsOptions.elapsed`, a new `began` per wait); after a 1 h set-back the row shows the latest gate and the grant logs positive seconds; after a 1 h set-forward the wait goes on with one start line; a real 31 s gap together with a set-back still makes two waits. The three cases failed on the old code.
2. **What stays.** `since` and the row's `at` stay calendar time; the row shape and readers are unchanged; with no calendar change there is no extra write, and nothing a user sees changes.
3. **The extra write after a step** (a refusal rewrites the row when calendar moved 100 ms or more against elapsed since the last write): needed, bounded, and not a write loop.
4. **`scheduler.ts`** changes one line (`elapsed: this.#clock.elapsed`), outside the brief's files; nothing else there.

Coordinator at the candidate: lint, typecheck, `check:version origin/main` (0.1.529 to 0.1.531); `key-format` 12/12 alone; `version-sensitive`, `calendar-steps-rows`, `pool-wait`, `status-wait-pool`, `one-loop-source`, `clock-change` 35/35 at load 16. Worker: 6 files 40 tests at load 50 to 83. CI is the full suite. Host policy as in `wave-85.md`; never the real `HOME`; run vitest with a timeout; leave nothing running. Write `reviews/0.1.531.md` and commit it on your branch.
