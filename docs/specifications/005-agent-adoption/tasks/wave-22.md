# 005 wave 22: Pi says its registration once; the wake-trace helper test does not depend on a sign

Row 005-107, a repair of 0.1.541 (row 005-98, decision C), found in main CI on 2026-11-18. Coordinator: session 4d2ecbfc. One worker.

Rules: no version raise, no `pnpm run build` in your worktree, no full suite. `test/e2e/**` is outside Squeal's coverage here: run each e2e file that reads a path you change directly, one at a time, `timeout 900`. A check that needs a commit ID is read from CI. Before you report, read Squeal's complete verdict on your changed paths. Write `~`, never a `/home/<user>/` path; the private-material check also rejects the company name and local project folder names.

## W1: 005-107

Use /worker. Shape: repair. Outcome: a Pi session reads its registration text exactly once when nothing was killed; and `test/helpers/pi-wake-trace.test.ts` passes whatever the sign of a 0 ms offset.

Evidence 1 (product). Main CI 44114276401, attempt 1, Node 22 (2/3): `test/e2e/pi.test.ts:116`, "the shipped Pi package, installed with pi install > print: starts the copy's daemon, which passes a baseline, and a PASS -> FAIL reaches the next request": `expect(mentions("registered at revision", start)).toBe(1)` received 2. So the first request carried the registration twice. Since 0.1.541 the Pi session start and the Pi run start register owing their header and clear it "through the held hand-off"; a registered run start says an owed header before `startTurn` (`tasks/005-98/notes.md`, review `reviews/0.1.541-r2.md`). Lead: in print mode the run start can find the header still owed while the session start's own text is on its way (the hand-off not yet taken), and says it again. Find the exact interleaving from the code and a test that forces it; do not guess from timing.

Contract (decision C, unchanged): the registration text reaches the session once; twice only when a start was killed between its output and its mark; never zero times. A run start replays an owed header only when no session-start text for this registration was handed to the host. Check OpenCode's register path for the same interleaving, and say what you found.

Evidence 2 (test only). Main CI 44109737206, Node 26 (2/3): `test/helpers/pi-wake-trace.test.ts:220`, "awaitArmed at its deadline > records a worker that Pi ends with terminate(): its exit code and time": the report read "thread 1: Pi saw it exit with code 1 at +0 ms" and the test expects `/thread 1: Pi saw it exit with code 1 at -\d+ ms/`. The offset can be zero or positive. Fix the assertion (a signed offset) and every other assertion in that file that fixes a sign or an exact time; also review N1 of `../../009-pi-adapter/reviews/009-30-r3.md` (line 235 passes the serialized trace to `expect`: compare a boolean).

Owns: `src/harness/pi/{session,run}.ts` and the Pi delivery path they call, their tests, `test/e2e/pi.test.ts` only if a helper needs it (do not loosen line 116), `test/helpers/pi-wake-trace.test.ts`. Leave alone: `src/core/**`, `src/harness/shared/**` unless the cause is there (then ask first), `src/harness/opencode/**` unless you prove the same defect there (then ask first).

Done when: a deterministic test that fails on main with the registration twice and passes with the fix; the kill cases of 0.1.541 still hold (`test/harness/registration-owed-harnesses.test.ts`); `test/e2e/pi.test.ts` run directly 5 times, each `timeout 900`, all passing; the helper test passes with offsets of -1, 0 and +1 ms forced.

Final message: the interleaving, with file and line; what OpenCode does; check results.

## W2: 005-108, a daemon that is still starting is not told as "no daemon is running"

Use /worker. Shape: repair, cause first. Outcome: while a daemon the session start spawned is still starting, no hook tells the agent that no daemon runs or to run `squeal start`.

Evidence (the human's screenshot, 2026-11-18, a new worktree of another repository on the released 0.1.542; its store is 4.9 GB and its daemon's start takes 13 to 83 s in `quick_check`, `research/session-start-cost.md` section 7). SessionStart, startup: "SQUEAL · registered at revision 0 / Revision 0: Squeal is still starting in this worktree and has no results yet. …" with the primer: correct. The first PostToolBatch, after two skill loads and one tool call: "SQUEAL · no daemon is validating at revision 0 / Revision 0: Squeal has no results in this worktree yet, and no daemon is running; `squeal start` starts one." The coordinator's reading, not verified: `registerFirst` told the daemon as starting from the hook's time; `DAEMON_START_GRACE_MS` is 10 s (`src/core/presence/heartbeat.ts:25`); the start outlasted it, so `ensureIfStale` found no fresh heartbeat, the daemon held its lock and did not answer, and the result was told as "unavailable".

First, no code: reproduce it in a test with a daemon whose start is held longer than the grace (a held store open; do not sleep for real time where a clock can be injected), and name the path from `ensureIfStale` to that text. If the cause is another one, stop and report.

Then: a daemon process that holds the worktree's lock and has not written its record yet is "starting", for as long as that process lives; the grace applies to a spawn whose process is gone or never took the lock. The message while it starts repeats nothing (the session heard "still starting" at its start); if the start outlasts a bound derived from the store's own start history or a plain multiple of the grace, one message says the daemon is still starting and since when, never `squeal start`. Say what Stop and `squeal status` print in that state, and make them agree. Row 011-391 removes the whole-store check from the start (candidate 0.1.545): do not depend on it; a slow start has other causes.

Owns: `src/core/presence/{heartbeat,findings,events,lock-events}.ts`, `src/harness/shared/{ensure,deliver}.ts` (the liveness result only), the text for this state in `src/core/delivery/format.ts` or where it is made, their tests, the evals parsers and skill copies if a sentence changes. Leave alone: `src/core/daemon/**`, `src/core/store/**`, `src/harness/pi/**` (row 005-107, another worker).

Done when: the reproducing test; tests for a spawn whose process died (told as now, after the grace), a daemon that holds the lock and never answers because it is stopped (SIGSTOP, lessons defect 22: told as now), and a slow start (starting, no `squeal start`); the texts before and after in your notes; the rules above.

Final message: the cause with file and line; each state's text before and after; check results.

## Review brief: candidate 0.1.546

Use /reviewer. Row 005-107 (section W1 above); the range is the candidate's commits over `origin/main` at its base. A repair of 0.1.541's decision C, in the released 0.1.542: a Pi session could read its registration text twice with no kill (main CI 44114276401, `test/e2e/pi.test.ts:116`).

The fix: the Pi worker (`src/harness/pi/worker.ts`, `serve`) starts a request only after the daemon has written what the previous commit sent; with nothing pending a request starts at once. Check: the interleaving the worker names (the run start reads the owed mark before the daemon wrote the clear) with your own probe against a real daemon; that the wait cannot hang a session (a daemon that dies or never answers while a write is pending: bounded, and what the agent then sees); the order of requests and the idle waiter; the kill cases of 0.1.541 (`test/harness/registration-owed-harnesses.test.ts`); that `test/e2e/pi.test.ts` runs against the built bundle. Judge the worker's decision to leave OpenCode unchanged: its bridge commits at the plugin's verdict without waiting for the daemon's write (`bridge.ts:207-221`), and the next check runs in a new process after a model round trip; say whether a duplicate is reachable there and whether it needs a row. The second commit is test only (`test/helpers/pi-wake-trace.test.ts`: a signed offset; review N1 of `../../009-pi-adapter/reviews/009-30-r3.md`).

No full suite; affected files directly; e2e files one at a time, `timeout 900`. A check that needs a commit ID is read from CI. Findings file: `reviews/0.1.546.md`, PASS or FAIL, committed. Write `~`, never a `/home/<user>/` path; the private-material check also rejects the company name and local project folder names.

## W3: repair of candidate 0.1.546 (review B1) and row 005-109 (OpenCode, review S1)

Use /worker. Shape: repair. The one repair round of candidate 0.1.546; your baseline is the candidate with the findings file `reviews/0.1.546.md`: read it first, its reproduction steps and fix sizes are the contract.

Part 1, B1 (Pi). With the daemon frozen so that the clear of the owed mark gets no answer, the same live Pi worker says its already-handed registration again after about 1.26 s, with no start killed (`src/harness/pi/worker.ts:105`, `:140`: `HandOff.sent` swallows the failed clear; `HandedWrites` treats settled as written and starts a stale reader). Contract: a registration text the worker handed to its host is not said again by that worker, whether the clear was written, failed or is unanswered, until it is persisted or the worker is lost; a new worker process (a killed start) replays as decision C says. Keep the suppression in the worker's memory, keyed by the registration it handed; do not add a second store record.

Part 2, S1 (OpenCode, row 005-109). The bridge commits at the plugin's verdict without waiting for the daemon's write (`src/harness/opencode/bridge.ts:207-221`); `after(read)` before the clear completes repeats the registration; the reviewer proved it with the production handlers and a daemon whose write was held. OpenCode's bridge is a new process per call, so memory does not carry: wait for the write as the Claude Code and Codex hooks do (`writeThenCommit`), bounded, and say what a frozen daemon then gives (a duplicate is accepted there only when the write was never confirmed; state it). A deterministic test that fails on the candidate and passes with the fix.

Rules: no version raise, no `pnpm run build`, no full suite, no push. Keep a notes file `tasks/005-107/notes.md` with the commands you ran and their results, and keep your logs in your worktree until I say the review passed: the first worker left none, and its evidence was lost. Run `test/e2e/pi.test.ts` and `test/e2e/opencode*.test.ts` directly, one at a time, `timeout 900`, on a bundle built in a scratch copy (say how), and keep those logs too. Before you report, read Squeal's complete verdict on your changed paths. Write `~`, never a `/home/<user>/` path.

Owns: `src/harness/pi/**`, `src/harness/opencode/**`, their tests. Leave alone: `src/core/**`, `src/harness/shared/**` (ask first if the cause is there).

Final message: per part, the change, its proof test, and what a frozen or dead daemon gives; check results with log paths.
