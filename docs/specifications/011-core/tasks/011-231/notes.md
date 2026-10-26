# 011-231: notes (wave 45 W3, 2026-10-26)

Written by the coordinator from worker dc0607a2's final report; the brief asked for no notes file. Case 2 of `test/daemon/hold.test.ts` ("2: with its wrapper killed") once read no hold-end note on main CI, after it saw the hold's row gone. The product was wrong, not the test. Request ff58d3a0 to the coordinator agreed on the fix and its ownership.

## Cause

`CommandHold.check()` (`src/core/scheduler/command-hold.ts`) saved the removal of an ended hold (`pruneCommandHolds`) and its end note (`endedNote`, through `#note`) as two store writes. A read that fell between them saw the hold gone and no note: what case 2 read.

## Fix

`9895ac1ee` (worker; `212b692cc` on cand/0.1.332): `check()` runs `pruneCommandHolds` and the note loop in one `store.transaction`. The coordinator's three conditions, as the worker checked them:

1. Same connection. `CommandHold` writes through the scheduler's own `options.store`, so the note is a savepoint inside the removal's transaction. Case 3 of the new test spies on that store's `meta.set` and sees the note written while a second connection still sees the entry.
2. Only store writes inside. The body is `pruneCommandHolds` and `#note`; `#note` is `appendNote` with `onError` only in its catch. A busy store fails when the transaction starts, before the body runs. A note write that fails for another reason rolls back the note alone, and the removal is saved, as before the fix.
3. Busy keeps the hold. Case 2 of the new test: a busy store keeps the entry and writes no note, and the next check removes the entry with its note. This case also passes without the fix; it fixes the expected behaviour, not the proof.

## Evidence

Test: `c315e8806` (worker; `d848faad2` on the candidate), `test/scheduler/command-hold-note.test.ts`. Before the fix (Squeal, revision 1), a second store connection saw 0 entries and no note at the moment the note was written: `expected [ { entries: +0, notes: [] }, …] to deeply equal [ { entries: 2, notes: [] }, …]`. Cases 1 and 3 fail without the fix and pass with it.

`hold.test.ts` case 2 alone, 20 runs in a row: 20 of 20 passed, 13 to 16 s each, at a 1-minute load of 23.4 to 34.8 on 24 CPUs, the host's own load. The miss was rare on main, so these runs show stability, not the fix; the unit test is the proof. `hold.test.ts` is unchanged: with the fix, its read right after the removal is exact.

## Formats

No stored key, result or note format changes. Only a doc comment was added to the `note` option.
