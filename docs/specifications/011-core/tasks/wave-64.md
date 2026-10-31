# Wave 64: row 011-288 (a notice is told only after its hook handed the text to the host)

Coordinator c1325b17, 2026-10-31. The human chose "A: Yes, all four tools" on 2026-10-31 (board row 011-288). Version 0.1.386 claimed. Host policy, as in `wave-60.md`: no local full suite, no `squeal run --all`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on every test command; private `/tmp` fixtures; never make CPU load on purpose; no `pnpm run build`; no real harness session under the real HOME. Not yours: the board, `spec.md`, `status.md`, bundles, version. Read affected results with `squeal status --wait 60000 <paths>`.

## W1: row 011-288

Use /worker. Shape: slice, design first.

Outcome: in Claude Code, Codex, Pi and OpenCode, a report's delivery is committed (the consumer view advanced) only after Squeal's hook has handed the whole text to the host within its deadline; a hook stopped before that leaves the report owed, and the next eligible boundary delivers it. A rare duplicate (handed over, then stopped before the commit) is accepted.

Read: `research/delivery-receipt.md` (all), `research/ci-opencode-continued.md` sections 2 and 3, and their probes; spec 011 C8; specs 002 D3 and D4, 008 D3 to D5, 009 D3 to D5, 012 CC2.

The rule, fixed: "handed to the host" means, per path, the last step Squeal itself controls: Claude Code and Codex, the hook's stdout (or the waiter's stderr) written and drained before exit; Pi, the host side received the worker's answer before its deadline; OpenCode, the plugin received the bridge's answer before its deadline. Squeal does not claim model receipt. Every delivery path that advances the view counts: tool boundary, turn start, Stop, idle wait, regression `peek`.

Seam and lead: `src/core/delivery/delivery.ts:260`, where the view is written inside the transaction before the delta returns; split it into a prepared report and an explicit commit the harness calls after the hand-off. The OpenCode and Pi hosts then need a second message (commit) to their bridge or worker; Claude Code and Codex commit in-process after the write.

First: write `tasks/011-288/design.md` (at most one page: the prepare/commit split, each adapter's commit point, what a duplicate looks like, the other "told" effects the research names and which of them move, concurrency between two boundaries), commit it, and send the coordinator a request with its path. Wait for the reply before code.

Owns: `src/core/delivery/**`, `src/harness/{shared,claude-code,codex,pi,opencode}/**` as the design needs, new or extended tests, `tasks/011-288/`. Leave alone: `src/core/scheduler/**`, `src/cli/**`.

Done when, red before and green after: for each of the four adapters, a test that holds the hook after the report is prepared and before the hand-off, lets the deadline expire, then reaches the next boundary: the transition arrives once, and the boundary after it does not repeat it; a normal delivery still commits once; the research's probes, reversed, pass. Existing delivery and adapter tests pass; lint and typecheck pass.

Stop and report if the rule needs a store schema change or a key change, or changes what a normal (not stopped) delivery prints.

## R1: row 011-281 (diagnosis: the crash/re-key test's re-run never ends)

Added 2026-10-31. Use /researcher. Shape: research, diagnosis only, about 30 minutes, no product edit.

Evidence: candidate CI 41219271687 attempt 1 (`gh run view 41219271687 --attempt 1 --log-failed`), Node 22 (3/3), `test/scheduler/runs.test.ts` "runs a file again when a batch during its crashed run gave it a new key". Row 011-281's phase trace names the stall: after run `c9d44faf` of `test/kill.test.ts` ends `crashed` at +801 ms, the re-run `414c9364` starts at +809 ms and never ends (open 129 s); `idle [after the crashing file's batch]` runs out at 99.6 s, then `scheduler.close` at 30 s. At the stall the harness reports 0 child processes, no scheduler error, and no run log for `414c9364`.

Question: what keeps `runner.run` for `414c9364` from settling when no child runs: the run never spawned (what it awaits before the spawn), or the child exited and its end was lost (which event or file the runner waits on)? Name the code path in the runner and the scheduler, and why a crash followed by a re-key reaches it. Tag findings as `docs/process.md` asks. Propose the smallest repair and the regression test that forces the path; implement nothing.

Read: the log above; row 011-281 and `research/ci-intermittent.md` section 3; `test/scheduler/runs.test.ts`, `test/scheduler/phase-trace.ts` and their fixture runner; the scheduler's run start and crash handling (`src/core/scheduler/`), the Vitest runner adapter it uses.

Write `research/ci-crash-rekey-stall.md`; probes under `research/probes/ci-crash-rekey-stall/`. Run the test at most 10 times locally, alone, below the host's CPU count in load; no CPU load on purpose.

## W2: row 011-289 (retire the Vitest instance after an unattributed worker crash)

Added 2026-10-31 from R1 (`research/ci-crash-rekey-stall.md`). Use /worker. Shape: repair, one or two commits.

Outcome: after a run whose report is `crashed` because of a worker error no test file accounts for, the Vitest adapter closes and drops that instance under its gate before another run can use it; the next run gets a new instance and completes. A crash's report and its empty results stay as they are.

Read: `research/ci-crash-rekey-stall.md` (all) and its probes; row 011-281; spec 011 C4 (runner) and the Vitest runner sections it cites.

Seam and lead: `src/runners/vitest/adapter.ts:618`, where an instance is retired for a hung execution, a module-loader failure, a rejected run or unloaded coverage; add the unattributed worker error that `buildReport` (`src/runners/vitest/run.ts:208`) turns into `end: crashed`. Keep the retirement's teardown bounded when Vitest's close does not settle.

Owns: `src/runners/vitest/**`, new or extended tests (the probe's blocking-child barrier in `test/scheduler/runs.test.ts` or a new file beside it), `tasks/011-289/notes.md`. Leave alone: `src/core/scheduler/**`, `src/core/delivery/**`, `src/harness/**`.

Done when, red before and green after: the probe's forced path (the child rewrites its file, is held until the real cancel call begins, then kills itself) gives `crashed`, then `completed` at the new key on a new instance, with bounded idle and cleanup; the existing crash/re-key test passes; lint and typecheck pass. No timeout raise, no shard retry, no change to keying or retry policy, no edit to Vitest.

Stop and report if the repair needs a scheduler change, or if a crashed instance's close cannot be bounded.
