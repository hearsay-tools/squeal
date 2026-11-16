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
