# Wave 86: row 011-328 (the run waits read a request's covered files from the scheduler's record)

Coordinator cdd216e5, 2026-11-14. Card 2's row 011-325 landed on main as 0.1.478 (`a67f017df`, coordinator 9ddca779) with the human's relaxed condition 3: a covered-files record is kept at least 10 minutes after its own write, and while any of its files is queued or running when a later request writes. Row 011-331 (wave 85 W1, worker e28cc221) runs at the same time in `src/cli/wait/`: whichever lands second rebases.

Host policy, as in `wave-85.md`. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, the `package.json` version.

## W1: row 011-328

Use /worker. Shape: slice, test first, one commit per step.

Outcome: when the daemon's answer names a covered-files record, the run waits and the start lines take the request's files from that record instead of deriving them from the policy; an answer without an id, or an id whose record is gone, keeps today's guess.

Read: board row 011-328; `research/waits.md`, "Agreed with sibling designs"; `research/request-intake.md`, the covered-files call and its condition 3 as relaxed; `tasks/011-327/notes.md`, "For the next worker"; `GLOSSARY.md`, "Requests" (covered files) and "Waits".

The record: `readCoveredFiles(store, id): CoveredFiles | null` in `src/core/store/covered-files.ts`; each file is `queued`, `current`, or `not-queued` with a reason. The ids: `RunAllResponse.coveredId` beside `owner` (a `run --all` that joins a running checkpoint gets its own id), and `requested.coveredId` (`RequestTaken`) on `run --slow`, `run <group>` and the narrow run. `null` means absent, pruned, or a store without the table.

Seam and lead: `WaitFiles` in `src/cli/wait/reads.ts` and its two guesses, `laneFiles` (the checkpoint) and `ownOf` (the group view from the policy); also `run.ts` `filesText` (the start line's counts) and the narrow run's lines in `run-group-narrow.ts`. First edit: loop rows over a scratch store with a written record: the wait reads the record's files; an answer without an id reads today's guess (an older daemon); an id with no record reads today's guess.

Rules:
- Read the record once, right after the answer that names it, in one read of the store; keep that file set for the whole wait, a bare `--wait` included.
- Read it only through `readCoveredFiles`; no raw row read in the CLI.
- A narrow run's not-queued files and their reasons come from the record.
- The lint group's checks are not test files: say in the notes whether its request names a record, and keep it as it is if not.
- The rules of rows 011-326 and 011-327 still hold: reads stay as they are where the row does not change them; one decision path; replace, don't layer.

Owns: `src/cli/wait/reads.ts` and the files of `src/cli/wait/` the seam needs, `test/cli/wait/**`, `run.ts` (`filesText` and the answer's id), `run-slow.ts`, `run-group.ts` except `requestedText`, `run-group-narrow.ts`, `run-lanes.ts`, the run tests whose guessed-file cases the record replaces.

Leave alone: `src/core/**` (the record is card 2's); `status-wait*.ts`, `status-paths.ts` (row 011-331); `src/cli/code*.ts`; `run-group.ts` `requestedText` (row 011-324); `group-pending.ts` and the busy reads beside the waits (row 011-334, after this one); `KEY_FORMAT_VERSION`.

Done when: the row's done-when holds (no CLI file derives a request's files from the policy when the answer names a record; a loop row covers an older daemon's answer; a narrow run's not-queued files read from the record); what a user sees changes only where the record and the guess differ, each such case named in the notes with its line; lint and typecheck pass; `test/keys/key-format.test.ts` and `test/version-sensitive.test.ts` pass with no raise; affected results through `squeal status --wait 60000 <paths>`. Notes in `tasks/011-328/notes.md`. Your final message lists decisions the record did not settle and type changes.
