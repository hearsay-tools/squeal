# Wave 111: the coverage writer's turn test on CI, and a killed daemon's integrity-check claim (rows 011-376, 011-375)

Coordinator 4c0bbe28, 2026-11-16. Approved by the human on 2026-11-16 ("Land 372: Fix the test first"; "Approve 011-375, Approve 011-376"). Base: main at 0.1.519 plus docs. Row 011-372 (cand/0.1.520, review PASS) lands after row 011-376 makes its CI pass. The two workers own disjoint files; neither touches `src/core/scheduler/`.

Host policy, as in `wave-85.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on test commands; private `/tmp` fixtures and scratch `HOME`; never the real `HOME`; never make load on purpose. Run vitest with a `timeout` and make sure each run ends; state the load with every timing. Stop your Squeal daemon before you finish, and make sure no daemon or child process your tests started is left running. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, `package.json`.

## W1: row 011-376

Use /worker. Shape: survey, then slice. Effort medium.

Outcome: `test/code/coverage/writer-turns.test.ts` still fails if the records' writer parses or maps a large payload on the main thread (row 015-42: turns of about 8 s), and passes on CI runners repeatedly.

Read: board rows 011-376 and 015-42; the test; `payloads.ts`; `src/core/code/coverage/writer.ts` (what runs on the main thread around a stored payload: the worker's start, the transfer, the store write). CI evidence: runs 43839480465 (232 ms, Node 26) and 43843816001 (184 ms, then 103 ms, Node 22) failed; main measured 88 ms (its log line prints the payload size, the time and the load).

Lead: find what fills the longest turn on a runner (the probe's `max` is one sample of the whole window: worker start, GC, the store write). Then make the bound fit the work: for example measure an idle control window on the same run and compare, or time the writer's own main-thread steps, or derive the budget from the payload size against the 8 s regression. Never a host-tuned number (memory: fixes fit users' machines). Prove the case still fails when the parse runs on the main thread (a temporary local change, reverted; say how in the notes).

Owns: `test/code/coverage/writer-turns.test.ts`, `payloads.ts` if needed, new helpers. A product cause (a real regression in the writer) is a message to me and a proposed row, not a fix here. Done when: row 011-376's done-when; the case passes 3 of 3 locally (load stated) and fails against the main-thread parse; `tasks/011-376/notes.md` names the cause and the bound.

## W2: row 011-375

Use /worker. Shape: slice. Effort medium.

Outcome: after a daemon is killed with SIGKILL during the day's full integrity check, a later daemon runs the check within the check's own interval instead of up to a day or more later.

Read: board row 011-375; `tasks/011-373/notes.md` ("For the coordinator"); `reviews/011-373-374.md` S1; `src/core/daemon/full-check.ts` (`claimFullCheck`, `releaseClaim`, row 011-235's give-back); how other claims in the store end with their holder (find a claim kind that records its holder's pid or lease and is taken over when that holder is gone); `test/daemon/sigkill-children.test.ts`.

Lead: test first. Extend or copy the SIGKILL fixture: kill the daemon mid-check, start a replacement, and show the replacement runs no check today (fails). Then let the claim end with its holder, in the way the store's other claims do (a holder id the next daemon can see is dead, or a lease), and keep row 011-235's rules: a check that answered keeps its claim; two live daemons never both run the day's check.

Owns: `src/core/daemon/full-check.ts`, the claim's meta row format if it must change (say how an older row reads), `test/daemon/` new tests. Done when: row 011-375's done-when; the new test failed before the fix; `tasks/011-375/notes.md` gives the mechanism and why two live daemons cannot both check. This changes `src/`, so the candidate gets a version raise.

Both: lint, typecheck and `squeal status --wait 60000` on the changed paths; report pending checks as such.

## R1 (W1): review of cand/011-376

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/011-376` at `22e60ddafc9ccc571d2737eeda7f359203f223f9`; candidate CI run 43854707406. Test files and notes only: no `src/` change, no version raise. Range `d5f73b118..22e60ddafc9ccc571d2737eeda7f359203f223f9`: worker ffae9bc4's one commit (`3ba3200c9`), cherry-picked without conflict. Read: board rows 011-376 and 015-42; this file's W1; `tasks/011-376/notes.md`.

Check, each as proven, plausible or unverified:

1. **Still guards row 015-42.** The case fails when the payload's parse, or its whole map, runs on the main thread (the notes give both proofs and how to repeat them); judging a turn by the main thread's CPU time (`process.threadCpuUsage`, also on Node 22.19, CI's oldest) cannot miss a long turn of the writer's own work.
2. **The bound fits the work.** Half of this run's main-thread parse of the same payload follows the machine's speed; nothing is host-tuned; a cold parse (first `JSON.parse`, JIT) does not shrink the budget below the writer's own turns on a slow or fast machine; dropping the load skip is safe.
3. **The probe.** `watchTurns` (5 ms interval) records every turn, counts GC and Vitest's own work only as the notes say, and leaves no timer behind on a failure.
4. **The side finding** (the store write runs on the main thread, about 240 ms by the clock and 10 ms of CPU on a slow disk; D8 design): is it a defect a user sees, or the design as written?

Coordinator at the candidate: lint and typecheck pass; the case passes at load 89. Worker: three Node 26 runs and one Node 22.19 run pass at load 69 to 82; both regressions fail. CI is the full suite. Host policy as in `wave-85.md`; never the real `HOME`; run vitest with a timeout. Write `reviews/011-376.md` and commit it on your branch.

## R2 (W2): review of cand/0.1.521

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/0.1.521` at `9b7b26f1eaa8ee8ecb850c6ad5e8767c83168111`; candidate CI run 43855250932. Range `9f42d24ee..9b7b26f1eaa8ee8ecb850c6ad5e8767c83168111`: worker d1a92707's one commit (`8be022b15`, row 011-375), cherry-picked without conflict, then the 0.1.521 raise and bundles. Below it, not yours: cand/011-376 (in review) and row 011-372's reviewed commits (cand/0.1.520, PASS), stacked so CI runs the fixed coverage test. Read: board row 011-375; this file's W2; `tasks/011-375/notes.md`; `tasks/011-373/notes.md` "For the coordinator"; `reviews/011-373-374.md` S1.

Check, each as proven, plausible or unverified:

1. **The claim ends with its holder.** After a SIGKILL during the check, a later daemon takes the claim over and runs the check (the new `sigkill-children` case failed before the fix); takeover happens only when the holder (`store.full-check.holder`: pid, start time, PID namespace, as the write lease records it) is surely dead.
2. **Never two checks at once.** Two live daemons cannot both run the day's check: the claim and takeover in one write transaction; a live holder, a holder in another PID namespace and a holder without `/proc` keep the claim; a reused pid is not taken for the holder.
3. **Row 011-235 kept.** An answered check keeps the day's claim and drops the holder; an unanswered one gives both back; an older row with no holder stays held 24 hours; an older daemon reading the new row behaves as before. The notes' gaps (one extra check after a kill between answer and holder delete; the orphan's answer unused) are as stated and miss no fault.
4. **The move** of the claim code to `full-check-claim.ts` changes no behaviour; `test/daemon/full-check.test.ts` changed one import only.

Coordinator at the candidate: lint, typecheck, `check:version origin/main`; `key-format`, `version-sensitive`, `full-check-holder`, `full-check` pass (35 tests, load 85). Worker: the six full-check and SIGKILL files 31/31 at load 47 to 58; the new SIGKILL case failed before the fix at load 74. CI is the full suite. Host policy as in `wave-85.md`; never the real `HOME`; run vitest with a timeout; make sure no daemon, frozen check or child is left running. Write `reviews/0.1.521.md` and commit it on your branch.

## R3 (W2 repair): narrow re-review of cand/0.1.521

Use /reviewer (reviewer 7360269f, resumed). Pinned to `cand/0.1.521` at `42acd3b9c9bdba3986e12a12e7ffee5aa3e0c044`; candidate CI run 43858225239. The candidate you passed (`9b7b26f1e`) failed CI 43855250932 on one test: `test/store/worktree-meta.test.ts:157`, "reads and writes meta only through a key function, a shared constant or a variable bound to one" (`META_FULL_CHECK_HOLDER` is not in `SHARED_KEY_CONSTANTS`; Node 22 and Node 26, shard 2/3; every other test passed, the rest of the failures are the fixtures' own expected failures). Coordinator repair `42acd3b9c`: one line adds `META_FULL_CHECK_HOLDER` to that list. The stack was rebased onto main `9e33d149b` (row 011-376 landed; its commit dropped from the stack); no other content changed: `git diff 0040b0f6d 42acd3b9c -- src test plugins` shows only main's 011-376 files.

Check, as proven, plausible or unverified: the holder key is a store-wide key like `META_FULL_CHECK` (not a worktree row of the registry), so the list is the right place; nothing else in the candidate escapes the meta-key registry checks; the rebase changed nothing of 011-372 or 011-375. Coordinator: `check:version origin/main`; `worktree-meta`, `key-format`, `version-sensitive` 25/25. Append a section "R3" to `reviews/0.1.521.md` and commit it on your branch.
