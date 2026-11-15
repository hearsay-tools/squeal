# 011-355 notes: the command hold's end and the slow lane close split into decide and act

Worker a32a803e, wave 100 W2, 2026-11-15. Commit `16fd408c8` (code and tests).

## What changed

- `src/core/scheduler/command-hold.ts`: `decideHolds(entries, at, gone)` is pure. It returns `ended` (each with its cause), `left`, `wakeAt` (the earliest `until` left, or `null`), `prune` (some entry ended) and `next` (`"hold"` while an entry is left, else `"free"`). `holdEnd(entry, at, gone)` is the per-entry rule; `endedNotes(ended, last)` gives the notes. `CommandHold.check()` reads the row, decides, and only when `prune` removes the entries inside one transaction (`pruneCommandHolds` with `holdEnd`, the notes in the same transaction, as row 011-231 requires); it arms its wake at the decision's `wakeAt`.
- `src/core/scheduler/slow-release.ts`: `decideRelease(lanes, at, afterMs = SLOW_RELEASE_MS)` is pure over `ReleaseLane { lane, busy, endedAt }`. It returns `idle` (open lanes no tier keeps), `close` (idle lanes past their bound) and `wakeAt` (the earliest bound of an idle lane, a passed one too). `SlowRelease` builds the lanes in `#decide()` and applies: `idle()` closes `idle`, `#due()` closes `close`, `arm()` arms `atMost(wakeAt)`. `#idleLanes` and `#dueAt` are gone.
- `scheduler.ts` is unchanged: `commandHold()` still branches on `check()`.

## Decisions the design record did not settle

1. **The hold's actions stay in `scheduler.commandHold()`.** The brief asked `decideHolds` to say what to do (prune, cancel held tiers, close lanes, pump). The pump depends on whether the previous read held, which is not one of the three arguments. So the decision carries `prune` and `next: "hold" | "free"`; `"hold"` means cancel held tiers and close idle lanes, `"free"` means pump if the previous read held. The scheduler applies them as before. 011-356's step can switch on `next`.
2. **The field is `next`, not `then`.** Biome's `noThenProperty` rejects `then`.
3. **The transaction decides again.** As today, `check()` reads once outside a transaction and, when some entry ends, the removal reads the row again inside its transaction with the same rule (`holdEnd`). The decision applied is the one over the second read. `gone` is asked as often as before (once per read for each entry whose `until` is ahead).
4. **`decideRelease`'s `wakeAt` counts a passed bound.** Today `arm()` arms at the minimum of all idle lanes' bounds, past ones included. `wakeAt` keeps that exact time, so no wake moves (a wake at `now` instead of a passed time would change the written order among owners due at once).
5. **`decideRelease` takes `afterMs` as a third, defaulted argument.** The record names `(lanes, at)`; the bound is the instance's option (`slow.releaseMs`), so it is a parameter.
6. **`SlowRelease` calls `host.endedAt?.()` once per decision**, not lazily per lane without its own end. The scheduler passes no `endedAt`; `test/daemon/slow-instance.test.ts` does, and it passes.

## Type changes

All additive and exported: `HoldDecision`, `holdEnd`, `decideHolds`, `endedNotes` (`command-hold.ts`); `ReleaseLane`, `ReleaseDecision`, `decideRelease` (`slow-release.ts`). No existing type changed.

## Deleted test cases (covered by the tables)

`test/scheduler/command-hold.test.ts`:

- "4: an entry past its `until` ends at its bound with one note; its later removal changes nothing" (the timer case, a real 2 s bound). Covered by the `decideHolds` rows "an entry at its `until` ends by its bound" and "a bound that passed wins over a holder that is gone", and by the apply case in `decide-holds.test.ts` (the wake at `until` on the virtual clock, the bound note). The scheduler path from the wake to `commandHold()` stays covered by the model test, whose holds end at `until`.
- "6: with two entries the hold ends when the second goes". Covered by the rows "two entries: one ends, the other holds and sets the wake" and "both end, each with its own cause".

`test/scheduler/slow-release.test.ts` (module cases on the virtual clock):

- "counts from the latest slow run's end": row "counts from the latest run's end, not the first".
- "keeps a lane whose tier is in flight; its end arms the count again": row "a lane with a tier in flight stays past its bound and sets no wake"; the re-arm at a tier's end stays covered by "the bound passes during a slow selection that starts a tier".
- "closes a lane at its own bound while another lane keeps ending tiers (review 0.1.396 S4)": row of the same name.
- "keeps the instance of a lane waiting for its load guard, not another lane's past its bound": row "a lane waiting for its load guard stays; another past its bound closes"; the selection's end closing a lane stays covered by "keeps the instance through a slow selection".

Kept (the apply): the first bound case, both selection cases, the hold's close, the drained pass's release, and the scheduler describe.

## Checks

- `pnpm run typecheck`: pass. `pnpm run lint`: pass (3512 files).
- `squeal status --wait 60000` at revision 7 (commit `16fd408c8`): `decide-holds`, `decide-release`, `command-hold`, `command-hold-note`, `command-hold-slow`, `slow-release`, `slow-release-setup`, the five `merge-hold*` files, `test/daemon/slow-instance.test.ts`, `test/keys/key-format.test.ts` (no raise) and `model-scheduler.test.ts`: each a current pass. The model test ran in Squeal's pass with the one-minute load at about 7.0 to 7.5 on 24 CPUs.
- 601 other test files that read the two modules were still queued at the last read; their verdict was not seen.
