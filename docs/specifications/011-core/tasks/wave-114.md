# Wave 114: class-A files wait with `rest()` (row 011-379)

Coordinator 4c0bbe28, 2026-11-16. Approved by the human on 2026-11-16 ("Idle sweep: Approve all"). Base: main at 0.1.524 (row 011-377 landed; it edited `test/scheduler/`, which this row waited for). Row 011-378 (the quiet point, in repair) runs beside this row; it already moved `drive-fixture.ts` and the builder of `fresh-worktree-durations.test.ts`: leave both alone, and leave every file row 011-378 changed.

Host policy, as in `wave-85.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on test commands; private `/tmp` fixtures; never the real `HOME`; never make load on purpose. Run vitest with a `timeout` and make sure each run ends; state the load with every timing. Stop your Squeal daemon before you finish and leave no process running. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, `package.json`, every `src/` file.

## W1: row 011-379

Use /worker. Shape: slice. Effort medium.

Outcome: the survey's A1 files wait with `rest()` (the harness's, the side's or the scheduler's) instead of `Scheduler.idle()`, each ending at the same point as before.

Read: board row 011-379; `tasks/011-371/survey.md` ("Method", "Pilot", the A1 list). Class A needs no quiet point (row 011-378).

Lead: the survey's A1 list (25 files) less `fresh-worktree-durations.test.ts` (row 011-378 moved it through `drive-fixture.ts`), plus `group-lanes-fixture.ts` and `wall-fixture.ts`. Each call `x.scheduler.idle()` becomes the matching `rest()`; nothing else changes. Run each file 3 times (one pass is not evidence, survey "Method" 2). A file that fails or whose wait now ends early is class B after all: revert it, and list it in the notes with the failure for row 011-380.

Owns: the A1 files and the two fixtures. Done when: each moved file passes 3 of 3 (load stated); `git grep -n "scheduler\??\.idle(" ` over the moved files shows none; `tasks/011-379/notes.md` lists each file moved or sent to row 011-380; lint, typecheck and `squeal status --wait 60000` on the changed paths.

## R1 (wave 113 W1 repair and wave 114 W1): review of cand/011-378-379

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/011-378-379` at `7b47e2d0b9e9a25ea8c069c8643ea945b2a3bc25`; candidate CI run 43916532418. Test files and notes only: no `src/` change, no version raise. Range `9513eb5c9..7b47e2d0b9e9a25ea8c069c8643ea945b2a3bc25`: worker 312a691f's seven first-round commits (row 011-378, unchanged) and its repair (`11ee4c5dc`, `d23d316c3`), then worker f3c9eb6b's one commit (row 011-379, `56fe9425d`), cherry-picked without conflict.

Two parts:

1. **Row 011-378, narrow re-review** against `reviews/011-378.md` B1. Read that review and `tasks/011-378/notes.md` "Repair after review 011-378". Check, as proven, plausible or unverified: `quiet()` rests again at the next call end or after 20 ms while a call is open, so a call the scheduler abandons during the wait no longer holds it; runs are still always waited for; no virtual time moves to a bound; `quiet-point-abandon.test.ts` failed before the fix on both clocks; the changed helper case (a rest after the run ended, not exactly two rests) keeps its meaning; `nextEnd(ms)` leaves no subscriber behind.
2. **Row 011-379, first review.** Read board row 011-379, this file's W1 and `tasks/011-379/notes.md`. Check: each of the 22 files and two fixtures changes only `scheduler.idle()` to the matching `rest()`; each wait ends at the same point as before (survey class A); the files left out (`fresh-worktree-durations`, `runtime-files-slow`, the three `group-lanes-*` with no call of their own) are right to leave out.

Coordinator at the candidate: lint, typecheck; both quiet-point tests, the model test and five A1 or pilot files pass (38 tests, load 6). Workers: row 011-378's 71 files one clean round (321 tests) and its probe (353 calls, all at the same point); row 011-379's 23 files 3 of 3 at load 8. CI is the full suite. Host policy as in `wave-85.md`; never the real `HOME`; run vitest with a timeout; leave nothing running. Write `reviews/011-378-379.md` and commit it on your branch.
