# 005-106 notes: the per-session view holds the non-pass states and reads the rest through the birth mark

Worker 1519b409, 2026-11-17. Wave 21, W1 part 2 (`../wave-21.md`), on 0.1.545 (`bcb54db8d`). Coordinator 4d2ecbfc. Design: `../../research/consumer-view-design.md`, design N. Birth marks: row 005-105 (`../005-105/notes.md`).

## What changed

| File | Change |
|---|---|
| `src/core/delivery/view-mark.ts` (new) | The consumer's mark in a `view-mark:<worktree>` slot (`{ mark, at }`); `registrationSeed` (the non-pass rows and the high mark, or every row and no mark when the store keeps no marks); `recordViewMark`; `markedView` (the view `planDelta` reads); `untoldStates` (the waiter's untold) |
| `src/core/delivery/delta.ts` | `viewThroughMark`: a state with no entry that was born before the mark reads as `{ outcome: "pass", fingerprint: null }`. Pure; the equivalence test runs it |
| `src/core/delivery/delivery.ts` | `plan` reads `markedView` (lines 218 and 219); `registerNow` seeds `registrationSeed`'s rows and records the mark (lines 568 to 571); one import (line 101). Nothing else in the file |
| `src/core/delivery/turn.ts` | `owedScope`'s untold is `untoldStates` (lines 212 and 213); one import (line 13) |
| `src/core/store/view-seed.ts` | `checksBornAfter` (identities of checks born after a mark) and `untoldBornAfter` (the untold read joined to `state_born`, `b.id > mark`) |
| `src/core/types/store.ts` | `WORKTREE_META_ROWS.viewMark` (line 394), so the slot goes with a removed worktree |
| `test/state/helpers.ts` | `freshStore` keeps birth marks, as a daemon of 0.1.545 leaves a store; `releasedStore` keeps none |

Not changed: `consumers.ts` and `states.ts`. Both are in the key-format validity bundle; the new reads live in `view-seed.ts`, which is outside it. `untold`'s condition is `untoldStates` in delivery, not a change to `KnownStateRepo.untold`. Also not changed: `registered.ts`, `slots.ts` (in the bundle), `header.ts`, `format.ts`, `late*.ts`, `src/harness/**`, `expiry.ts`.

## Decisions

1. **The mark is read at the reader, not trusted from the slot alone.** `markedView` and `untoldStates` use a consumer's mark only while the store still keeps marks (`currentBirthMark` not `null`). A registration on a store without marks seeds the full copy and clears the slot.
2. **A consumer's slot ends as other slots do.** Every registration writes or clears it, and `writeSlot` drops the slots of consumers gone at its next write (the `registration-owed` pattern). `expire`/`drop` are unchanged. A stale mark under a full copy is harmless: every state born at or before it existed at the later registration and has a row in that copy.
3. **A retired and re-added check reads as new** (born after the mark). The copy reads it the same, because `sink.retire` removes the told non-failure's row. `sink.retire` is the only path that deletes a state in a live worktree.
4. **A wrapped store (`Proxy`) reads as unmarked.** `connectionOf` refuses a proxy on purpose (`import-graph.test.ts` pins it), so `currentBirthMark` reads `null` through one. Production delivery gets the store `openStore` returned. The one production proxy (`scheduler/hold.ts`, `sinkWithoutResults`) feeds only the state sink, which reads no mark. Consequence in tests: `idle-scope.test.ts` and `idle-cost.test.ts` count reads through a proxy, so they keep unarmed stores and test the full-copy path. R14 under the marks is in `view-mark.test.ts`. I tried a proxy-aware `connectionOf` and reverted it, because it breaks that contract.
5. **Two `delivery.test.ts` assertions changed.** "drops view entries of retired checks told as passing silently" and "delivers a retired check told as failing once" asserted the stored rows `[B]`. B is a pass at the registration, so under the marks it has no row. The assertions now read `[]`; the entries told are unchanged.

## The 16 rules (section 1) and the tests that hold them

`freshStore` keeps birth marks, so every `delivery.test.ts` and `late-fixture.ts` test below registers with the non-pass seed and the mark.

| Rule | Tests |
|---|---|
| R1 a pass never told is written silently | `delivery.test.ts` "writes a pass never told…"; `view-mark.test.ts` "reads a check born after it as never told…" |
| R2 `beforeFailing`, 001-101 | `delivery.test.ts` "reads the change from the prior known state…", "keeps a failure with no prior known state first observed", the 001-101 case; `view-mark.test.ts` "reads a pass it did not seed as the told pass it was" |
| R3 a changed failure | `delivery.test.ts` `it.each` "fail-changed" |
| R4 failures known at registration told once | `delivery.test.ts` "reports pre-existing and inherited failures once"; `view-mark.test.ts` "seeds the states that are not pass…" |
| R5 retired | `delivery.test.ts`, the three "retired" tests; `view-mark.test.ts` "reads a retired and re-added check as new" |
| R6 broke and recovered; skipped and back | `delivery.test.ts` "stays silent when a check breaks and recovers…", "…skipped and comes back unchanged"; `view-mark.test.ts` "tells nothing of a pass that stays a pass…" |
| R7 own edit PASS -> UNKNOWN | `own-edit-unknown.test.ts` (`freshStore`) |
| R8 origins named | `delivery.test.ts` "names the root…" |
| R9 re-registration | `delivery.test.ts` "re-seeds the view…"; `late-paths.test.ts`; `view-mark.test.ts` "drops the earlier view and mark at a registration again" |
| R10 unregister | `delivery.test.ts` "unregister drops the consumer and its view"; `view-mark.test.ts` "forgets a consumer's mark once it is gone" |
| R11 late state, own count | `late-paths.test.ts` (`late-fixture.ts`, `freshStore`) |
| R12 peek | `delivery.test.ts` "consumes regressions only…"; the peeks of `view-equivalence.test.ts` |
| R13 Stop's untold required failures | `stop-slow-untold.test.ts` (a real daemon, which makes the marks); it reads told failures, which are seeded |
| R14 the waiter's untold | `view-mark.test.ts` "counts as never told only the states born after it"; `idle-scope.test.ts` (unarmed: the full copy) |
| R15 pruning keeps check ids a view names | unchanged: a told pass with no entry still has its known state, which keeps the check (`prune.ts`); `prune.test.ts` |
| R16 `status --wait` | nothing stored; `test/cli/kept-header.test.ts` |
| All, together | `view-equivalence.test.ts`: the real `planDelta` and `restrictPlan`, 10,000 runs of 24 steps, seed 11. Against the full copy: 0 runs tell other entries, 0 hold another view |

**Upgrade.** `view-mark.test.ts`, "the upgrade". A registration on a store without marks gets the full copy and no mark. A session registered before the upgrade delivers as before (PASS -> FAIL, first observed) and keeps its full view; its next registration seeds as this release does. A store that lost a trigger reads every mark as absent.

**Mixed version, on record.** In `view-equivalence.test.ts` an earlier release delivers to a consumer this release registered. It differs from the copy in only two ways: `to-unknown:pass->unknown -> nothing` (a PASS -> UNKNOWN goes untold), and `pass-to-fail:pass->fail -> first-seen-fail:skip->fail` (a PASS -> FAIL through a skip is worded as first observed from the skip). No failure is repeated or lost. The lost-trigger test shows the same miss for a PASS -> UNKNOWN.

## Timings

`measure.ts` (this folder): one worktree of 32,000 known states, 32 failing, plus 50 states born after the registration. Write-marker and birth-mark triggers on. 15 rounds; every registration write rolled back. Node 26.13.0; the host's own load, 1-minute average 10.1 to 11.3 on 24 vCPUs.

| Step | Before (full copy) | After (non-pass seed and mark) |
|---|---|---|
| Registration write (`seedView`, plus `registrationSeed` and the slot after) | 86.4 ms (p90 96.1) | 1.9 ms (p90 3.7) |
| Registration read of the states and seed rows (`statesToSeed`, both) | 114.6 ms (p90 132.8) | same |
| Delivery read of the states (both) | 105.9 ms (p90 127.3) | same |
| Delivery read of the view (`views.list`; after: the sparse view, `checksBornAfter` and `viewThroughMark`'s JS) | 77.0 ms (p90 102.7) | 22.2 ms (p90 32.4) |
| `planDelta` JS on that view | 27.1 ms (p90 31.0) | 27.0 ms (p90 39.0) |

The view rows go from 32,000 to 32 per consumer.

## Spec 001 D6: the sentence (for the coordinator to land, with a dated `status.md` line)

Today: "On registration the view is seeded with the current known state of every check, so pre-existing and inherited failures are reported once in the registration header as known failures, not later as transitions."

Proposed: "On registration the view is seeded with the current known state of every check that is not passing, and the registration keeps the store's birth mark; a check with no view entry whose known state existed at the registration reads as the pass it was then (row 005-106; a store without birth marks seeds every check, as before), so pre-existing and inherited failures are reported once in the registration header as known failures, not later as transitions."

`status.md` line: "2026-11-17: 001 D6, the registration's seed: the view holds the states that are not passing plus what was told; a check with no entry that existed at the registration reads as the pass it was (row 005-106, 005 `research/consumer-view-design.md` design N). The agent is told the same; a session registered before the upgrade keeps its full view."

## For whoever continues

- A new reader of `consumer_views` that plans transitions must read through `markedView`. Otherwise it brings back the earlier-release misses on record above. Readers of told failures only (Stop, the late state, `reportsNewFailure`) can read the rows as they are.
- The code and lint stores (`code-deliver.ts`, `lint/surface/deliver.ts`) have their own seeds and are untouched (findings, open question 5).
