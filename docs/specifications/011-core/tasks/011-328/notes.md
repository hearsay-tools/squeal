# Row 011-328 notes: the run waits read a request's covered files from the scheduler's record

Worker 56bd7a74, 2026-11-14. Brief: `tasks/wave-86.md`, W1. Design: `research/request-intake.md`, "Covered files (011-325)", conditions 2 to 4 and condition 3 as relaxed; `research/waits.md`, "Agreed with sibling designs". Based on `main` at `a147afe8b`.

## What changed

- **One read, one decision:** `requestFiles(ask, guess)` in the new `src/cli/wait/covered.ts`. Right after the answer that took the request, it reads the record named by the answer's `coveredId` through `readCoveredFiles`, in one read of the store (`withStatusStore`, bounded by `readBound` as a run wait's read). It returns the wait's files and the record:
  - the record's files as a `list` when a record is read;
  - else `guess`, today's reading: no id (a daemon before row 011-325), no record (pruned, or a store without the table), or a store not read (busy past the bound, or unopened).
  - A checkpoint of both lanes is for every listed file: no guess, so no record is read (below, decision 1).
- **The waits keep that set for the whole wait**, a bare `--wait` included: `RunWaitAsk.files` holds it; no later read looks at the record again.
- **The seam (`src/cli/wait/reads.ts`):** `WaitFiles` is as before; its `list` kind now also holds a request's covered files. The checkpoint wait takes a `list` too (`CheckpointFiles`, was the `lane` kind only) and reads its files through `checkpointFiles` (`covered.ts`): a list's files among the listed ones, else `laneFiles`. The group wait's `ownOf` reads a list through the same `inList`.
- **The commands:**
  - `run.ts`: `Recorded.coveredId` from the `run-all` answer; one `requestFiles` call after the checkpoint is recorded; `filesText` (the start line's "already current") and the checkpoint wait take its files. `filesText` still reads the classes now, through `inStore`, as before: only the file set changed.
  - `run-group.ts`: with `--wait`, one `requestFiles` call before `waitForGroup`. Without `--wait` the line is `requestedText` (row 011-324's), from the answer's counts, so no record is read.
  - `run-group-narrow.ts`: one `requestFiles` call after the answer, with or without `--wait`. `recordedNarrow` takes the selection, the current count and the not-run files with their reasons from the record; what the paths reach, other groups' selections and the unmatched paths stay the answer's (the record holds the selection only).
  - `run-group-wait.ts`, by agreement (coordinator cdd216e5, request `1307f92c`, its own commit `c4321b149`): `GroupWait.files` is the wait's `WaitFiles`, and `GroupWait.narrow { unmatched }` replaces the narrow flag and `GroupWait.unmatched`. No output change.
- **`laneFiles` and the group view stay**, as the guess for an answer without a record. With a record, no CLI file derives the request's files from the policy. The policy reads left in `src/cli` are: the group guess (`reads.ts` `ownOf`, no record); the lint group (`lintRead`, no test files); `run-group.ts` finding the group by name; and the status waits (row 011-331's).

## Where a user sees a change: only where the record and the guess differ

Each case below differs only when the scheduler's decision and the CLI's reading of the policy differ. One example: `squeal.config.json` was edited and the daemon has not yet recorded the edit as a revision. The CLI's guess reads the policy file on disk, while the record has the files under the policy the daemon took the request with.

1. **`run --all --fast` / a one-lane checkpoint**, start line `Checkpoint <id> (the fast lane only, …) started at revision N: K test files to run, M already current`: `M` counts the record's files outside the checkpoint's own, not the lane's files by the policy. Row: "run --all --fast --wait: the start line and the verdict count the record's files, not the lane's" (`test/cli/run-covered.test.ts`).
2. The same command's verdict line, `completed at revision N: …; T test files, M already current, K run now`, and every read of its wait (end, hold, verdict): `T` and the files the hold and verdict read are the record's. Same row; loop rows in `test/cli/wait/covered.test.ts`, "a checkpoint wait's files".
3. **`run <group> --wait`**, verdict line `Group <name> completed at revision N: …; T test files, Q queued by this request` and the wait's hold, pending and install reads: the record's files, not the group's by the policy. Row: "run <group> --wait: the verdict counts the record's files, not the group's by the policy"; loop rows "a group wait's files".
4. **`run <group> <path>…`**, the line `Group <name> at revision N: these paths select …; C current, R not run, …` and the lines `<paths> is/are not current and does/do not run, because <reason>.`: from the record. Today's daemon writes the answer's `narrow` and the record from the same `coveredOf` in one transaction, so the two agree and no output changes against it. Row: "run <group> <path>: the not-run files and their reasons are the record's, not the answer's" (a record that disagrees with its answer, to show which one is read).

No other line changes. An answer without an id and an id whose record is gone print and exit as before: rows "an answer without an id, or one whose record is gone" for `run --all --wait`, `run --slow` and `run tests --wait`.

## Decisions the record did not settle, and my choice

1. **A both-lanes `run --all` keeps every listed file** and reads no record (coordinator cdd216e5 accepted, request `1307f92c`). Every listed file is no guess from the policy. The agreement (`research/request-intake.md`, condition text) scopes the switch to `run <group>` and a one-lane checkpoint. A list would also change the verdict: `readVerdict` counts a failed setup of every project with no list, and only of the listed files' projects with one (`src/cli/verdict.ts`, `readVerdict`).
2. **A store not read at the record's read keeps the guess, silently.** The read is bounded like a run wait's read (`readBound`: what is left before the deadline, at least 50 ms, at most 1 s). The wait's own reads then meet the busy or missing store and report it under row 011-327's rules. The read goes through `withStatusStore`, never `inStore`, which throws on a busy store (row 011-334).
3. **The record's files are read among the listed ones at each read** (`checkpointFiles`, `ownOf`), as `laneFiles` and the narrow run's list did. A record file the worktree no longer lists drops out. Removing a test file is a new revision, which ends a checkpoint wait as `moved`.
4. **A one-lane start line counts classes now, not the record's states.** "Already current" is `readClasses` over the record's files outside the checkpoint's, as before over the lane's. Only the file set changed, so the start line's read stays as it was (row 011-327's rule). The narrow run takes its current count and not-run files from the record's states, as the brief asks.
5. **`run --slow` reads no record.** Its `--wait` is a status wait (`statusWaitCommand`; `status-wait*.ts` is row 011-331's). The agreement says `run --slow`'s record is read only once the status waits move, which the human decides later. `run-slow.ts` is unchanged.
6. **The lint group's request names no record.** A lint group's answer carries no `coveredId` (the release answers through `store.outside`, and a lint group covers no test file; `RequestTaken` doc). `run-lint-group.ts` and `lintRead` are unchanged.
7. **`test/cli/covered-id-ignored.test.ts` (row 011-325) became `test/cli/run-covered.test.ts`.** Its premise, a CLI that ignores the id, is no longer true. Its three rows stay as the older daemon's and the gone record's. `run tests` now runs with `--wait`, so the row reaches the group wait, the only `run <group>` path that reads a record.

## Type changes

- New `src/cli/wait/covered.ts`: `CoveredAsk`, `RequestFiles<F>`, `requestFiles`, `inList`, `checkpointFiles`.
- `src/cli/wait/reads.ts`: new `CheckpointFiles` (`Exclude<WaitFiles, { kind: "group" }>`). The checkpoint `RunWaitAsk.files` is now `CheckpointFiles`; it was `Extract<WaitFiles, { kind: "lane" }>`, so this widens it.
- `src/cli/run.ts`: `Recorded.coveredId: string | undefined` (new field).
- `src/cli/run-group-wait.ts`: `GroupWait.files` is now required and typed `Exclude<WaitFiles, { kind: "lane" }>`; it was an optional `readonly TestFileRef[]`. `GroupWait.unmatched` is removed. New optional `GroupWait.narrow: { unmatched }`.
- No `src/core` change, no key or schema change.

## Checks (2026-11-14, host loaded by other projects)

- `pnpm run typecheck`: no errors. `pnpm run lint`: "Checked 3392 files … No fixes applied."
- Direct runs (`env -u PLUGIN_ROOT -u PLUGIN_DATA pnpm exec vitest run <paths>`), because Squeal had about 280 affected files queued behind the host's load: `test/cli/wait/` (all), `test/cli/run-*.test.ts` (all 16, `run-covered` included), `test/cli/status-wait-group-narrow.test.ts`, `test/keys/key-format.test.ts`, `test/version-sensitive.test.ts`: 27 files, 257 tests pass.
- Mutation: with `requestFiles` forced to the guess, the five record rows fail (2 loop rows, 3 command rows) and the guess rows pass.
- Squeal (`squeal status --wait 60000` on the changed paths, revision 18): 8 current, all pass (`run-covered`, `run-lanes`, `wait/covered`, `wait/lines`, and 4 others); 282 pending, queued behind the load. Not run to a verdict: the rest of the affected set (the CLI files are imported through `main.ts` by about 290 test files), left to CI.

## For the next worker

- **011-331** (`src/cli/wait/`): this row changed `reads.ts` (the `WaitFiles` doc, `CheckpointFiles`, the checkpoint `lane()` read through `checkpointFiles`, `ownOf`'s list through `inList`, and the imports) and added `covered.ts`. Whichever lands second rebases.
- **011-334** (busy reads beside the waits): `filesText`, `owedText`, `joinedCheckpoint` and `group-pending.ts` still read through `inStore`. The record read does not: it goes through `withStatusStore` and keeps the guess when the store is busy.
- **Bundles:** this row changes CLI code, so the committed plugin bundles differ from the build; the coordinator rebuilds them on the candidate.
- `run.ts` was already over 300 lines (334); it is now 349.
