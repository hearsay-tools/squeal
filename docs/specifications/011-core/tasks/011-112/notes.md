# 011-112: cut files do not share the next tier of the file a yield served

Wave 15 W2. Baseline 804fc3584 (main with 0.1.265). Closes the hold that 011-107 left (`tasks/011-107/notes.md`, "Residual") and review `reviews/0.1.265.md` S1.

## The rule

A tier that is not the backlog's never holds both a file that an overrun yield cut and a file that it did not cut. An overrun yield is one of a tier that has run 30 s past its estimate (row 011-107). Files that one overrun yield cut can share a tier with each other. Backlog tiers and backlog slots do not change.

A file that the remainder rule cut (estimated remainder over 30 s, row 001-381) shares a tier as before, by `joinSpan`.

## The reason

- An overrun proves that the cut files' last-known durations are wrong: the files ran 30 s past them and did not end. A cut file runs again from its start. If it shares the next tier with the file the yield served, that file's result waits for the full re-run, which is longer than with no yield. `joinSpan` cannot see this. It counts an unknown duration as 0 and shares every file under `SHARE_FLOOR_MS` (1 s). It also shares a file within `SHARE_RATIO` (4) of another, for example a 2 s promoted file beside 5 s cut files (S1).
- A remainder cut proves nothing wrong. Its files have a last-known duration over 30 s, so only a file of 7.5 s or more shares a tier with them. That is the accepted 001-184 trade. A broad rule that kept every cut file apart broke `test/scheduler/tier-yields.test.ts` case 2 (row 011-51). There, `s2` and `s3` (100 s) would wait a full extra tier after the edited `s1` (100 s), and `s1` would gain nothing. The coordinator chose the narrow rule on 2026-10-22.
- The rule covers an edit's wait as well as a promoted file. The overrun yield fires for both (`waitedFor`: `hasRecentAfter` or `hasPromoted`). If only promoted files were kept apart, the removal of the hold would make an edited file wait for the cut files' full re-run.

## Seam map

- `src/core/scheduler/yields.ts`: `TierYields` keeps its cut marks (`#cut`). Each mark now records `past`: whether the yield cut the tier past its estimate. In `check`, `past` is `remainder(context, tier) < 0`. That separates the two yields exactly, because a remainder yield needs a remainder over 30 s and an overrun yield needs one of −30 s or less. `cutPastEstimate(file)` is the read-only view for tier selection. `holds` is the one test of whether a mark still applies (key unchanged, no result landed after the cut). `#forget` uses it too. `overruns` lost the `SHARE_FLOOR_MS` hold. It keeps only "a file is left to cut", so a tier with all files ended still never yields past its estimate.
- `src/core/scheduler/sharing.ts`: `TierSpan.cut`, the `CutFiles` view type and `NONE_CUT`. `joinSpan(span, durationMs, cut)` returns `null` when the span's `cut` differs from the file's.
- `src/core/scheduler/tiers.ts`: `selectTier(context, ledger, busy, cut = NONE_CUT, turnDue)`. It passes `cut.cutPastEstimate(file)` to `joinSpan` only where `joinSpan` applies: not the backlog, not a slot. Both recursive calls pass `cut` on.
- `src/core/scheduler/scheduler.ts:721` and `:727`: pass `this.#yields`. This is the only `scheduler.ts` edit, by coordinator agreement, in a commit of its own.
- `src/core/scheduler/slots.ts`: no change. Its `SHARE_FLOOR_MS` use groups light pytest files into a slot and has nothing to do with cuts.

## Proposed spec text (the coordinator writes it)

C4 step 5. Replace "This holds only while every file it would cut has a last-known duration of at least 1 s (`SHARE_FLOOR_MS`), since a cut file under it would share the promoted file's next tier (`joinSpan`); row 011-112 removes this hold." with:

> A tier that is not the backlog's never holds both a file that such a yield cut and a file that it did not cut. So the result of the promoted file, or of the edit's file, does not wait for the cut files to run again from their start, whatever their last-known durations (amended 2026-10-22, row 011-112, review `reviews/0.1.265.md` S1). A file that the remainder rule cut shares a tier by the tier-sharing rule, as before: its last-known duration is over 30 s, so it shares only with a file of 7.5 s or more.

C4, the tier-sharing paragraph ("An edit's tier takes a file only beside files of a comparable last-known duration"): after "A file left out stays queued in its place and leads a later tier.", add "A file that a yield cut past its estimate shares only with files that the same rule cut (step 5, row 011-112)."

C15, Rank: after "so a promoted file leads its own tier", add "and never shares it with a file that a yield cut past its estimate (C4 step 5, row 011-112)".

## Tests

- `test/scheduler/tier-yields-overrun.test.ts`, at the scheduler level:
  - The 011-107 test "a tier of files with no known duration does not yield, past its bound too (held until row 011-112)" is turned around, and its comment is gone. Such a tier yields. `F` runs alone and is current while the cut files are still held. The order is `[[F], SLOW]`. The test runs for a named wait and for an edit alone.
  - S1: a 2 s file and 5 s cut files, for a named wait and for an edit alone. Same assertions.
  - Both kinds of cut side by side, with one 10 s named file: an overrun cut of 5 s files gives `[[F], SLOW]`. A remainder cut of 40 s files gives `[[F, s1, s2, s3], [s4]]`.
  - With the rule taken out of `joinSpan`, the five overrun cases fail: the four above time out on `F`'s result, and the side-by-side overrun case fails on its order. The remainder case passes either way.
- `test/scheduler/tier-yields-bound.test.ts` (fake timers): "files under `SHARE_FLOOR_MS` or of no known duration arm no timer" is turned around. They yield at the timer, 30 s past their estimate. New: an overrun yield's files read as cut past their estimate until their key moves, and a remainder yield's do not.
- `test/scheduler/tier-sharing.test.ts`: `joinSpan` keeps a cut file apart from one that was not cut, under the floor too, either way round. Cut files share within the usual bounds.
- Unchanged and passing: once per key ("a tier holding a file the overrun cut does not yield again at that key"), `tier-yields.test.ts` case 2.

## Limits, not fixed here

- Order is not changed. A promoted file always leads the first group, so a named wait always leads the next tier. An edit's file leads only when the queue order puts it first. Cut files queued again get a later sequence, so ties go to the edit. A cut file with a shorter last-known duration in the same class still goes first. In that case the edit waits for the cut files' tier as before, and then runs in its own tier. That tier is one run's fixed cost later than it would be if the edit had joined the cut files' tier.
- The status wording follows on its own. A tier of files under the floor or with no known duration now reads `overrun` with the time it yields at, not "its estimated remainder was 0 s". `next-step.ts` and `standing-groups.ts` did not change.
