# Wave 85: rows 011-331, 011-332 and 011-333

Coordinator cdd216e5, 2026-11-14. The human's answers of 2026-11-14 to the card after row 011-327: "Approve, start now" (status-waits-join, now 011-331), "Reproduce now" (group-wait-edits, now 011-332), "Diagnose now" (ci-43472769648, now 011-333), and "Approve the row" (run-adjacent-reads-busy, now 011-334, after 011-328). The three rows here run in parallel: one worker in `src/cli`, two researchers who change no product code.

Host policy, as in `wave-83.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on every test command; private `/tmp` fixtures; never make CPU load on purpose; no probe or harness session under the real `HOME`. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, the `package.json` version.

## W1: row 011-331, the status waits join the wait module, behaviour preserved

Use /worker. Shape: slice, test first, one commit per step.

Outcome: `status --wait`, `status <path> --wait`, `status <path>` and the file wait of `run --slow --wait` take their polling, deadline, store read, daemon check and outcome from `src/cli/wait/`; no outcome, printed line, JSON payload (the `wait` payload included) or exit code changes.

Read: board row 011-331; `research/waits.md` (decisions 1 and 3, the coordinator's calls, "Not in scope"); `tasks/011-326/notes.md` and `tasks/011-327/notes.md` (how the run waits moved, and "For the next worker"); reviews `0.1.469.md`, `0.1.474.md`, `0.1.474-r2.md`; `GLOSSARY.md`, "Waits" and "Daemon".

Seam and lead: `waitForStatus` (`status-wait.ts`), `waitForNamed` (`status-wait-paths.ts`) and `readNamedSnapshot` (`status-paths.ts`) join `RUN_WAITS`' table as named waits. First edit: their pure rows in the table test, one per outcome, against today's code.

Rules (from rows 011-326 and 011-327):

- **Reads stay as they are.** Each wait reads only what it reads today, in today's order and timing: the settle time, the per-read busy timeout, the snapshot's raw heartbeat, the sync request.
- **One decision path.** The tests call the decision and loop the commands call.
- **Copies and differences.** A rule written in several places with the same effect becomes one rule; the five copies of "has the daemon's pass reached this read" (`isSynced`, `readiness`, the snapshot's `ready`, `unsynced`) are the first to check. A real difference is a named cell, never changed here. The raw SQL in `status-wait-listing.ts` and `anyPending`'s copy of `isPending` move with their wait unchanged.
- **Replace, don't layer.** Delete the decision cases the table replaces and name each in the notes.

Owns: `src/cli/wait/**`, `test/cli/wait/**`, `status-wait*.ts`, `status-paths.ts`, `named-print.ts` and `no-verdict-lines.ts` (imports), the status tests whose decision cases the table replaces.

Leave alone: `src/core/**`; `src/cli/code*.ts` (keep `STATUS_WAIT_SETTLE_MS` and `waitConsumer` exported from `status-wait.ts`, which `code.ts` imports); `wait-liveness.ts`; the run commands beyond an import; rows 011-44, 011-45 and 011-49 (planned); `KEY_FORMAT_VERSION`. Row 011-328 may land in `src/cli/wait/reads.ts` (`WaitFiles`) while you work; rebase onto it.

If some behaviour cannot be kept, keep it and name the case; ask the coordinator before any `src/core` change.

Done when: the row's done-when holds; lint and typecheck pass; `test/keys/key-format.test.ts` and `test/version-sensitive.test.ts` pass with no raise; affected results read through `squeal status --wait 60000 <paths>`. Notes in `tasks/011-331/notes.md`: the table, each copy made one rule, each difference and its cell, each deleted case mapped to its row. Your final message lists decisions the record did not settle, type changes, and any call that did not hold.

## R1: row 011-332, reproduce a missed edit before `run <group> --wait`

Use /researcher. About 30 minutes.

Question: can an edit made just before `squeal run <group> --wait` be missing from the group's verdict, that is, a verdict given at the revision before the edit? Decision 5 of `research/waits.md`, inferred from source: the status waits ask the daemon to store the edits made before the wait (lessons defect 30), and the run waits do not.

Method: a probe under `research/probes/group-wait-edits/` that starts a real fixture daemon as `test/cli/run-group-daemon.test.ts` does (private `/tmp` tree, never the real `HOME`), edits a source file of the group, at once runs `run <group> --wait`, and compares the verdict's revision with the edit's. Repeat it at least 20 times at the host's real load, and state the load per run. If the load falls below 1 per CPU during the session, repeat the runs there; otherwise say it did not. Never make load on purpose.

Write `research/group-wait-edits.md`: each finding tagged as `CLAUDE.md`'s research rules say, the counts, the loads, and what a fix would cost (the status waits' sync before the first read). Commit it with the probe on your branch.

## R2: row 011-333, find the writer behind the ENOTEMPTY cleanup failures

Use /researcher. About 45 minutes. Diagnosis only, no fix.

Question: what writes into a test's temporary directory after the test removes it? Three tests failed that way on CI in two days (board rows ci-43472769648 and ci-43160803419):
- `test/runners/node-test/run.test.ts` "reports nothing of a run stopped after the checkout holding its store went", `rmdir .../.git/squeal/runs/<id>/node-test/edge`, runs 43472769648 and 43485856699 (the test already retries the delete, `32c2dc0aa`);
- `test/harness/opencode-dispose.test.ts` "serve: input routed to the re-created instance drops the old turn's report", `run.cleanup()`, run 43498778395;
- `test/daemon/died.test.ts` "an ordinary note before the kill does not hide the death", `helpers.ts:137`, run 43160803419.

Sources: the CI logs (`gh run view <id> --log-failed`), the tests, their fixture helpers, and the writers that can outlive them (runner log writes, daemon processes, bridges). Cheap experiments: run each test alone a few times at the host's real load, with a wrapper that lists what is left in the directory when the removal fails.

Write `research/enotempty-cleanup.md`: per test, the writer (verified or inferred), whether the three share one cause, and a proposed fix with its owner, for example one cleanup helper that waits for the writers it started. Commit it with any probe under `research/probes/enotempty-cleanup/` on your branch.
