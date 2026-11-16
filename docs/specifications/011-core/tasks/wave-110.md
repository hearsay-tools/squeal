# Wave 110: a killed daemon's children, and an exact-time test text (rows 011-373, 011-374)

Coordinator 4c0bbe28, 2026-11-16. Approved by the human on 2026-11-16 ("Approve 011-373, Approve 011-374"). Base: main at 0.1.519. The two workers own disjoint files; neither touches `src/core/scheduler/`.

Host policy, as in `wave-85.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on test commands; private `/tmp` fixtures and scratch `HOME`; never the real `HOME`; never make load on purpose. Run vitest with a `timeout` and make sure each run ends; state the load with every timing. Stop your Squeal daemon before you finish, and make sure no daemon or child process your tests started is left running. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, `package.json`.

## W1: row 011-373

Use /worker. Shape: survey, then slice if proven. Effort medium.

Outcome: we know whether a SIGKILLed daemon's children (its test-runner process and its store integrity check) outlive it and what they hold, and if they get in the replacement's way, they end with their parent or the replacement waits for them.

Read: board row 011-373; `tasks/011-358/notes.md` (row 011-359's side finding); `test/daemon/lifecycle.test.ts`; the daemon's spawn of its runner and of the integrity check (find them from `src/core/daemon/`).

Lead: test first. A daemon test on a scratch store large enough that the integrity check runs for seconds: SIGKILL the daemon mid-check, start a replacement, and record the children's lifetimes, what they hold (the store lock, the socket, files) and whether the replacement waits, stalls or races. If nothing holds the replacement up, the notes say so with the numbers and the row closes as measured. If something does, fix it with the failing test first (a child ends with its parent, or the replacement waits for it, whichever fits the code), and say which.

Owns: the daemon spawn and child-process code the survey finds (name each file), `test/daemon/` new tests. Done when: row 011-373's done-when; `tasks/011-373/notes.md` gives the measurement and the verdict.

## W2: row 011-374

Use /worker. Shape: slice. Effort medium.

Outcome: `test/cli/status-wait-paused.test.ts` checks the outcome and the line's shape of "Returned on timeout after N s: ...", with N derived from the wait the test asked for, not an exact tenth; the product's text is unchanged.

Read: board row 011-374; the test and the formatter that prints the line; `test/cli/status-wait-edit.test.ts` (the same text, check whether it has the same exposure).

Owns: those two test files and their helpers only. Done when: row 011-374's done-when; the case passes 3 of 3 under the host's load (stated); `tasks/011-374/notes.md` names the bound and why it is not host-tuned.

Both: lint, typecheck and `squeal status --wait 60000` on the changed paths; report pending checks as such. A product bug found on the way is a proposed row with a failing test.
