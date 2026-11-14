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

## R1: review of cand/0.1.479

Use /reviewer (codex gpt-6.1-sol high). Candidate CI: run 43583451454. Pinned to `cand/0.1.479` at `65c7bf1965c2a894f296e57976e7c5cd54f3c52f`; range `a76fc107a..65c7bf196`: three worker commits of 56bd7a74, cherry-picked (`68804b38f` the `GroupWait` refactor, `a6c909812` the change, `c7d9f2b3e` notes), then the 0.1.479 version raise and bundles. Behaviour to compare against: `a76fc107a`. Read: board row 011-328, `research/waits.md` "Agreed with sibling designs", `research/request-intake.md` (covered files, condition 3 as relaxed), `tasks/011-328/notes.md`, this file's W1.

Check, each as proven, plausible or unverified:

1. **The record replaces the guess, and only where it should.** With an id and a record, `run --all` (one lane), `run <group> --wait` and the narrow run take their files from `readCoveredFiles`, read once right after the answer and kept for the whole wait; no CLI file derives those files from the policy then. An answer without an id, a gone record, or a store that cannot be read keeps today's guess (notes, decision 2). A both-lanes `run --all` and `run --slow` read no record (decisions 1 and 4).
2. **Output changes only where the record and the guess differ**, each such line named in the notes with its row; the `GroupWait` refactor (`68804b38f`) changes no output.
3. **The record is read only through the reader**, in one bounded read (`withStatusStore`), with no raw row read and no new busy-store stack trace (rows 011-327 and 011-334).
4. **Replace, don't layer.** `test/cli/covered-id-ignored.test.ts` (row 011-325) became `run-covered.test.ts`: its cases still cover an older daemon and a gone record. The new rows test the production `requestFiles`.
5. **Scope.** No change under `src/core/`, `status-wait*.ts`, `status-paths.ts`, `src/cli/code*.ts`, `group-pending.ts` or `run-group.ts` `requestedText`; `run-group-wait.ts` changed by the coordinator's grant.

The coordinator's tree passed lint, typecheck, `check:version`, `test/keys/key-format.test.ts` and `test/version-sensitive.test.ts` (19 tests) at the candidate. Host policy as in `wave-85.md`. Write `reviews/0.1.479.md` and commit it on your branch.
