# 011-194 notes: one clock reading decides a tier's yield

Worker W2 of wave 34, 2026-10-25. Commit `601721cef` (after 011-193's `55a77a1a8`).

## The readings of one `TierYields.check`

`check` reads `context.now()` once and passes `reading`, a copy of the context whose `now` returns that value, to everything the decision calls. A helper can still read the clock in two ways: through `context.now()` of the context it was given, or through an object that holds its own clock. Each reading the row named is now one of these:

| Reading | Before | Now |
|---|---|---|
| `rankToBeat` | `context.now()` | `reading.now()` |
| `remainder` (twice), `byRemainder`, `boundOf` (twice) | `context.now()` | `reading.now()` |
| backlog quiet at a cancel | `context.now()` | `at` |
| `focusedWaiting` | `context.now()` | `reading.now()` (no edit: it takes the context) |
| `hasPromoted` | `Promotions.rankOf`, the promotions' own clock | `RunQueue.hasPromoted(where, now)` reads `rankAt(id, now)` |
| claim peek (`peekClaim`) | `Claims.holds(key)`, the ledger's own context, twice | `Claims.holds(key, at)` |
| `#publish`, `#arm` | own | own (row 011-194: they keep theirs) |

`Promotions.now()` had no caller and is gone. `Beat.at` is gone: every rank of a decision is read at `reading.now()`.

A fixed value makes no reading wrong. The claim's liveness and its first sight, the quiet's start and the focused entries' deadlines are judged as of the decision, which is at most the decision's own run time earlier than a fresh reading.

## The test clock (`test/scheduler/tier-yields-clock.test.ts`)

- `decisionClock`: it stands still from its first reading, which comes after the daemon registered. So the published rows' `at` is never older than the daemon, and `publishedYields` reads them.
- `nextCheck` frames exactly one `TierYields.check`: a `vi.spyOn(TierYields.prototype, "check").mockImplementationOnce` that calls the original. Within the frame, the clock moves 60 s on every reading after the first. At the frame's end it stops, and the standings are read from the store. The decision is what that check published. A spy on `store.meta.set` counts the readings until the yields row is stored. With one reading that count is 2: the decision's reading and `#publish`'s own.
- After the frame, the clock stands where `#publish` and `#arm` left it, so a recheck that follows sees a later time. The tests assert only the framed decision.
- For 011-195: this frame aims a clock jump at one decision without counting reads. A `cross` that targets each reading in turn (016-18 recommendation 3) can use it.

## Readings that tests still count

`tier-yields-named.test.ts` tests 10 and 11 move the clock after N readings (`stillClock().cross`). Test 10's `cross(2)` lands on `#arm` (the decision's reading, then `#publish`, then `#arm`). Test 11 changed to `cross(1)`, because its standing does not change, so `#publish` does not read. A later change to `#publish` or `#arm` can move them again.
