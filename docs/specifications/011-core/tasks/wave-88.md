# Wave 88: row 011-334 (the reads beside the run waits give a line, not a stack, on a busy store)

Coordinator cdd216e5, 2026-11-14. The human approved the row on 2026-11-14 ("Approve the row"), from review `reviews/0.1.474.md` N1. Row 011-328 landed as 0.1.479, so its files are free. Row 011-331 (worker e28cc221) runs in `src/cli/wait/` and the status waits at the same time: whichever lands second rebases.

Host policy, as in `wave-85.md`. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, the `package.json` version.

## W1: row 011-334

Use /worker. Shape: repair, test first.

Outcome: when the store is busy, the reads beside the run waits wait for it within a bound and, if it stays busy, print a line that says so in place of the part they could not read; `squeal run` never ends with a "database is locked" stack trace from them.

Read: board row 011-334; review `reviews/0.1.474.md` N1 (the reproduction: `run --all --wait 5000` rejected from `filesText` with "database is locked"); `tasks/011-327/notes.md` decision 13; how the run waits read a busy store since 011-327 (`readBound` in `src/cli/wait/presence.ts`, `withStatusStore` in `src/core/status/open.ts`).

Seam and lead: the callers of `inStore` (`src/cli/wait/reads.ts`): `run.ts` `filesText`, `owedText` and `joinedCheckpoint`, and `group-pending.ts`. First edit: one command row each over a scratch store with a second connection holding the write lock, pinned to today's throw; then flip them.

Rules:
- Use the run waits' busy-store rule, not a new one: `withStatusStore` with a bounded busy timeout, then a line naming the busy store. Put any new helper in a new file under `src/cli/wait/`; leave `inStore` and `reads.ts` as they are (row 011-331 works there), and name in the notes whether `inStore` has callers left.
- Only the busy and unread cases change what a user sees; every other line and exit code stays.

Owns: `run.ts` (those three reads), `group-pending.ts`, a new file under `src/cli/wait/`, the tests for these reads.

Leave alone: `src/core/**`; `src/cli/wait/reads.ts` and the other module files; `status-wait*.ts`, `status-paths.ts`; `src/cli/code*.ts`; `run-group.ts` `requestedText` (row 011-324); `KEY_FORMAT_VERSION`.

Done when: the row's done-when holds; each new line is listed in the notes, so the coordinator can amend spec 005 D1 if it names them; lint and typecheck pass; `test/keys/key-format.test.ts` and `test/version-sensitive.test.ts` pass with no raise; affected results through `squeal status --wait 60000 <paths>`. Notes in `tasks/011-334/notes.md`.

## R1: review of cand/0.1.482

Use /reviewer (codex gpt-6.1-sol high). Candidate CI: run 43586994011. Pinned to `cand/0.1.482` at `8e6a2dd2a70eec881d9dd8b6849b102002ec239b`; range `746eedc3c..8e6a2dd2a`: four commits of worker ac85bcd7, cherry-picked (`51df3084d` tests pinned to today's throw, `bb4f46785` the fix, `9694d1532` and `21badcaa9` notes), then the 0.1.482 version raise and bundles. Behaviour to compare against: `746eedc3c`. Read: board row 011-334, review `reviews/0.1.474.md` N1, `tasks/011-334/notes.md`, this file's W1.

Check, each as proven, plausible or unverified:

1. **No stack trace on a busy store** from `run.ts` `filesText`, `owedText`, `joinedCheckpoint` and `group-pending.ts` `heartbeatSilence`: each reads through `readBeside` (`src/cli/wait/beside.ts`) with the run waits' bounded busy timeout and, when the store stays unreadable, prints its "was not read" line; reproduce N1's `run --all --wait` case.
2. **Nothing else a user sees changed**: with a readable store every line and exit code is as at `746eedc3c`; the new lines are the ones the notes list. Judge decision 1 (a store that does not open now also prints a line) and decision 2 (two separate reads: two lines and up to 2 s on a busy store when a request joins a running checkpoint).
3. **One rule, not a new one**: `readBeside` uses `withStatusStore` and `readBound` as the run waits do; `inStore` has no callers left, as the notes say.
4. **Replace, don't layer**: the pinned throw rows were flipped, not kept beside new ones.
5. **Scope**: no change under `src/core/`, `src/cli/wait/reads.ts`, `status-wait*.ts`, `src/cli/code*.ts` or `run-group.ts` `requestedText`.

The coordinator's tree passed lint, typecheck, `check:version` and `key-format`, `version-sensitive`, `run-busy-reads` and `group-pending` (40 tests) at the candidate. Host policy as in `wave-85.md`. Write `reviews/0.1.482.md` and commit it on your branch.
