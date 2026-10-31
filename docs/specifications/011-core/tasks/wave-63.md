# Wave 63: the red main after 0.1.384 (011-285), gh-130 option A (011-286), the OpenCode nightly miss (011-284)

Coordinator c1325b17, 2026-10-31. Three rows on disjoint seams; all run in parallel. Version 0.1.385 is claimed for 011-286; 011-285 changes no bundle and lands without a version raise.

Host policy, as in `wave-60.md`: no local full suite, no `squeal run --all`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on every test command; private `/tmp` fixtures; never make CPU load on purpose; no `pnpm run build`. Not yours: the board, `spec.md`, `status.md`, bundles, version. Read affected results with `squeal status --wait 60000 <paths>`. No timeout raise and no retry as a fix.

## R1: review of row 011-285 (test fix for ci-41205434002)

Use /reviewer. Shape: review of `cand/011-285` at the exact SHA the coordinator names, one commit on `origin/main`.

Diagnosis (coordinator): in `test/scheduler/backlog-quiet-exempt.test.ts` 4b the promoted file's tier is a batch's (row 011-268), so the backlog's turn is due at once and starts during the quiet wait. The test read `turnAfter` after the promoted file became current; when that read came before the post-batch turn started, it counted that turn and the turn after four edit tiers: 2, the CI message. A local copy that reads `turnAfter` right after the promoted run reproduces it; the unforced copy passes. The order is C4 step 4 as amended for 011-268 and exists since 0.1.378.

Check: the diagnosis against `src/core/scheduler/tiers.ts` (`postBatch`) and `queue.ts` (`batchSelected`), and that the repair removes the race without hiding a product defect (a backlog tier after the edit's work, which the test must still catch). Write `reviews/011-285.md`.

## W1: row 011-286 (gh-130 option A: a synced wait with current selected results returns its verdict despite a late heartbeat)

Use /worker. Shape: slice, one or two commits.

Outcome: when a named wait's own sync succeeds (the daemon has listed every edit up to the wait's revision) and every selected file has a current result, `squeal status --wait` returns that verdict (text, JSON, exit code) even when the heartbeat has lapsed.

Read: board row `gh-130` (the human's decision, option A); `research/issue-130.md` (findings 1 and 2); spec 011 C6, C9 and C15; `tasks/011-276/notes.md`.

Seam and lead: `src/cli/status-wait-paths.ts:262`, `ready` requires `daemon.state === "alive"`; admit a lapsed daemon there when `current.state === "synced"`, `all.revision >= current.revision`, nothing unlisted and every selected file is current. Then `selectionResult` in `src/cli/verdict.ts:197` must not return `lapsed` for that read; carry the fact on `SelectionRead`, do not weaken the `lapsed` check for other reads. Keep the lapse sentence out of a clean verdict, or say it beside the verdict, your call; state it.

Unchanged: a socket that only accepts a connection proves nothing (exit 3, `lapsed`); unsynced, unlisted, pending, no-daemon, on-hold, paused, focused keep exit 3. No change to `wait-liveness.ts`'s alive/down judgement, the daemon, keys or the scheduler.

Owns: `src/cli/status-wait-paths.ts`, `src/cli/verdict.ts`, `src/cli/no-verdict-lines.ts` if wording needs it, new or extended tests under `test/cli/`, `tasks/011-286/notes.md`. Leave alone: `test/scheduler/**`, `test/harness/opencode*` (R1, R2).

Done when, red before and green after: a synced daemon with a held-old heartbeat and current selected passes returns pass, exit 0; the same with one selected file failing returns fail; an accepting socket that never answers sync keeps exit 3 `lapsed`; an unsynced edit during a lapse keeps exit 3; recovery after the lapse still passes. Existing `test/cli/selection-result.test.ts`, `slow-wait-liveness`, `status-wait-*` tests pass; lint and typecheck pass.

Stop and report if the rule needs a daemon or store change, or changes any exit code beyond this case.

## R2: row 011-284 (diagnosis: the OpenCode continued-turn test missed its second notice)

Use /researcher. Shape: research, diagnosis only, about 30 minutes.

Question: why `test/harness/opencode-continued.test.ts` "serve: a continued turn whose edit flips a check before its idle ends silent" failed `expected 1 to be 2` after "Matcher did not succeed in time" (38.9 s) in Node 24 nightly CI 41190295201 on `6ceaf9b85`, once; the push run and other nightlies passed.

Read: the failed job's log (`gh run view 41190295201 --log-failed`, and the full log around the test), the test, its fixture and the OpenCode plugin seam it drives (`plugins/opencode`, `src/harness/opencode*`); board row 011-284.

Answer: is it a timing bound in the test (name the wait and the step that ran long, with log timestamps) or a real missed notice (name the code path)? Tag each finding as `docs/process.md` asks. Propose the smallest repair and the test that proves it; implement nothing. Write `research/ci-opencode-continued.md`; probes under `research/probes/ci-opencode-continued/`. Run the test at most 5 times locally, alone, below the host's CPU count in load.

## W2: row 011-287 (keep the first idle's evidence when the OpenCode continued-turn poll fails)

Added 2026-10-31 from R2 (`research/ci-opencode-continued.md`, section 3). Use /worker. Shape: slice, test code only, one commit.

Outcome: when an `afterReply` callback in the OpenCode fixture throws (the line-90 poll of `test/harness/opencode-continued.test.ts`), the failure message carries what decides the cause; the assertion and every bound stay as they are.

Read: `research/ci-opencode-continued.md` (sections 1 to 3), its probe `research/probes/ci-opencode-continued/deadline.probe.ts`.

Seam and lead: `test/helpers/opencode.ts:215`, where `afterReply` races the deadline, and `:240`, where the fixture directory is removed and the error rethrown. Wrap the rethrown error with the provider's request log, OpenCode stderr, and the store's consumer view and turn state for the session, read before cleanup. Plugin idle and bridge timings: add them only if the plugin already logs them to a file the fixture can read; do not add product logging.

Owns: `test/helpers/opencode.ts`, a new fixture test under `test/harness/`. Leave alone: `src/**`, `test/cli/**`, `test/scheduler/**`, the continued-turn test's assertions.

Done when: a fixture test whose `afterReply` throws on purpose shows the request count, stderr and consumer view in the thrown message, and the fixture directory is still removed; the two continued-turn tests pass unchanged; lint and typecheck pass.

## R3: row 011-288 (research: can a notice be lost after its delivery commit in every harness?)

Added 2026-10-31: the human chose "C: Research first" for row 011-288. Use /researcher. Shape: research, about 30 minutes, no product edit.

Question: after `delivery.onToolBoundary` (or any delivery path) marks a report as delivered (`src/core/delivery/delivery.ts:260`), can the report fail to reach the agent in Claude Code, Codex and Pi, as it can in OpenCode when the bridge misses its 500 ms deadline? For each harness name the step between the commit and the agent reading the text (hook stdout, a host timeout, a killed process, a dropped message) and whether a deadline or kill can fall in that gap.

Read: `research/ci-opencode-continued.md` (sections 2 and 3) and its probe; board row 011-288; spec 011 C8; specs 002 (Codex), 008 D3 to D5 (OpenCode), 009 (Pi), 012 (Claude Code) hook contracts; `src/harness/**`, `src/core/delivery/**`.

Answer: per harness, whether the gap exists (tag each finding as `docs/process.md` asks; a host's documented hook timeout counts as `read in official docs`), how likely a deadline is to fall in it, and the smallest rule that closes it everywhere: report the receipt before marking delivered, or deliver again at the next boundary when receipt is unknown. Say what a duplicate notice would look like to the agent in each harness. Write `research/delivery-receipt.md`; probes under `research/probes/delivery-receipt/`. Probes run in `/tmp` fixtures only; no real harness session under the real HOME.
