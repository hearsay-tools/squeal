# R1 notes: a resumed session takes in its new daemon's start scan (review 0.1.290 B1)

Worker 6c97cdea, 2026-10-24. Brief: `tasks/wave-1b.md` R1. Baseline `int/015b-r1` (d1c093ae8). What the re-review and the next row read first.

## The rule

A consumer's code changes are its own in the revisions after its registration's `since` that are in none of its gaps. When the registration has no `scanned`, each point where it registered is followed by the daemon's start scan, if the next revision is a `start` one: that revision joins the point. The points are `since` (the first registration) and the `upTo` of each gap (each return from a park). So:

- the start scan after a fresh registration moves `since` up by one, as 015-20 did;
- the start scan after a resume extends that resume's gap by one;
- a revision in a gap (made while the session was away, a daemon live) is not the session's either;
- the session's own revisions before a pause stay its own, so a FAIL from them the pass counts late is still told, and status, Stop and `--changed` still count it.

## Seam map

| What | Where |
|---|---|
| The bound and its test | `CodeBound` and `isOwn` in `src/core/delivery/code-delta.ts`, next to the plan that applies it, so the pure planner imports nothing at run time |
| The bound of a registration | `seenUpTo` and `codeSeenUpTo` in `src/core/delivery/code-since.ts` |
| A resume records where it came back, an empty gap when nothing changed | `back` in `src/core/delivery/registered.ts` |
| Delivery: transitions, the first edit, too-big files | `toldKind`, `editToTell` (`code-delta.ts`); `newTooBig`, `codeStep`, `tellCode` (`code-deliver.ts`) |
| Status, Stop, `--changed` | `wentOverSince`, `changedSince` (`code-since.ts`), called by `code-status.ts`, `stop-code.ts`, `code-report.ts` with the whole `CodeSince` |
| Several consumers of one session | `earliest` keeps the bound of the registration with the lowest `since`, its gaps with it |

`delivery.ts` is unchanged: its line `() => codeSeenUpTo(store, consumer)` now passes the bound.

## Decisions the brief did not settle

1. **An empty gap marks a resume.** `back` added a gap only when revisions passed while away. Without one, the resume point is lost when no daemon ran, which is B1's case. A gap `(p, p]` holds no revision, so `changedAfter`, `editNotes` and the other test readers see no change. The only visible difference: a resumed registration is now stored as a record, not a bare number, when nothing changed while away. Every reader since gaps exist reads records.
2. **Gaps are not the session's for code.** Before, the code bound looked only at `since`, so a transition in a gap that the pass counted after the resume was told and counted. A fresh registration at the same point would take it in by count, and D7 says a function failing at registration never blocks, so the gap is left out too. The test readers already left gaps out (`changedAfter`).
3. **Too-big lines follow the same rule.** `newTooBig` tells a file too big to count only when its revision is the session's own. A file the start scan changed after a resume is not told.
4. **The JSON and text of `--changed` keep one revision.** `changedSince.revision` is still the bound's `since`, and the text still says `Changed since revision N, when this session registered.` The list leaves the gaps out; the line does not name them. No shape change.
5. **One `scanned` for every point.** `back` keeps `scanned` only when the same daemon is live and scanned at the resume, so the registration's `scanned` stands for all of its points. A resume scanned by a different daemon drops it, and then each point's next revision is checked. That revision is a `start` one only after a daemon restart right after the point: the rare case 015-20 note 4 accepted.

## Type changes

- `CodeBound` (new) and `isOwn` (new), exported from `code-delta.ts`.
- `CodePlanInput.seenUpTo`: `RevisionNumber | null` to `CodeBound | null`. Internal; built only in `code-deliver.ts`.
- `codeSeenUpTo` returns `CodeBound | null` (was `RevisionNumber | null`).
- `tellCode`'s `since` thunk returns `CodeBound | null` (was `RevisionNumber | null`).
- `CodeSince` extends `CodeBound`: it gains `gaps`. Additive.
- `wentOverSince` and `changedSince` take a `CodeBound` (was a `RevisionNumber`).
- Nothing in `src/core/types/` changed. The stored registration format is unchanged; `back` writes one more gap.

Three tests passed a bare revision and now pass a bound: `test/code/delivery/catch-up.test.ts` (015-20, this seam), `test/code/delivery/code-command.test.ts` (015-27's `--told` case: `() => 2` to `() => ({ since: 2, gaps: [] })`), and `test/code/pass/move-history.test.ts` (015-17: passes the `CodeSince`, not its `since`). Only call sites changed; no expectation did.

## Tests

`test/code/delivery/resume.test.ts`, new. Each case runs the real `createDelivery` register, unregister (which parks) and tool boundary, with no daemon, and reads status, blocking Stop and `--changed` through `codeStatusOf`, `codeStopReason` and `readCodeReport`:

- the review's reproduction: the start scan after a resume is not told, is in the view by count, and is not in status's count, Stop or `--changed`; the own change from before the pause is in all three; a later own edit is told;
- the own change from before the pause, counted by the pass only after the resume, is still told (the check that fails when the whole bound is raised);
- a revision made while away with a daemon live, counted after the resume: not told, not counted;
- an edit mark in the start scan after a resume: no `STILL FAIL`; the next own edit: one;
- two pauses: each start scan is taken in, the edit between them stays the session's;
- a non-start revision after a resume is told;
- a fresh registration on the same four readers (015-20's case).

Mutation checks, each run once and restored: dropping the empty gap fails 4 of 7; raising `since` to the last point with no gaps fails 4 of 7, the own-change cases among them.

## For the next rows

- `src/core/delivery/code-since.ts` is 138 lines; `code-delta.ts` 234.
- The bundle-drift tests fail until the candidate's build, as after every row of 015. This row built no bundle.
