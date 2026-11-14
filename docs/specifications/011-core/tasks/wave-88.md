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
