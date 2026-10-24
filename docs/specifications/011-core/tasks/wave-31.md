# Wave 31

From main after 0.1.291. Two test repairs of load flakes that fail reviewers' locked runs on a busy host, plus the 011-139 research while the host is busy. Disjoint files; run side by side. The two repairs go into one candidate; the research lands as docs.

## W8: 011-142, the pytest validity case decides what completes before the kill by control, not by time

Use /worker. Shape: repair (test).

Outcome: "a batch past Squeal's deadline completes nothing after the kill" gives the same comparison on every run, at any load.

Read board row 011-142; `tasks/011-175/notes.md` sections 3 and "For whoever continues" (the same kind of repair for Vitest: wait on proof, not on time); `reviews/0.1.291.md` (it failed again there at load 94, with one worker: "first.py completed on one leg only").

Seam: the case in `test/keys/validity/cases/adapter/pytest.ts`, its run loop in `test/keys/validity/harness/pytest.ts`, the test at `test/keys/validity/pytest.test.ts:34`. A lead: make the fixture say when the file before the deadline has reported, and kill only after that, so which file completes no longer depends on elapsed time.

Owns those three files and `tasks/011-142/`. Not yours: `src/`, the Vitest validity files, `test/scheduler/` (W9), the board, spec text, bundles, version. If the fix needs `src/`, stop and send me a request. No `npm run build`.

Done when the row's done-when holds (20 runs beside load above 24, and the comparison still catches a candidate that completes a file after the kill); lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Make your own load with bounded loops, as `tasks/011-175/notes.md` did. Paste the output.

## W9: 011-178, `backlog-slots.test.ts` checks the slot schedule by events, not by the wall clock

Use /worker. Shape: repair (test).

Outcome: the two 011-21 checks in `test/scheduler/backlog-slots.test.ts` (the makespan within 15% of list scheduling, line 64; the waiter's share within one slot's file plus 1 s, line 137) fail only when the schedule is wrong, not when the host is loaded.

Read board row 011-178; `tasks/011-21/` (the slot design and what each bound guards); `reviews/0.1.291.md` (both failed at load 34 to 94, also with one worker).

Seam: `test/scheduler/backlog-slots.test.ts:55-70` and `:125-140`. A lead: assert what the bound stands for (no slot idles while a file is queued; the waiter is granted at the next slot release) from the run's own start and end records, and keep a wall-clock bound only as loose as a loaded runner needs.

Owns `test/scheduler/backlog-slots.test.ts`, `tasks/011-178/`. Not yours: `src/`, `test/keys/` (W8), the board, spec text, bundles, version. If the fix needs `src/`, stop and send me a request. No `npm run build`.

Done when the row's done-when holds; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.

## R: 011-139 research, the permits and cores edit tiers take on a busy host

Use /researcher. Shape: research.

Outcome: a measurement of how many pool permits and busy cores Squeal's edit tiers take while the host has 18 or more busy cores, and a proposed cap or a reason not to cap.

Read board row 011-139; `research/host-load/2026-10-23.md` and `2026-10-24.md`; `research/probes/host-load/README.md`; 011-98's CPU gate (board row and its notes); 011 C4.

Method: sample now, while the host is busy (load about 80 on 24 CPUs at 11:30Z, mostly the cezar project's tests). Read processes from `ps` and `/proc` only: per Squeal daemon and its Vitest workers, the worktree, the tier kind if its log says, CPU and nice. Copy a store with its `-wal` and `-shm` before reading it. Never connect to a live daemon socket or the live permit pool, and never run a script under `evals/bin/`. Record the load beside every number.

Owns `research/host-load/011-139.md` and `research/probes/host-load/011-139/`. Not yours: `src/`, `test/`, the existing probes, the board, spec text.

Done when the file names, per sample, the permits and cores each project's edit tiers held, how often one worktree held every permit, and the proposed cap with what it would cost an edit's wait; commit it.

## W10: 011-179, the validity comparison runs in time and cleans up inside its hook under load

Use /worker. Shape: repair (test). Added 2026-10-24 from W8's report; starts from `cand/w31` (`5c8610e0d`), which holds W8's new comparison.

Outcome: `test/keys/validity/pytest.test.ts:34` takes under half its 300 s timeout at load 50, with the same outputs, and its work directory's removal never times out a passing file.

Read board row 011-179; `tasks/011-142/notes.md` (sections 4 and 5: the 266 s, 631 s and hook-timeout figures, and the serial cause).

Seam: the drivers run in turn at `test/keys/validity/harness/sides.ts:142` (`spawnSync`), each running its cases in turn; the removal is the `afterAll` at `test/keys/validity/self-test.ts:80`. A lead: run the two sides, or the drivers, at once with a bound, and remove the work directory asynchronously after the hook returns, or per comparison as each ends.

Owns `test/keys/validity/harness/sides.ts`, `test/keys/validity/harness/compare.ts` if the comparison lives there, `test/keys/validity/self-test.ts`, their tests, `tasks/011-179/`. Not yours: the pytest case and harness and `pytest.test.ts` (011-142, in review), `src/`, the board, spec text, bundles, version. If the fix needs `src/`, stop and send me a request. No `npm run build`.

Done when the row's done-when holds: the line-34 test's time alone at load about 50 before and after, the alarm's verdicts unchanged on every validity test file, the removal inside its hook at load near 99 or off the hook, nothing left behind; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.
