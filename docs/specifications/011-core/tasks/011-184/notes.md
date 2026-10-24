# 011-184: a wait's promoted file does not cut a file the same or an earlier wait selected

Worker d16e9716, wave 32 W15 (`tasks/wave-32.md`), from main at 2e3369522, 2026-10-24. Shape: slice. Builds `tasks/011-180/notes.md` section 6 on spec 011 C4 step 5 and C15 Rank as amended 2026-10-24.

## The change

- `rankToBeat` (`src/core/scheduler/yields.ts`): the rank a promoted file must be below to make a tier yield. `Infinity` before the tier has run `YIELD_REMAINDER_MS`; then the least `queue.rankOf` of the tier's unfinished files (`unfinished`, so `Tier.ended` counts), a file no open wait selected counting as `Infinity`.
- `waitedFor` asks it of each promoted file before the claim (`runsSooner`). A file at or above the rank does not count, and sets `named`. The result is `"work"`, then `"recheck"`, then `"named"`, then `null`.
- `#decide` returns `{ kind: "named" }` after the runner, recheck, turn and cut checks, before the remainder rule. The remainder rule moved unchanged into `byRemainder`, so `#decide` is CC 18 (it was 21, over Squeal's threshold of 20, before the slice).
- `RunQueue.rankOf(ref)` (`queue.ts`): additive, `Promotions.rankOf` by `testFileId`. It holds for queued and running files, since a promotion stays open while one of its files runs.
- `TierYield` (`src/core/types/standing.ts`) gains the kind `named`; `isYield` accepts it; `yieldText` (`src/core/status/next-step.ts`) words it `; the tier does not yield: it runs a file this wait or an earlier one selected`. `yieldStep` gives it the not-yielding step, as `cut` and `turn`. `yieldId` groups by the kind, with no change.

No key, store, validity or key-format change.

## Decisions the spec did not settle

1. **A runner that does not cancel, or a backlog slot**, with only rank-refused promoted files waiting, publishes `runner`, as before: those files counted as work then. The runner is the binding reason.
2. **Rank before claim.** A promoted file that ranks at or above the tier's files does not count whatever its claim, so it starts no one-second recheck. A claimed file that ranks first still makes the tier `recheck`; `recheck` wins over `named`, since its claim may end and cut the tier.
3. **Reason order.** `runner`, recheck, `turn`, `cut`, then `named`, then the remainder rule. So the line names `turn` or `cut` when one holds, and `named` only otherwise.
4. **No bound for `named`.** `boundOf` returns `null`: only an event changes it. A file's end (the wait's file ends, so the rank to beat rises), an edit, a promotion or a runner part checks the tier again. A promotion that passes its deadline needs no check: nothing then waits.
5. **A tier under 30 s** is checked with no new bound at 30 s. Under 30 s, a promoted file either yields at once (remainder over 30 s) or waits for the remainder bound, which falls past 30 s, where the rule applies.

## Tests

`test/scheduler/tier-yields-named.test.ts`, notes 011-180 section 6's seven, on `catch-up-fixture.ts` with the clock moved by `advance`. Red on main at 2e3369522: 1, 5, 6 and 7 (each: `expected true to be false` on `tier.cancelled`). Tests 2, 3 and 4 pass on main by design ("as today"); each still fails an implementation that refuses every promoted file past 30 s. Test 3 needs a 35 s estimate: the earlier wait's P must not cut the tier when it comes (remainder 25 s), so the later wait's check is the one that yields.

## For whoever continues

- `yields.ts` is about 450 lines, over the styleguide's 300. A split candidate: `yieldsMetaKey`, `publishedYields` and `isYield` (the status side) into their own module; the importers are in `src/core/status/`, outside this row.
- The fake runner names no file ends during a run, so no test here covers the rank rising when the wait's own file ends mid-tier. `unfinished` already reads `Tier.ended`; a Vitest-backed test (`tier-yields-vitest.test.ts`'s fixture) could add it.
- Landing check, from 011-180 section 8: that row's probes over 24 hours; yields with `cutNamed` over 0 and a wall of 30 s or more should be none.
