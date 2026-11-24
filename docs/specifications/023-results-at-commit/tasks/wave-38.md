# Wave 38 (row 023-81): names that runs write must not re-key tests that list a folder. Use /worker.

The human chose (2026-11-24): fix row 023-81 first and alone ("023-81 first"); rows 023-83 and 023-84 and round 12 follow. The base is 0.1.614 (wave 36 in it: 023-76 keys a listed folder by every name on disk, ignored included, with a segment mark).

Read `../spec.md` D2 and D4.9, `tasks/023-76-notes.md` (all, with both review repair sections), `reviews/0.1.612.md` (B1, S3) and `0.1.612-rereview.md` (its churn should-fix), and `../lessons.md` round 11 ("What went wrong": AA1; data under `tasks/023-80/data/`). Never write the lab VM host name, the company name, sandbox ids or home paths in committed files (`pnpm run check:private` with `set -o pipefail`; also grep your diff). Host is shared: direct vitest only with `timeout 600 pnpm exec vitest run --maxWorkers=2 <paths>`; no full suite; no version, no build; nothing left running (`squeal stop` in any tree you made before you finish); wait only on your own jobs.

## The defect (round 11, every session)

Tests that list a folder re-ran 8 to 42 s after their first run on the same side, with no edit and no restart: squawk's lint files on both sides (8 of 8 sessions), 4 Squeal `test/ci` files (10 of 10), one browser file (4 of 10). One agent waited 540 s; another never compared its 7 lint files. The cause, as round 11 reads it: a run writes a name into a folder that its own test or another test lists; since 023-76 the key covers every name on disk, so the write re-keys those tests. The 0.1.612 re-review found the same at a restart for fresh log names.

## Step 1: probe (no product change)

On this repository and on a squawk clone at the round's commit (`tasks/023-80/` has the scripts; a local clone is enough, no VM): run the folder-listing tests once each under the daemon and record, per listed folder, which names appear or change during or after the runs, which process wrote each (test process, runner, Squeal, the user), and which tests' keys moved. Write it as a table in `tasks/023-81-notes.md`. Stop and send the coordinator the table with your proposed rule before you change product code.

## Step 2: fix (after the coordinator's reply)

The direction to test first: a name that a test run recorded under Squeal wrote (the recorder sees writes; `Listings.ran` already knows the run's own outputs) does not enter a listing key, for that test or any other, while a name that appeared from outside Squeal's runs still does. Hard limits:

- N1 must stay fixed: an ignored name the user (or any process outside Squeal's test runs) puts into a listed folder still separates keys, before or during a run (`reviews/0.1.612.md` B1's gate ordering and the N1 tests stay green).
- The commit side's own-worktree rule for folder readers (023-70, restored in 0.1.612) stays.
- Tests that list no folder keep their keys; no `KEY_FORMAT_VERSION` raise without a coordinator request first (a raise is the human's call).
- A run-written name that later a user edits or replaces must count again (it stops being "the run's own").

Tests: a test that writes into the folder it lists keeps its key on the next revision and is not re-run; a second test listing the same folder is not re-keyed by the first test's write; a name the user adds still re-keys both; a restart with run-written fresh names (the re-review's log case) does not miss; round 11's shapes (the lint files' folder, the `test/ci` folder) as fixtures where cheap. Each fails without the fix.

## Ownership

`src/core/keys/**`, the recorder and observation code that records a run's writes, `src/core/daemon/**` for the listing acknowledgement, `src/core/store/**` if a write record needs a field, tests beside them. Do not edit `src/core/scheduler/**` or `src/cli/**` without a coordinator request.

## Done when

Step 1's table and the coordinator's reply are in the notes; tests fail without the fix; lint, typecheck, check:private; `squeal status --wait 60000 <changed paths>`; run `test/keys/*.test.ts`, `test/cli/status-at*.test.ts`, `test/cli/proof*.test.ts`, `test/daemon/at-asks*.test.ts`, `test/integration/glob-membership.test.ts`, `test/scheduler/extra-file-leaves.test.ts` directly. Measure on this repository: how many folder-listing tests re-run over 20 unrelated revisions before and after (the number goes in the notes).
