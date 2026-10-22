# 011-107 with 011-103 slice 6: notes

Wave 14, W2. Two commits on 0.1.262, slice 6 first, then the overrun rule. A third commit holds the `scheduler.ts` edit the coordinator agreed to.

## Slice 6 (011-103)

`remainderSeconds(remainderMs)` sits beside `yieldText` in `src/core/status/next-step.ts`. `yieldText` and `yieldId` (`src/core/status/standing-groups.ts`) both read it, so a file published at −0.6 s and one at 0 s share one line. The "30 s" in the line comes from `YIELD_REMAINDER_MS`. Test: `test/scheduler/yield-remainder-text.test.ts`, first three cases. `grep -rn 'remainderMs / 1_000' src` finds one hit, in `remainderSeconds`.

## The overrun rule (011-107)

`#decide` in `src/core/scheduler/yields.ts`, after the cut and the turn:

1. The remainder is over 30 s: yield, as today.
2. The remainder is 0 or more, or `overruns(tier)` is false: `remainder`, as today.
3. The tier has run 30 s or more past its estimate: yield.
4. Otherwise: the new standing `{ kind: "overrun", yieldsAt }`. It reads "; the tier has run past its estimate and yields at HH:MM:SS, 30 s past it". The step is empty, because the reason gives the bound.

`overruns(tier)`: the tier has a file left to cut, and every file the yield would cut (the unfinished ones) has a last-known duration of at least `SHARE_FLOOR_MS`, imported from `sharing.ts`. An unknown duration counts 0. A tier whose files have all ended is never cut, as with `superseded`. The full checkpoint found this case: in `tier-ended-files.test.ts`, the run of a tier went on after it reported the end of every file. With no file left, the estimate read 0 s, and the timer cut the tier at 30 s. The coordinator chose this hold (option C, narrowed). The reason is below.

A remainder or overrun decision whose tier `overruns` records the tier's bound, `start + estimate + 30 s`, in `#bounds`. One unref'd timer is set at the earliest bound. When it fires it calls `recheck`. The scheduler's `#recheckTiers` runs `#cutTiers(null)` under the lock, so the tier yields with no other event. `ended` drops the tier's bound and sets the timer again or clears it. `close` clears it.

Once per key: the yield marks the cut files as any yield does (`#cut`), so the tier that runs them again does not yield at that key.

Type change, additive: `TierYield` gains `{ kind: "overrun"; yieldsAt: EpochMs }` in `src/core/types/standing.ts`. `isYield` accepts it. An older CLI that reads a newer daemon's row drops an `overrun` entry (the `isYield` filter) and keeps the older wording. No key change and no `schemaVersion` raise.

## The scheduler.ts edit, by coordinator agreement

Review it. The coordinator's reply of 2026-10-22 made `src/core/scheduler/scheduler.ts` this row's for one edit only:

- `new TierYields(() => this.#recheckTiers())`;
- `#recheckTiers()` is the earlier lock-run body of `#fileEnded`, with its one-queued guard (`#endCheck` renamed `#recheck`). `#fileEnded` keeps its `tier.changes.size === 0` return and then calls it;
- `#close` calls `this.#yields.close()` first.

The contract: one timer at most, unref'd, cleared when its tier ends and when the scheduler closes. `test/scheduler/tier-yields-bound.test.ts` checks it with fake timers.

## Residual: the hold until row 011-112

The finding came from the first version of `tier-yields-overrun.test.ts`: a tier of four files with no known duration under `onStart: "lookup-only"`, `G` promoted behind it. That version had no hold. The tier yielded at start + 30 s, and the next tier was `[G, s1, s2, s3]`, not `[G]`. `joinSpan` counts an unknown duration as 0 and shares every file under `SHARE_FLOOR_MS` (1 s). The promoted file then shared its tier with three cut files, which run again from their start. That tier holds cut files, so it never yields. `G`'s result waited longer than with no yield. The same holds for a known estimate under 1 s, the gh-62 case on 0.1.238.

So a tier whose cut files are under the floor does not yield past its estimate. Test: "a tier of files with no known duration does not yield, past its bound too (held until row 011-112)". Row 011-112 (the coordinator files it): a file that a yield cut does not share a tier with a promoted file. Then the hold goes. That row also covers a second case. A promoted file at or over the floor still shares a tier with cut files within `SHARE_RATIO` (4) times its own time, for example a 2 s promoted file beside 5 s cut files. No test covers this case.

## Other limits, not fixed here

- The bound is set when a check runs. When a file of the tier ends and no revision changed the tier, no check runs (`#fileEnded` returns). So the bound stays at the estimate taken at the last check, the larger one. The wait still ends by the tier's estimate at that check + 30 s.
- A wait that comes only from a recreate (the runner part waits for the run, the `unlisted` standing) is found only with the revision that changes an environment input. A later check with no revision, from the timer, a promotion or a file end, finds nothing waiting and drops that standing. Earlier checks with no revision did this already. The runner part has its own bound (`runner.timeoutMs` + 66 s, C15).
- A held tier (under the floor) keeps today's `remainder` wording, "its estimated remainder was 0 s, not over 30 s", until row 011-112.
- The scheduler-level tests run the scheduler's clock ahead of the real one (`now` with a skew). The timer fires on real time at `bound - now()` as computed at the check, so a clock that jumps after a check moves the bound only at the next check.

## C4 step 5: draft sentence

After "…exceeds 30 s (a file with no known duration counts 0)":

> It yields so too, once per file and key, once it has run 30 s past that duration, so a promoted wait waits at most the tier's estimate plus 30 s and the cancel, but only while every file it would cut has a last-known duration of at least 1 s (`SHARE_FLOOR_MS`), since a cut file under it would share the promoted file's next tier (`joinSpan`); the daemon checks the tier again at that bound with no event, and the wait's text names the time it yields at (amended 2026-10-22, the human, digest `triage/2026-10-22-digest.md` group B, row 011-107, gh-73; the hold until row 011-112).

C15's wait line: add "a tier past its estimate names the time it yields at" to the reasons in the `queued, promoted` item.

## Tests

- `test/scheduler/yield-remainder-text.test.ts`: slice 6's −0.6 s and 0 s files in one line, rounding, the threshold from the constant, and the overrun line, its group and its empty step.
- `test/scheduler/tier-yields-overrun.test.ts`, at the scheduler level: a 5 s estimate yields at its bound with no event after the promotion, and the named file runs alone; one already past the bound yields at the promotion; a tier within its estimate keeps the remainder rule, and 10 s past it reads `overrun` and waits; a tier with no known duration does not yield (row 011-112); no second yield at a key.
- `test/scheduler/tier-yields-bound.test.ts`, with fake timers: the timer re-checks at the bound and the tier yields; a remainder tier's bound is its estimate + 30 s; files under the floor or with no known duration set no timer; one timer, gone when its tiers end and on `close`.
- `test/scheduler/tier-yields.test.ts`: its "a tier of files with no known duration does not yield" case was removed. The case in `tier-yields-overrun.test.ts` replaces it and checks past the bound too.
