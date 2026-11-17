# 005-113 notes: the first delivery after the listing seeds the view as a registration does

Worker 12469e09, 2026-11-17. Wave 24, W1 (`../wave-24.md`), on `06613770f` (0.1.548 source). Coordinator 4d2ecbfc. Inputs: 011 `research/unlisted-after-start.md` R1, `../../research/boundary-hook-cost.md` rank 2, `../005-106/notes.md`.

## The cause, confirmed in a test

A session that registers before the listing has an empty view (or one with few rows) and a birth mark older than every state the listing commits. Its first unrestricted delivery after the listing plans a delta in which every listed state has no view entry, and `planDelta` writes each one: `src/core/delivery/delta.ts:196` (`if (before === null || kind !== null) writes.push(...)`). `deliver` writes them all in its transaction: `src/core/delivery/delivery.ts:315` on `06613770f` (`store.views.writeMany(consumer, delta.writes)`). A boundary that has no news still commits these silent writes.

The red test (`test/delivery/listing-seed.test.ts`, the first case) on `06613770f`: 40 passes, one own pass and one inherited failure listed; the first boundary wrote 42 view rows. With the fix it writes 1 row (the inherited failure) and the store's high mark.

## What changed

| File | Change |
|---|---|
| `src/core/delivery/view-mark.ts` | `underMark`: the one seed rule (the rows not `pass` and the high mark while the store keeps marks; else every row and no mark). `registrationSeed` now calls it. New `listingWrites`: for a consumer owed the counts and an unrestricted plan, the writes of states with no stored entry go through `underMark`; when it leaves out a pass, the high mark is recorded (`recordViewMark`) and those passes are not written |
| `src/core/delivery/delivery.ts` | `deliver` reads the stored view once, passes it to `plan`, and writes `listingWrites(...)` in place of `delta.writes` (lines 313 to 320). `tellAtRegistration` is not touched |
| `src/core/delivery/counts-owed.ts` | `owesCounts(store, consumer)`; `payCounts` uses it |
| `test/delivery/listing-seed.test.ts` (new) | the red test and the cases below |
| `test/delivery/listing-equivalence.test.ts` (new) | the equivalence on two real stores |
| `measure.ts` (this folder) | the timing probe |

No type change in `src/core/types`. `view-seed.ts`, `state-born.ts` and `delta.ts` are not changed.

## Decisions the brief did not settle

1. **The seed is applied to the plan's writes, not before the plan.** The brief says "seeds the view as `registerNow` does at that moment ... then plans the delta from that view". Taken literally, seeding the failures at the listing into the view first would make the plan read them as told, and the delivery would not tell them, against "failures that exist at the listing are told as today". So the plan is made as before, from the view as stored, and only its writes change: a pass with no stored entry (never told) is not written, and the mark moves to the store's high mark. The stored result is what a registration at that moment stores (the rows not `pass`, the high mark), plus what this delivery told. What is told is the same by construction: the entries come from the unchanged plan.
2. **Why this is exact.** After the delivery, a state with no entry is one of: (a) born at or before the old mark, read as the told pass it was, as before; (b) born after the old mark and before the new one, never told, so the plan wrote it; only the passes among them were left out, and they now read as told passes, which is what the full write stored. A pass write over an existing entry (a recovery) is kept. The view rows' `told_at` is not read by `planDelta`; a pass read through the new mark reads `toldAt` as this delivery's time.
3. **Only unrestricted plans.** A peek (`keep`) and the waiter (`waitedFor`) restrict the plan; a restricted plan writes no silent pass, so there is nothing to seed, and moving the mark there would make passes the reference leaves untold read as told. They keep their writes.
4. **One owner.** The rule "the rows not `pass` and the high mark" lives in `underMark` and serves both the registration and this delivery. `seedView` and `statesToSeed` are not called here: the delivery already holds its states and its few non-pass writes go through `views.writeMany`, as every delivery's writes do.
5. **The mark is written only when a pass was left out.** A delivery to an owed consumer before the listing, or one with no never-told pass, writes no slot.
6. **Atomic.** `listingWrites`, its mark and the view writes run inside the delivery's `store.transaction`. Test "commits the writes and the mark with the delivery, or neither": a delivery that throws after the mark was recorded leaves the registration's mark and no row; the next boundary seeds and tells as before.

## Tests

`test/delivery/listing-seed.test.ts`, a store with birth marks (`freshStore`) unless named:

| Case | What it pins |
|---|---|
| writes the rows that are not pass and the store's high mark | the red test: 1 row in place of 42; the mark equals `currentBirthMark` |
| a failure born at the listing | told once as `first-seen-fail`, with the owed counts; kept as a row; a later regression of a listed pass is `pass-to-fail` |
| an inherited failure | told as `first-seen-fail` with origin `inherited`, never as `pass-to-fail`; not told again |
| a pass born at the listing | no row, no news; its later failure is `pass-to-fail` |
| a store with no birth marks (`releasedStore`) | the full write: 42 rows, no mark |
| two sessions, one registered after the listing | only the owed one is seeded; the other's mark and text are its registration's; once paid, a pass born later is written as before |
| killed delivery | the mark and the writes commit together or not at all |

`test/delivery/listing-equivalence.test.ts`: the generator of `view-equivalence.test.ts` (the same LCG, seed 11, 24 steps, 3 checks, 2 consumers) on the real `createDelivery` and two real stores. Steps: own and inherited results (pass, fail with two messages, skip), unknown rewrites, retirements, registrations (before the listing they owe the counts), the listing, boundaries, peeks, Stops. The reference is a store without birth marks: full copy at every registration and the full write at every delivery. 300 runs: 2,608 deliveries, 259 with text, 101 that seeded their writes, 915 after which the seeded store held fewer view rows; **0 differences** in any registration or delivery text, later deliveries included. The 005-106 model test (`view-equivalence.test.ts`) is unchanged and still passes.

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
- **A daemon that keeps no marks** (an older one serving the store): `currentBirthMark` is `null`, so `listingWrites` keeps every write (the "no birth marks" case).

## Validity bundle

`test/keys/key-format.test.ts` passes at revision 9. No file in the validity path's entries changed (delivery is outside them), so the bundle does not change.

## Spec 001 D6: a sentence for the coordinator

Today: "A pass never told to anyone is written into the view silently."

Proposed: "A pass never told to anyone is written into the view silently; at a delivery to a consumer that registered before the test files were listed, such passes are not written and the consumer keeps the store's birth mark instead, as a registration at that moment would (row 005-113), so it is told the same with a view that holds only what is not passing."

`status.md` line: "2026-11-17: 001 D6, the first delivery after the listing: a consumer registered before the listing keeps the store's birth mark at that delivery in place of a row per never-told pass (row 005-113); what it is told is unchanged."

## For whoever continues

- **A gap the scope leaves.** The seed runs only while the consumer is owed the counts. A restricted delivery that pays the counts first leaves the next boundary unseeded, and it writes every never-told pass at full cost. Two paths can do that: the PreToolUse peek, which tells only `pass-to-fail`, so only when a listed state is a regression by this worktree's audit log; and the idle waiter, which delivers only to an idle session. Not measured in the field. A consumer that was never owed (it registered while the header read listed, then a large set of states landed) has the same full write.
- **The general rule closes both.** Proof point 2 above does not need the consumer to be owed: any unrestricted delivery can leave out its never-told passes and move the mark. Removing the `owesCounts` test in `listingWrites` does it; `listing-equivalence.test.ts` would then check every delivery. The cost is one slot write at each delivery that sees a new pass (a new test file, a retired check back). I kept the brief's scope; the coordinator decides.
- `listingWrites` reads `owesCounts` before `payCounts` clears it in the same transaction, so the paying delivery is the one that seeds.
