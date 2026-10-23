# Wave 19 of spec 011

Three planned rows the coordinator chose on 2026-10-23 under the human's standing instruction ("If you are done with it before morning - grab the next piece yourself", 2026-10-22), from main with 0.1.271. The triage digest's rows (gh-64, gh-75 to gh-77) wait for the human. W2 is spec 006's; the coordinator runs it. Their files are disjoint, so they run in parallel. `src/core/scheduler/tiers.ts` is 3b94ca98's (row 011-120); no row here edits it. The candidate is 0.1.272 unless another lands first. No eval runs in this wave: the host-load measurement at 07:00Z must not overlap one.

## W1: 011-124, status names a claim only for a file that waits on it

Use /worker. Shape: slice.

Outcome: a queued file that is work an edit caused, or forced, under another worktree's claim of its key no longer reads `waiting for <worktree>'s run of its key`, since this daemon runs it; it reads what it really waits for. A file that does wait on the claim reads as before.

Read board row 011-124; `tasks/011-55/notes.md` ("Open for later rows" 2 and "Repair W5"); spec 011 C7 (claims) and C15 (the queued reasons).

Seam: `claimantOf` (`src/core/status/open-runs.ts`), called by `standing.ts:161` and `:374`. A lead: the scheduler's own test of whether a file may wait on a claim, `peekClaim` (`src/core/scheduler/claims.ts`, 0.1.271), read, not copied.

Owns: `src/core/status/standing.ts`, `open-runs.ts`, their tests, notes under `tasks/011-124/`. Not yours: `src/core/scheduler/` (ask before an export), `evals/` (W2), `src/core/daemon-loop/` and `src/core/daemon/` (W3), the board, spec text, bundles, version. No `npm run build`.

Done when: an edit's file and a forced file under a foreign claim read their real reason, and a waiting file reads the claim, in status and `--json`, by test; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted), their output in your summary.

## W2: 006-97, a terminated eval runner starts no process after its teardown began

Use /worker. Shape: slice.

Outcome: after SIGTERM, `run-cell` starts no session, ground-truth run or Squeal command, and nothing it started is alive when it exits.

Read board row 006-97; `006-model-evals/tasks/006-95/notes.md` ("Seen, not fixed"); spec 006 S2 as `status.md` records it (2026-10-11).

Seam: the signal handler in `evals/bin/run-cell.mjs` (the teardown, `:459`) and `runBounded` and `killRunning` in `evals/lib/session.mjs` (`:93`, `:167`). A lead: one flag the teardown sets that `runBounded` reads, so a start after it is refused.

Owns: `evals/bin/run-cell.mjs`, `evals/lib/session.mjs`, `test/evals/run-cell.test.ts`, `test/evals/fake-cell.ts`, their tests, notes under `006-model-evals/tasks/006-97/`. Not yours: the rest of `evals/`, `src/`, the board, spec text, bundles, version. Run the test files only. Never run a script under `evals/bin/` yourself, `--help` included: it starts a real run.

Done when: a test with the fake harness terminates the runner while the session ends and shows that no ground truth, `node --test` or `squeal` process starts after it and none is alive at exit; the S2 test still passes 10 of 10 beside a locked full suite; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted), their output in your summary.

## W3: 011-122, where `busy-edit.test.ts` spends its time after the lock frees

Use /worker. Shape: survey, then repair if small.

Outcome: the notes say where the time goes between the store lock freeing and the revision landing in `test/daemon/busy-edit.test.ts`, with each phase's time under load; then a fix, or the C9 sentence and the row a fix needs.

Read board row 011-122; `tasks/011-111/notes.md` ("`busy-edit.test.ts`, judged with this row"); `reviews/wave-2b.md` and `reviews/wave-4.md` (the 4,030 ms and 3,469 ms runs); spec 011 C9 on a busy store.

Seam: `src/core/daemon-loop/` (`head.ts`, `index.ts`), `src/core/daemon/sliced-writes.ts`, `src/core/scheduler/busy-resume.ts`, and the test's bound (`test/daemon/busy-edit.test.ts:37`). A lead: time each phase of the pass after the busy retry, beside a locked full suite, before any change.

Owns: `test/daemon/busy-edit.test.ts` and its helpers, notes under `tasks/011-122/`; a fix in `src/core/daemon-loop/`, `sliced-writes.ts` or `busy-resume.ts` only if it is small and the notes name the phase it removes. Not yours: `tiers.ts`, `src/core/status/` (W1), `evals/` (W2), the board, spec text, bundles, version. No `npm run build`.

Done when: the notes give the phases and their times from at least 10 runs beside a locked full suite; a fix, if any, shows the bound met 20 of 20 beside a suite, or the notes propose the bound or the C9 sentence and the row; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted), their output in your summary.

## R1: review of cand/0.1.272

Use /reviewer. Shape: review. Pinned to `cand/0.1.272` at e95d2b1c30d41e1eb3c5ee2eebc333c32215f126; the range is `1fa750ba5..e95d2b1c3` (`origin/main` at 1fa750ba5): W1's two commits (011-124, worker 4d01c305), W2's three (006-97, worker 720c25d1), one docs commit (011 C15, 006 D3, both `status.md` files), W3's three (011-122, worker 61519d18), its docs commit (011 C7, `status.md`) and the release commit (0.1.272, bundles).

Read this file (W1 to W3), the notes under `011-core/tasks/011-124/`, `006-model-evals/tasks/006-97/` and `011-core/tasks/011-122/`, board rows 011-124, 006-97 and 011-122 (and the rows they filed: 011-125, 006-98, 011-126), the amended 011 C7 and C15 and 006 D3 sentences, and the three new `status.md` lines. Check that:
- 011-124 (narrowed by the coordinator to option C, request 21691955): a queued file under another worktree's claim names the claim only with no result stored at its key; the store read writes no last use; a stale or unknown file keeps the claim; `pauseOnlyIds` follows; no type changed;
- 006-97: after SIGTERM nothing but the teardown's `squeal stop` starts; a refused start reads as could not start, never as a pass, in `runTurns` and the grader; `killRunning`'s wait stays bounded at 5 s; the exit is 128 + n on either path;
- 011-122: the test still measures an edit's revision and a heartbeat within 1,000 ms of the lock freeing; waiting for the baseline and timing from the writer's `freed` line hide no daemon defect the old test caught (the case it drops is row 011-126's); `src/` is unchanged; the probe under `tasks/011-122/probe/` reaches no real HOME and no watched tree;
- `test/keys/key-format.test.ts` passes with `KEY_FORMAT_VERSION` unchanged; the version is 0.1.272 in all eight places; the bundles match the tree; the four launchers are byte-identical.

Run `npm ci`, then the test files W1 to W3 added or changed, directly. Never run a script under `evals/bin/` or `tasks/011-122/probe/` yourself, `--help` included. The full suite is CI on the candidate and the coordinator's locked gate (`.ai/cezar/t/04a258b0/gate-w19.log`); a gate log names only failing files. `test/harness/pi/latency.test.ts` missed its p95 bound once beside W3's 20 runs (80.9 ms against 80). Write `reviews/0.1.272.md` under `docs/specifications/011-core/` with a PASS or FAIL verdict and commit it alone.
