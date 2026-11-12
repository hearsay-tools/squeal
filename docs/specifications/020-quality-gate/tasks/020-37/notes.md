# Row 020-37: the busy note names the lock holder under load

Commit `99db7f81a`. Evidence of the miss: `tasks/020-29-30/notes.md`, "020-30".

## Change

- `refusedLockHolders(databasePath)` in `src/core/store/lock-holders.ts`:
  `lockHolders` for a write the store has just refused. When a read of
  `/proc/locks` names no holder (nobody, or only waiters), it reads again
  25 ms later, 4 reads at most (75 ms of pauses). A source that cannot be
  read (`undefined`) is read once. Not Linux: `undefined` with no read.
- `refusedHoldersFrom(source, databasePath, pause?)` is the same over a
  `HolderSource`, for tests.
- `holderOf` in `src/core/code/gate/keep-write.ts` calls it. It serves the
  first busy note (`StoreWait.giveUp`) and the note when the bound runs out
  (`StoreWait.spent`).

## Decisions

- The retry lives in `lock-holders.ts`, as the brief allowed, so other
  busy messages can use it.
- The pause is synchronous (`Atomics.wait`, as `src/cli/store-writes.ts`
  and `src/core/status/open.ts` do). `holderOf`, `giveUp` and `spent` are
  synchronous, and their callers are in `keep.ts`, which this row does not
  own. The pause runs only when a read names no holder, outside any
  transaction. The worst case is 75 ms twice per flush.
- More reads matter more than longer pauses. One `read()` of `/proc/locks`
  returns one page (seq_file). An entry is skipped when the list changes
  between two pages, so each read is a new chance. The pause only spreads
  the reads over bursts of lock changes.

## Repeat runs

`node node_modules/vitest/vitest.mjs run test/code/gate/keep-busy.test.ts`,
one at a time, after commit `99db7f81a`, on a host with 24 vCPUs:

| Node | Runs | Result | One-minute load at start | `/proc/locks` lines |
|---|---|---|---|---|
| 24.22.1 | 20 | 20 pass | 12.3 to 15.0 | 94 to 124 |
| 26.13.0 | 20 | 20 pass | 13.3 to 18.2 | 98 to 117 |

The host's real load was about a quarter of the failing run's load (72,
with 241 to 369 lines in `/proc/locks`). These runs show that nothing
regressed. They do not show the miss being recovered, because no load was
added (no artificial load). The unit test
`test/store/lock-holders-refused.test.ts` covers the miss: the first read
names no holder and a later read names it.

## For the next worker

- `busyText` in `src/cli/store-writes.ts` (spec 021 D1, D5) also reads the
  holder once after a refused write. It can use `refusedLockHolders` in the
  same way. Spec 021 owns that file.
- `src/core/store/lock-holders.ts` is bundled, so the committed bundles
  drift until the next build (`cli/ps.mjs` and others). This row did not
  rebuild them.
