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

## Q1: 011-236, quality scan of 011's work from 0.1.299 to 0.1.318

Use /quality. Row 011-236 in `docs/board.md`.

Scan spec 011's landed work from `squeal--v0.1.298` to `squeal--v0.1.318` against `docs/vision.md` and `docs/styleguide.md`. Leave the commits of specs 015 and 016 and of gh-96 out (0.1.299, 0.1.305, 0.1.312, 0.1.313, 0.1.316, 0.1.317 are theirs; 0.1.311 holds 015-47 beside 011's rows). 011's releases: 011-196 and 011-199 (0.1.304), 011-198, 011-200 and 011-202 (0.1.307), 011-195 and 011-203 (0.1.311), 011-204 (0.1.314), 011-205 and 011-206 (0.1.318); tests-only and docs rows in the stretch are on the board. The previous scan is `quality/2026-10-25.md` (0.1.287 to 0.1.298); do not repeat its candidates unless they changed.

Look in particular at: the selection's verdict and reason code (`src/cli/named-selection.ts`, `verdict.ts`, `status-wait-lines.ts`) beside row 011-233's finding (`research/source-path-selection.md`); the committed-file recovery (`src/core/watcher/candidates.ts`, `change-feed.ts`); the model fixture of 011-195; spec and `status.md` text that no longer says what the code does.

Write `docs/specifications/011-core/quality/2026-10-26-a.md` in the form of the previous scan: drop candidates, proposed rows, slices. Commit it. Never edit the board. Never run a script under `evals/bin/` or `tasks/*/probe/`, and never open a live store, socket or permit pool.

## Q2: 011-237, quality scan of 011's work from 0.1.319 to 0.1.333

Use /quality. Row 011-237 in `docs/board.md`.

Scan spec 011's landed work from `squeal--v0.1.318` to `squeal--v0.1.333`, and main up to `be1fda00e` for 011-217, against `docs/vision.md` and `docs/styleguide.md`. Leave the commits of specs 015 and 016 out (0.1.320, 0.1.321, 0.1.323, 0.1.324, 0.1.326, 0.1.327, 0.1.330 are theirs). 011's releases: 011-212, 011-214, 011-216, 011-218 (0.1.319); 011-207, 011-211, 011-220 (0.1.325); 011-213, 011-215 (0.1.328); 011-226, 011-227 (0.1.329); 011-209, 011-224, 011-225, 011-228 (0.1.331); 011-201, 011-219, 011-230, 011-231 (0.1.332); 011-221, 011-222, 011-229, 011-232 (0.1.333). Q1 scans the stretch before it; do not overlap.

Look in particular at: the yield-history files of 011-209 (`src/core/scheduler/yield-history.ts`, `yield-row.ts`, `standing-yields.ts`, `tier-text.ts`); the retry request history and its one-run rule (`src/core/retry/records.ts`, `kept.ts`, rows 011-207, 011-224) after three review rounds; the full check (`src/core/daemon/full-check.ts`, 011-226, 011-229, row 011-235); the "a signalled file is never completed" rule in two runners (`src/runners/node-test/run/run.ts`, `src/runners/pytest/run/run.ts`) and Vitest's `buildReport`, and whether it should have one owner; the model fixture's length (011-221's notes); spec and `status.md` text that no longer says what the code does.

Write `docs/specifications/011-core/quality/2026-10-26-b.md` in the form of the previous scan. Commit it. Never edit the board. Never run a script under `evals/bin/` or `tasks/*/probe/`, and never open a live store, socket or permit pool.
