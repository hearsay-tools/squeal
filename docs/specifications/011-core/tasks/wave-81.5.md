# Wave 81.5: repair of review 0.1.478 B1 (covered-files retention)

Coordinator 9ddca779, 2026-11-14. Review `reviews/0.1.478.md` failed `cand/0.1.478` (`ee2d2827f`, rows 011-323 and 011-325) on one proven blocker, B1. Everything else in the candidate passed. Host policy and "not yours" as in `wave-81.md`.

## W2.5: repair B1 (row 011-325)

Use /worker. Shape: repair, test first. Resume of worker 2498379c.

Outcome: a covered-files record is never deleted while any of its files is queued or running, and it is kept at least 10 minutes after the last time any of its files left queued or running, also when that activity began and ended between two writes.

Read: `reviews/0.1.478.md` B1 (its reproduction and its repair note); `research/request-intake.md`, "Covered files (011-325)", condition 3.

Seam and lead: `writeCoveredFiles` (`src/core/store/covered-files.ts`), which never clears `idle_since` and deletes idle records without looking at their files, and the `pending` predicate `recordCovered` gives it (`src/core/scheduler/covered-files.ts`). First edit: the review's reproduction as a failing test in `test/scheduler/request-covered.test.ts`, then a queued and a running re-entry, then a file queued and ended between two writes. If the ledger cannot tell when a file last left queued or running, pick the smallest source that can (for example its latest stored result time) and name it in your notes.

Start from the candidate: `git fetch origin && git rebase origin/cand/0.1.478` (your eight commits are in it already and drop out).

Owns: `src/core/store/covered-files.ts`, `src/core/scheduler/covered-files.ts`, `test/scheduler/request-covered.test.ts`, `test/scheduler/request-intake-probe.ts`, `tasks/011-325/notes.md`.

Leave alone: everything else; the record stays written in the request's transaction; no change to the answers, the reader's signature or shape, keys or `KEY_FORMAT_VERSION`.

Stop and ask the coordinator if the repair needs a schema step, a new `FileState` field used outside these files, or a change to the reader's shape.

Done when: the new tests fail on `ee2d2827f` and pass after the repair; `request-covered.test.ts`, `request-intake.test.ts` and `test/daemon/covered-id.test.ts` pass; lint and typecheck pass. Commit on your branch; your final message names the commits and the source of "last left queued or running".

## R2: narrow re-review

After the repair lands on the candidate: the same reviewer role, pinned to the repaired candidate, checks only B1's repair against condition 3 and the review's reproduction, and that nothing else in `96e9fad22..` changed beyond the repair commits and the version bundles.
