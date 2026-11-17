# 005-113 notes: the first delivery after the listing seeds the view as a registration does

Worker 12469e09, 2026-11-17. Since the coordinator's decision the same day, the general rule: every unrestricted delivery seeds its writes, not only one to a consumer owed the counts (section "The general rule"). Wave 24, W1 (`../wave-24.md`), on `06613770f` (0.1.548 source). Coordinator 4d2ecbfc. Inputs: 011 `research/unlisted-after-start.md` R1, `../../research/boundary-hook-cost.md` rank 2, `../005-106/notes.md`.

## The cause, confirmed in a test

A session that registers before the listing has an empty view (or one with few rows) and a birth mark older than every state the listing commits. Its first unrestricted delivery after the listing plans a delta in which every listed state has no view entry, and `planDelta` writes each one: `src/core/delivery/delta.ts:196` (`if (before === null || kind !== null) writes.push(...)`). `deliver` writes them all in its transaction: `src/core/delivery/delivery.ts:315` on `06613770f` (`store.views.writeMany(consumer, delta.writes)`). A boundary that has no news still commits these silent writes.

The red test (`test/delivery/listing-seed.test.ts`, the first case) on `06613770f`: 40 passes, one own pass and one inherited failure listed; the first boundary wrote 42 view rows. With the fix it writes 1 row (the inherited failure) and the store's high mark.

## What changed

| File | Change |
|---|---|
| `src/core/delivery/view-mark.ts` | `underMark`: the one seed rule (the rows not `pass` and the high mark while the store keeps marks; else every row and no mark). `registrationSeed` now calls it. New `markedWrites`: for an unrestricted plan, the writes of states with no stored entry go through `underMark`; when it leaves out a pass, the high mark is recorded (`recordViewMark`) and those passes are not written |
| `src/core/delivery/delivery.ts` | `deliver` reads the stored view once, passes it to `plan`, and writes `markedWrites(...)` in place of `delta.writes` (lines 313 to 320). `tellAtRegistration` is not touched |
| `src/core/delivery/counts-owed.ts` | `owesCounts(store, consumer)`; `payCounts` uses it (the seed no longer reads it) |
| `test/delivery/listing-seed.test.ts` (new) | the red test and the cases below |
| `test/delivery/listing-equivalence.test.ts` (new) | the equivalence on two real stores |
| `measure.ts` (this folder) | the timing probe |

No type change in `src/core/types`. `view-seed.ts`, `state-born.ts` and `delta.ts` are not changed.

## Decisions the brief did not settle

1. **The seed is applied to the plan's writes, not before the plan.** The brief says "seeds the view as `registerNow` does at that moment ... then plans the delta from that view". Taken literally, seeding the failures at the listing into the view first would make the plan read them as told, and the delivery would not tell them, against "failures that exist at the listing are told as today". So the plan is made as before, from the view as stored, and only its writes change: a pass with no stored entry (never told) is not written, and the mark moves to the store's high mark. The stored result is what a registration at that moment stores (the rows not `pass`, the high mark), plus what this delivery told. What is told is the same by construction: the entries come from the unchanged plan.
2. **Why this is exact.** After the delivery, a state with no entry is one of: (a) born at or before the old mark, read as the told pass it was, as before; (b) born after the old mark and before the new one, never told, so the plan wrote it; only the passes among them were left out, and they now read as told passes, which is what the full write stored. A pass write over an existing entry (a recovery) is kept. The view rows' `told_at` is not read by `planDelta`; a pass read through the new mark reads `toldAt` as this delivery's time.
3. **Only unrestricted plans.** A peek (`keep`) and the waiter (`waitedFor`) restrict the plan; a restricted plan writes no silent pass, so there is nothing to seed, and moving the mark there would make passes the reference leaves untold read as told. They keep their writes.
4. **One owner.** The rule "the rows not `pass` and the high mark" lives in `underMark` and serves both the registration and this delivery. `seedView` and `statesToSeed` are not called here: the delivery already holds its states and its few non-pass writes go through `views.writeMany`, as every delivery's writes do.
5. **The mark is written only when a pass was left out.** A delivery with no never-told pass writes no slot.
6. **Atomic.** `markedWrites`, its mark and the view writes run inside the delivery's `store.transaction`. Test "commits the writes and the mark with the delivery, or neither": a delivery that throws after the mark was recorded leaves the registration's mark and no row; the next boundary seeds and tells as before.
7. **Two assertions changed under the general rule.** `delivery.test.ts` "writes a pass never told to anyone into the view silently" (now "tells a pass never told to anyone silently") and `view-mark.test.ts` "reads a check born after it as never told" asserted the stored row of a never-told pass. Under the general rule that pass has no row; the consumer keeps a new mark. The assertions now read no row for it; what is told is unchanged, and the view-mark case adds that the pass leaves the waiter's untold and that its later failure is `pass-to-fail`.

## Tests

`test/delivery/listing-seed.test.ts`, a store with birth marks (`freshStore`) unless named:

| Case | What it pins |
|---|---|
| writes the rows that are not pass and the store's high mark | the red test: 1 row in place of 42; the mark equals `currentBirthMark` |
| a failure born at the listing | told once as `first-seen-fail`, with the owed counts; kept as a row; a later regression of a listed pass is `pass-to-fail` |
| an inherited failure | told as `first-seen-fail` with origin `inherited`, never as `pass-to-fail`; not told again |
| a pass born at the listing | no row, no news; its later failure is `pass-to-fail` |
| a store with no birth marks (`releasedStore`) | the full write: 42 rows, no mark |
| two sessions, one registered after the listing | each session's mark moves only at its own delivery that leaves a pass out; a pass born after the counts were paid is left out too, and its later failure is `pass-to-fail` for both |
| no pass left out | a delivery with nothing to leave out keeps the registration's mark (no slot write) |
| the gap: a peek carries the owed counts first | the boundary after it writes 2 rows in place of 42, and the peek, that boundary and the next say the same text as on a store without birth marks |
| killed delivery | the mark and the writes commit together or not at all |

`test/delivery/listing-equivalence.test.ts`: the generator of `view-equivalence.test.ts` (the same LCG, seed 11, 24 steps, 3 checks, 2 consumers) on the real `createDelivery` and two real stores. Steps: own and inherited results (pass, fail with two messages, skip), unknown rewrites, retirements, registrations (before the listing they owe the counts), the listing, boundaries, peeks, Stops. The reference is a store without birth marks: full copy at every registration and the full write at every delivery. Every unrestricted delivery seeds under the general rule, so the test checks every delivery. 300 runs: 2,608 deliveries, 259 with text, 153 that seeded their writes (101 under the owed-only rule), 975 after which the seeded store held fewer view rows; **0 differences** in any registration or delivery text, later deliveries included. The 005-106 model test (`view-equivalence.test.ts`) is unchanged and still passes.

## Timings at 50,000 states

`measure.ts`, `node_modules/.bin/tsx measure.ts <src-root> 50000 3`, twice for each side, interleaved: before is a `git archive` of `06613770f`, after is this branch. A file-backed store under `$TMPDIR` with birth marks; 50,000 inherited states in 1,112 files, 32 of them inherited failures; one own check flips before each boundary, so each has news. In-process, no daemon. Node 26.13.0. The host's own load, no artificial load: 1-minute average 13.5 to 19.4 on 24 vCPUs (parallel coordinators' work). Times in ms, 6 rounds each, median and range.

| Step | Before | After |
|---|---|---|
| First boundary after the listing (owed, with news) | 944 (754 to 1,107) | 598 (470 to 917) |
| View rows of that consumer after it | 50,001 | 34 |
| Second boundary (news) | 648 (518 to 858) | 507 (379 to 618) |
| Registration after the listing | 344 (293 to 412) | 335 (262 to 361) |
| First boundary of that registration | 375 (339 to 418) | 399 (313 to 486) |

The owed first delivery now costs less than a registration plus an ordinary delivery (R1's done-when), and the later deliveries of that session are cheaper too, since its view stays at the non-pass rows. What remains in the first delivery: the read of the 50,000 states and `checksBornAfter`, which returns every listed state once (all are born after the registration's mark). A served delivery's write to the daemon is now 34 rows in place of 50,001; the served timing (`boundary-durations` on a store copy, 005-110's method) is not measured here.

## Mixed versions

- **A hook of 0.1.545 to 0.1.548** (005-106, no 005-113) delivering to a consumer this delivery seeded reads the slot's mark through `markedView`, so it reads the same view and tells the same. If such a hook makes the first delivery after the listing, it writes the full set as before; a later delivery of this release finds no never-told pass and changes nothing.
- **A hook before 0.1.545** reads the rows as they are: a pass born before the new mark with no row reads as never told. It misses what 005-106's notes put on record for its registrations: a PASS -> UNKNOWN goes untold, and a PASS -> FAIL through a skip is worded first observed from the skip. Failures are rows, so none is repeated or lost. It then writes those passes silently, as before.
- **A daemon that keeps no marks** (an older one serving the store): `currentBirthMark` is `null`, so `markedWrites` keeps every write (the "no birth marks" case).

## The general rule (the coordinator's decision, 2026-11-17)

The first version seeded only while the consumer was owed the counts. A restricted delivery that carried the counts first (the PreToolUse peek, which tells only `pass-to-fail`, or the idle waiter) left the next boundary unseeded, at full cost. Decision point 2 does not need the consumer to be owed, so `markedWrites` now seeds at every unrestricted delivery (tool boundary, Stop, prompt). The peek and the waiter keep their writes; a store without birth marks keeps every write.

**How often an ordinary delivery now writes the slot.** Only when it finds a passing check it was never told: a check born after the consumer's mark that passes at the consumer's first delivery after its birth. That is a new test (a new test file, or a new test in a file), or a retired check that comes back passing. A check first seen as `fail`, `skip` or `unknown` gets a row, and its later pass is written over that row, so it writes no slot. At most one slot write per such delivery and consumer; a delivery with none writes nothing.

**What that write costs at 50,000 states.** `measure.ts`, step C: a new test file of 45 passing tests and one own flip, then the boundary. 6 rounds each, 725d524ef (owed-only) against this change, interleaved. The host's own load, no artificial load: 1-minute average 28.5 to 37.6 on 24 vCPUs, so the times spread.

| Step C | Owed-only (725d524ef) | General rule |
|---|---|---|
| Boundary after the new file | 471 ms (332 to 628) | 349 ms (334 to 506) |
| View rows it wrote | 45 | 0 |
| Mark slot written | no | yes |
| One write of the mark slot alone (median of 10, own commit) | 0.06 to 0.09 ms | same |

The slot is one `meta` row per worktree holding every registered consumer's mark (`writeSlot`); its write does not grow with the states. It replaces one view row per new passing test. The first boundary after the listing and the second boundary keep the numbers of the table above (same code path; this run: first 506 to 879 ms, 34 rows).

## Validity bundle

`test/keys/key-format.test.ts` passes at revision 9. No file in the validity path's entries changed (delivery is outside them), so the bundle does not change.

## Spec 001 D6: a sentence for the coordinator

Today: "A pass never told to anyone is written into the view silently."

Proposed: "A pass never told to anyone is told silently: on a store with birth marks the delivery keeps the store's high birth mark for the consumer in place of a view entry, as a registration does, so the check reads as the pass it was (row 005-113; a store without birth marks writes the entry, as before; a peek and the waiter's delivery write only what they tell)."

`status.md` line: "2026-11-17: 001 D6, a pass never told: a delivery keeps the store's birth mark for the consumer in place of a view row per never-told pass, as a registration does (row 005-113); the first delivery after the listing writes the rows not passing, not one per listed state. What the agent is told is unchanged."

## For whoever continues

- The idle waiter's path has no case of its own in `listing-seed.test.ts`: it keeps its writes as the peek does (same `restricted` flag), and the peek case covers the gap.
- `markedWrites` reads the stored view once; `deliver` passes the same read to `plan`, so the view is read once per delivery as before.
- What remains in the first delivery after the listing is the read of every state and `checksBornAfter`, which returns each listed state once (all are born after the registration's mark); row 005-110's served timings are the next measure.
