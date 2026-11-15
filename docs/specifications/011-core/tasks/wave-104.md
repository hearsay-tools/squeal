# Wave 104: close the gaps card 7 left (rows 011-362, 011-364, 011-361)

Coordinator 4c0bbe28, 2026-11-15. The human approved rows 011-358 to 011-371 on 2026-11-15 ("Start working on those. Start with the ones that show gaps in the architectural changes we were making."). This wave takes the gaps in card 7's own goals (one timer, time as an input, pure decisions); rows 011-365 and 011-366 (the step's adapter and the four decisions still outside it) follow in wave 105, because they cross `scheduler.ts` with this wave. Evidence: `../quality/2026-11-15-card-7.md` (S1, R1), `../reviews/0.1.514-r2.md` (the claims note).

Host policy, as in `wave-85.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on test commands; private `/tmp` fixtures; never the real `HOME`; never make load on purpose. Run vitest with a `timeout` and make sure each run ends (an orphaned run spun for 2 hours on 2026-11-15). Run the model test only when the one-minute load is below the CPU count; the host is loaded by another project tonight. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, the `package.json` version, `KEY_FORMAT_VERSION`. Behaviour preserved: no tier, order, width, status payload, note text, CLI output or key change.

## W1: rows 011-362 then 011-364

Use /worker. Shape: slice. Effort high.

Outcome: no scheduler owner can run a wake loop or a clock of its own: every owner takes the scheduler's `Wakes` and clock, and a source test keeps it so.

Read: board rows 011-362 and 011-364; the quality file's S1 and R1 (it lists the six fallback loops and five `hostNow` defaults with lines); `tasks/011-351/notes.md` and `tasks/011-352/notes.md` (why the defaults exist).

Seam, 011-362 first, test first: `refinement.ts:99-101` builds `new RunnerPartBound(ms)` with no `wakes` or `now`; a scheduler-driving test on the virtual clock shows the bound firing only on the host clock (or `rest()` missing its wake), then the fix is `runnerPartBound(context)`. Commit. Then 011-364: make `wakes` and `now` required in the modules R1 names, drop `TierYields`' `recheck` default, `check`'s `held = false` and `SlowReleaseHost.endedAt?` if only tests use them; tests that build an owner pass `new Wakes(virtualClock(...))`; add a source test beside `untracked-promises.test.ts`: no `new Wakes(` outside `scheduler.ts` (and test helpers), no `hostNow`/`hostClock` outside `clock.ts`; it fails on a planted fallback.

Owns: the modules R1 lists (`command-hold.ts`, `hold.ts`, `runner-work-bound.ts`, `slot-records.ts`, `slow-release.ts`, `keying.ts`, `mutex.ts`, `promotions.ts`, `context.ts`, `record.ts`, `refinement.ts`), in `yields.ts` only the `TierYields` constructor and `check` signature, in `scheduler.ts` only the lines that build owners, and the direct-construction tests R1 lists plus the new source test. Leave alone: the body of `TierYields.check` and `decide-yields.ts` (W2), `busy-resume.ts`, `store/busy.ts`, `local-permits.ts`, `src/core/capacity/` (cards 9, 10), `record-tier.ts`.

Done when: rows 011-362 and 011-364 hold (their done-when on the board); the grep for `?? new Wakes(` and `= hostNow` under `src/core/scheduler/` is empty (paste it in `tasks/011-362/notes.md`, one notes file for both rows); `key-format` passes without a raise; lint, typecheck and `squeal status --wait 60000` on the changed paths pass; report pending checks as such.

## W2: row 011-361

Use /worker. Shape: slice, test first. Effort high.

Outcome: either a failing test proves that a claim changed by another worktree between `decideYields` and its apply gives a visible wrong result, and the apply then uses the facts the decision read; or the notes show why no visible result can change, and the row closes without a code change.

Read: board row 011-361; `../reviews/0.1.514-r2.md` (the nonblocking note); `tasks/011-354/notes.md` "Repair after review 0.1.514"; `yields.ts` (`TierYields.check`, the bookkeeping replay), `decide-yields.ts`, `claims.ts` (`Claims.peek`, `readClaim`, `holds`).

Seam: a two-worktree test on a shared scratch store: worktree A's scheduler decides a yield while B commits a claim change before A applies; assert what A's yield or claim wake does. Lead: a hook between decide and apply in a unit test of `TierYields.check` first, then the real two-worktree case only if the unit test shows a difference.

Owns: the body of `TierYields.check` and its apply in `yields.ts`, `decide-yields.ts`, `yield-waits.ts`, read-only helpers in `claims.ts`, new tests. Leave alone: everything W1 owns (the `TierYields` constructor and `check` signature included; if you need a signature change, message the coordinator).

Done when: row 011-361's done-when holds; `tasks/011-361/notes.md` gives the verdict (proven, with the fix; or refuted, with the reason) and the test; `key-format` passes without a raise; lint, typecheck and `squeal status --wait 60000` on the changed paths pass.

## R1 (W1 and W2): review of cand/0.1.517

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/0.1.517` at `12b18d6344265541413c8cbbd5ec5819a9cb8c9d`; candidate CI run 43770714637. Range `cd9f098d4..12b18d6344265541413c8cbbd5ec5819a9cb8c9d`: worker 35c1f661's five commits (rows 011-362, 011-364), worker a06177b0's two (row 011-361), cherry-picked without conflict, the 0.1.517 raise and bundles, then one coordinator integration fix (`12b18d634`: the new 011-361 test builds `TierYields` with the loop and passes `check`'s `held` flag, which 011-364 made required). Read: board rows 011-361, 011-362, 011-364; this file's W1 and W2; `tasks/011-362/notes.md`, `tasks/011-361/notes.md`; `../quality/2026-11-15-card-7.md` (S1, R1); `../reviews/0.1.514-r2.md` (the claims note).

Check, each as proven, plausible or unverified:

1. **011-362.** A revision's runner-part bound arms on the scheduler's wake loop and clock; the new test fails without the fix; `rest()` sees the bound.
2. **011-364.** No owner under `src/core/scheduler/` can build a wake loop or default to the host clock (the grep in the notes); the new source test fails on a planted fallback; `daemon-keys.ts` is the one named exception with its reason; `Promotions` gets its clock at construction with no throw path (coordinator reply); no production caller relies on a removed default; behaviour preserved.
3. **011-361.** The race is real as the notes describe it (a claim committed between `decideYields` and the apply gives a yield about 500 s early), the hook test reproduces it and fails without the fix, `Claims.record` with the decision's fact gives the same state as `Claims.holds` for the same facts, and nothing else in claim timing changes.
4. **Behaviour preserved** apart from the 011-361 fix: no tier, order, width, status payload, note text, CLI output or key change.

Coordinator at the candidate: lint, typecheck, `check:version origin/main`; direct runs of `key-format`, `version-sensitive`, `yield-replay-race`, `decide-yields` pass. `runner-part-bound.test.ts` failed once in a parallel run at load 96 and passed 3 of 3 alone (row 011-360's known flake). Squeal was starved by another project's load (about 100 on 24 CPUs); worker evidence: W1 34 related files direct, W2 31 files (165 tests) direct. Also seen at that load: `status-wait-paused` "after 0.7 s" instead of 0.6 s, `repository-inputs` setup past its 60 s limit (it also fails at base `cd9f098d4`). CI is the full suite. Host policy as in `wave-85.md`; never the real `HOME`; run vitest with a timeout; run the model test only below the CPU count. Write `reviews/0.1.517.md` and commit it on your branch.
