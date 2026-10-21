# Wave 8: triage round 9, groups A to F

The human, 2026-10-21: digest groups A to F as recommended, follow-ups 011-54 to 011-57 and 011-51's test 10 approved; at most three of this coordinator's workers at once. Catch-up speed stays first (the human, 2026-10-19). W1, W2 and W3 own disjoint files and run in parallel; W4 takes W3's slot and W5 W2's. The rest of the wave (011-55, 011-62, 011-64, 011-65, 011-67, 011-68, 013-04, 005-72) is briefed as slots free; 011-66 waits for 011-32, 011-34 and 014's daemon changes.

Every brief: base main at or after the commit that adds this file; no version bump; no key-format change (if `test/keys/key-format.test.ts` asks for one, stop and say so); the verdict is `squeal run --all --wait`, and a file that fails under load and passes alone is named in your summary.

## W1: 013-03, 011-54, 011-56, the Vitest runner reports each file's end and wall time during the run

Use /worker. Shape: slice. Read board rows 013-03, 011-54 and 011-56, `013-vitest-runner/research/issue-62.md`, spec 011 C4 step 5 as corrected 2026-10-21, 013 V4, `reviews/0.1.237.md` B2, `tasks/011-51/notes.md`.

Outcome: a file's `durationMs` is its wall time, the scheduler learns each file's end while its tier runs, the supersession cancel takes only the unfinished files, and a cancel names its cause.

Seam: `moduleDuration` and `moduleEnd` in `src/runners/vitest/reporter.ts`; `fileDurations`, `completedFiles` and `CANCELLED` in `src/runners/vitest/run.ts`; the supersession test in `src/core/scheduler/yields.ts`. First edit, a lead: stamp each module's start and end in the collector, and compare them with the diagnostic sum on a file with a slow `beforeAll` and concurrent tests, to find what the sum misses. Commits in row order. An ended file's result is still stored only after the completion barrier and the stability check.

Tests first, red before: each row's done-when on the board. Owns: `src/runners/vitest/` (reporter, run, moved, results), the run report's type, `src/core/scheduler/yields.ts` and the cancel call in `scheduler.ts`, their tests. Not yours: `src/core/status/`, `src/cli/`, `src/core/scheduler/promotions.ts`, `src/core/slow/`, spec text, the board, bundles.

Done when: the rows' tests are red before and green after; existing `test/runners/vitest/` and `test/scheduler/` tests pass unchanged or each change is named with its reason; `npm run lint`, `npm run typecheck` and `squeal run --all --wait` pass, their output in your summary.

## W2: 011-58 and 011-57, status names what runs, what waits and who holds the slow slot

Use /worker. Shape: slice. Read board rows 011-58 and 011-57, `011-core/research/issue-61.md`, `004-slow-suites/research/issue-58.md`, spec 011 C6 and C15, 004 D2 and D8.

Outcome: plain status and `--json` list the running and queued test files with their projects, name each occupied slow-slot permit's holder, and show each file's own yield inside a group.

Seam: `src/core/status/standing.ts` (the pending reasons), `standing-groups.ts` (`groupId` reads no `yields`), `format-status.ts`, `snapshot.ts`; the `holder` table each permit writes in `takePermit` (`src/core/slow/slot.ts`: pid, worktree, since). First edit, a lead: read every occupied permit's `holder` row beside `slowSlotHeld`, and carry it into the slow pending reason. D2 allows several holders: never assume one. A cut list states how many files it omits; a stale or unreadable holder says so. Prioritization across worktrees stays out.

Tests first, red before: the rows' done-when on the board. Owns: `src/core/status/` except `why*.ts`, `src/core/types/standing.ts`, the holder read in `src/core/slow/slot.ts`, their tests. Not yours: `src/runners/`, `src/core/scheduler/`, `src/cli/status-wait*.ts` and `status-paths.ts` (W3), spec text, the board, bundles.

Done when: the rows' tests are red before and green after; existing `test/status/` tests pass unchanged or each change is named with its reason; `npm run lint`, `npm run typecheck` and `squeal run --all --wait` pass, their output in your summary.

## W3: 011-63, a named wait holds for its matched files, and the selection has one JSON key

Use /worker. Shape: slice. Read board row 011-63, `research/issue-59.md`, `research/issue-65.md`, `research/issue-51.md` (section 3), spec 011 C6 and C15, 005 D2.

Outcome: a wait with matched and unmatched paths keeps the matched files' promotion, waits for their verdict and reports the unmatched paths beside it; both JSON forms carry the selection under `selection`, `named` and `wait.testFiles` kept; a timed-out wait says its files were promoted and what holds them.

Seam: the outcome chain at `src/cli/status-wait-paths.ts:328`; `namedSnapshotCommand` in `src/cli/status-paths.ts` and the wait's JSON in `status-wait.ts`; the final read of a timed-out wait, where `promotedIds` (`src/core/scheduler/promotions.ts`) drops a promotion with `until <= now`. First edit, a lead: settle the unmatched paths beside the matched files' outcome, not before it. Exit: 1 when a matched file fails, otherwise 3 for an unmatched path.

Tests first, red before: the row's done-when. Owns: `src/cli/status-wait*.ts`, `status-paths.ts`, `named-*.ts`, `verdict.ts`, `wait-arg.ts`, the `--help` text, `commands.md` in every plugin copy, `promotions.ts` for the label only, their tests. Not yours: `src/core/status/` (W2), `src/runners/`, other `src/core/scheduler/` files (W1), spec text, the board, bundles.

Done when: the row's tests are red before and green after; existing `test/cli/` wait tests pass unchanged or each change is named with its reason; `npm run lint`, `npm run typecheck` and `squeal run --all --wait` pass, their output in your summary.

## W4: 011-60 and 011-59, a failed import records its target, and a timeout records its own origin

Use /worker. Shape: slice, two rows on two seams, one commit each. Read board rows 011-60 and 011-59, `research/issue-56.md` (F1, F2, Recommendation), `research/issue-66.md` (Q1, Recommendation), spec 011 C3, C5, C7 and C12.

Outcome: a child's failed import of a missing `file:` or relative target records that path, so creating it re-keys the file; a timed-out or crashed check records origin `own` with no inherited commit.

Seam, 011-60: the resolve hook in `src/runners/observe/recorder.cjs` (lines 186 to 205 at the research's commit). First edit, a lead: when `nextResolve` throws for a `file:` specifier, or a relative one resolved against the parent URL, record that exact path as a read, then rethrow. Guess no candidates for bare or extensionless specifiers. The "matches no file" note is out of scope.

Seam, 011-59: `unknownState` in `src/core/state/derive.ts` keeps `origin` and `commit` from the state before the timeout. First edit, a lead: set origin `own` and drop the inherited commit there. Part (b) only: no new origin line on UNKNOWN notices.

Tests first, red before: the rows' done-when on the board (011-60 end to end with a real child process, as `probes/issue-56/`). Owns: `src/runners/observe/`, `src/core/state/derive.ts`, their tests. Not yours: `src/core/scheduler/`, `src/runners/vitest/` (W1), `src/core/status/` (W2), `src/cli/`, `src/core/delivery/` (ask if a test shows it needs a change), spec text, the board, bundles.

Done when: both rows' tests are red before and green after; existing `test/runners/observe/` and `test/state/` tests pass unchanged or each change is named with its reason; `npm run lint`, `npm run typecheck` and `squeal run --all --wait` pass (bundle drift excepted), their output in your summary.

## W5: 011-61 design, validation holds while the index has unmerged paths, and a hold bound to a command

Use /worker. Shape: survey, a design draft for the human. Outcome: `tasks/011-61/design.md`, which the human can accept as one amendment to 011 C9 (and C2, C6 or C8 where touched).

Read: board row 011-61; spec 011 C2, C6, C8, C9 and `status.md`; `research/issue-68.md` with `probes/issue-68/`, `research/issue-49.md`; rows 011-08 (stop until the next edit) and 011-30 (handoff). Seams, read only: `src/core/hash/git-index.ts`, `src/core/watcher/paths.ts`, `src/core/daemon-loop/head.ts`, `src/core/scheduler/head-move.ts`, `src/cli/stop.ts`, `src/cli/stopped-mark.ts`.

Answer, each with an evidence tag and one recommendation:

1. What starts and ends the unmerged hold. The resolved write is a revision while the path is still unmerged, and `git add` makes none (issue-68, "For the spec"): an index observation that re-plans the held revision, conflict markers in the bytes, or both. Rebase, cherry-pick and `stash pop` conflicts too.
2. What status, the hooks and a named wait say during the hold: one line naming the paths, and no false FAIL or recovery.
3. The command-bound hold (gh-49): process lifetime against a time window, expiry, explicit resume, what a crash of the command leaves, and how it differs from `squeal stop`.
4. The code rows: seams, owners, the done-when as tests.

Include spec text as drafts and the rejected options. Owns `tasks/011-61/` only, probes under `tasks/011-61/probes/` in a throwaway repo under `/tmp` with `HOME` and `XDG_*` there, only while the one-minute load is below 24; no full suite, no build. Not yours: spec text, `status.md`, the board, product code. Done when `design.md` is committed. Stop: the human's dated acceptance.
