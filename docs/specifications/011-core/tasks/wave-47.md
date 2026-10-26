# Wave 47

From main after 0.1.333 (`d5764425b`), 2026-10-26. W1 is a test-only row that needs no decision; rows 011-234, 011-235 and gh-99 wait for the human's card and join this wave as W2 and later when approved. Host load is about 8 to 12 on 24 CPUs. Verification follows `docs/process.md`, "Test runs on a shared host" (2026-10-25): no `squeal run --all` and no local full suite.

## W1: 011-217, the slots overhead bound against CI's measured spread

Use /worker. Shape: repair. Row 011-217; row 011-99's notes.

Outcome: the bound in `test/scheduler/backlog-slots-overhead.test.ts` test 3 is set from the ratio measured on CI and here, or what moved the ratio toward 5 since 011-99 is named.

Seam: the bound at `test/scheduler/backlog-slots-overhead.test.ts:93`, `bestCpu(slots) <= bestCpu(tiers) * 5`. First step: read the ratio the test prints from the logs of main's last ten CI runs (`gh run view <id> --log`, Node 22 and Node 24 jobs) and from this host, the test file alone, ten runs, with the load stated.

Owns `test/scheduler/backlog-slots-overhead.test.ts`. Not yours: `src/`, other tests, the board, spec text. A cause in `src/` is a request to the coordinator and becomes its own row.

Done when the comment gives the measured spread on CI and here; the bound still fails at 20 ms more daemon CPU a slot (011-99's check; paste that run); the new bound holds for every one of the ten CI values.

## All workers

Run lint and typecheck, then `squeal status --wait 60000 <changed paths>`, with `env -u PLUGIN_ROOT -u PLUGIN_DATA`, and paste the output. Squeal's selection of a source path can miss readers (row 011-233): run a changed test file directly when its result is not current, and say so. Write `tasks/<row>/notes.md` with the cause, the evidence and the commits. Make no CPU load on purpose.
