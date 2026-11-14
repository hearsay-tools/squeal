# Wave 91: row 011-339, one owner for each daemon progress record

Coordinator 15729321, 2026-11-14. The human's answers of 2026-11-14: "2: Small move", then "Approve, land, start". One worker.

Host policy, as in `wave-85.md`. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, the `package.json` version.

## W1: row 011-339, each progress record has one owner beside its writer, behaviour preserved

Use /worker. Shape: slice (a move), test first for the table test. Runner claude, opus, effort medium.

Outcome: the refined revision, the install wait with its command, the checkpoint progress, the head move, the bootstrap marker and the notes key each have one owner file beside their writer, and every reader and writer goes through it.

Read: `research/progress-records.md` (the spec for this row: Problem, Decisions, Agreed with sibling designs, Coordinator's calls, Rows); board row 011-339; `GLOSSARY.md` (Progress record, Refined revision); `research/waits.md` for `src/cli/wait/progress.ts`.

First edit: `test/scheduler/progress-records.test.ts` over `freshStore()` for the refined revision, then `src/core/scheduler/refined.ts`, and move its four readers and two writers. Then one record at a time. Owner names in the record are proposals; a change goes in the notes.

Owns: the new owner files; the keys and parsers in `src/core/types/scheduler.ts` and `types/daemon.ts` (removed); the readers and writers the record's table names; the `WORKTREE_META_ROWS` entries in `types/store.ts`; the test files that stage or read these rows raw.

Leave alone: `src/core/scheduler/scheduler.ts`, `slow-tier.ts`, `record.ts` (card 5); in `src/cli/wait/progress.ts` and `src/core/state/header.ts` only the record reads change; `openCheckpoint`, `installWait` and `InstallHold` keep their interface. No owner opens a transaction; every write at today's call site and in today's transaction, every read at today's point. No rule changes: keep both refined write rules (the ledger sets, the failure path raises) and both head-move readings (exactly N in the code pass; N or later in the header and `head-move.ts`). Say whether the second difference is deliberate; if not, write a proposed row text in the notes and do not fix it. Candidate 0.1.489 (rows 011-44 and 011-45, coordinator cdd216e5) also edits `daemon/daemon.ts`, `scheduler/ledger.ts` and the `WORKTREE_META_ROWS` table; keep your edits there to the record lines so the later rebase is small. Its two rules hold after the rebase: a new caller of the test-file or known-state removals calls `bumpStatesMarkerOf`, and the registration claim stays in the registration transaction. Do not run `pnpm run build` in your tree. Stop and ask if `test/keys/key-format.test.ts` asks for a raise rather than a pin.

Done when: the row's done-when; lint and typecheck pass; `squeal status --wait 60000` on the changed paths, with pending or unknown files named. Notes in `tasks/011-339/notes.md`: each moved call site (file, function, transaction), the deleted parser-only cases by file and name, the head-move answer, any name change.
