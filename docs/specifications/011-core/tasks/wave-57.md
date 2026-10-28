# Wave 57: rows 011-263 and 011-208 (gh-121, gh-79)

Coordinator 32184dd1, 2026-10-28. The human approved "A1 + B" for gh-121 (decision card, 2026-10-28). The two rows share no file and run in parallel. Host policy (2026-10-25): no local full suite, no `squeal run --all`; affected results through `squeal status --wait 60000 <paths>`; every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`; private `/tmp` fixtures only; never make CPU load on purpose. No `pnpm run build`. Not yours: the board, spec text, `status.md`, bundles, version.

## W1: row 011-263 (a yield to a promoted file must run that file sooner)

Use /worker. Shape: slice.

Outcome: a running tier never yields to a promoted file when the files it cuts would run again before that file, so the cut loses work and runs nothing sooner.

Read: the board row; `research/issue-121.md` F3 and F4; spec 011 C4 step 5 and C15 Rank; `status.md` lines for 011-184 and 011-209.

Seam and lead: `waitedFor` (`src/core/scheduler/yields.ts:355`) counts any queued promoted file before 30 s, because `rankToBeat` (`:394`) returns no rank then. Lead: before a `promoted` verdict, check whether the promoted file would be in the lane's next tier after the cut, given the ranks of the cut files and the tier size. Compute it from ledger ranks; start no runner. Keep the 30-second rule and the once-per-key guard as they are. Do not change promotion lifetime: protection after a wait ends is row 011-208's question.

Owns: `src/core/scheduler/yields.ts`, any new helper next to it, `test/scheduler/tier-yields-named.test.ts` or a new `test/scheduler/` file, and `tasks/011-263/notes.md`. Leave `promotions.ts`, `queue.ts` and the CLI alone; send me a request first if you need them.

Done when: a test reproduces F3 (wait A names three running files; at 10 s wait B adds a fourth) and shows no yield; a test where the promoted file would run in the next tier still yields; existing `test/scheduler/tier-yields*` tests pass unchanged; the notes give the C4 step 5 sentence to amend; lint and typecheck pass.

## R1: row 011-208, widened (tier size and interruption cost of a large named gate)

Use /researcher. Shape: research.

Outcome: findings that say what a large named gate costs in time from tier size and from interruptions, and what keeping protection after a wait ends would save and cost.

Read: the board rows 011-208, gh-79 and gh-121; `research/issue-79.md`, `research/issue-91.md`, `research/issue-121.md`; spec 011 C4 step 5, C10, C15 Rank.

Method: reuse the in-memory scheduler fixture from `research/probes/issue-121/` and `issue-91`. 56 promoted files with cezar's parity durations beside a 537-file backlog; overlapping and expiring waits as in #79's later comment and #121. Compare: today; promoted tier sized by the backlog's wall budget; protection kept after the wait ends while keys are unchanged. For the third, also measure the opposite case: a later 2-second file waits behind a protected slow group nobody waits for. No real tests, no live daemon.

Owns: `research/issue-79-gate.md` and `research/probes/issue-79/`.

Done when: the findings give time to verdict, discarded run time and worst delay for a small later file, per option, with load per run, and recommend one option or none.
