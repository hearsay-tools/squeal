# 011-38: formats 13 on are read as one, worker notes (2026-10-20)

The design's R1 (`../011-37/design.md` sections 4 and 6). Commits `f572dfd0` (a test fake outside the row's ownership) and `8718aa04` (the row).

## Seam map

- `src/core/keys/key-format.ts`: `KEY_FORMATS_READ_AS_ONE`, format to the row that raised it, 13 to 17. `KEY_FORMAT_VERSION` 18 under today's guard, hash pinned. The coordinator settles the number at integration: if 013-02 takes 18, this row is 19 and the list gains 18 with 013-02's row.
- `src/core/keys/environment.ts`: `environmentHash(core, runner, hashOf, format = KEY_FORMAT_VERSION)`.
- `src/core/scheduler/keying.ts` `setEnvironments`: one hash per listed format per project, passed to `KeyIndex.setInstalled` as a third argument. `#provisional` goes through `KeyIndex.setEnvironment`, whose new third argument defaults to none, so a provisional environment reads no old format.
- `src/core/keys/key-index.ts`: `ids` maps each current key to its test file; `keysReadAsOne(key)` answers `{ testFile, keys }`, memoized on the `Keyed` entry per key and environment array. `null` for a key no file holds now.
- `src/core/store/repos/results.ts` `copyNewest(key, from)`: one `SELECT ... GROUP BY key ORDER BY MAX(recorded_at) DESC` (a read), then one `INSERT ... SELECT ... WHERE NOT EXISTS` (the write). A miss writes nothing. Type in `src/core/types/store.ts` (additive).
- `src/core/scheduler/ledger.ts`: `probe` calls `#copyReadAsOne` on a miss, once per file and key (`#readAsOne`, by `testFileId`, dropped by `removeFile`). The memo is set only after the copy returns, so a busy store's error leaves the read to the next lookup. `rereadFormats(refs)` drops the memo.
- `src/core/scheduler/stored-keys.ts`: `withoutResult` also matches a file whose key at a listed format is fresh; `adopt` calls `ledger.rereadFormats(refs)` before `settle`.

## Facts found on the way

- `probe` has five callers: `settle` (through `lookup`), `tiers.ts` selection (line ~207) and `startable` (inside `startTier`'s transaction), `claims.ts` `claimOf`, `slow-tier.ts`. Only `startable` runs inside a transaction. Selection probes first, so the memo normally keeps `startable` from reading again. A copy there would join that transaction.
- Three tests build a cast fake key index `{ key }` for a `Ledger`: `test/delivery/edits-confirmation.test.ts`, `test/scheduler/rekeyed-record.test.ts`, `test/scheduler/retry-claims.test.ts`. Each now has `keysReadAsOne: () => null`. Any new `Ledger` method that reads the index needs the same.
- The guard's `SEAMS` list forbids a new import from a guarded file into `key-format.ts`. `keying.ts` reads the list through the `keys/index.ts` barrel, an existing seam. `key-index.ts` never imports it: it gets hashes, not formats.
- The regression test computes old keys itself (`keyAt`: `coreEnvironmentInputs`, `environmentHash` at a format, `keyFromSegments`) and checks the computation against the daemon's key at the current format. It uses `KEY_FORMAT_VERSION - 1` and `- 2`, so a renumbering at integration does not break it.

## Left for later rows

- R3 moves `#copyReadAsOne` with the accept rule into `scheduler/accept.ts` (`acceptedAt(..., listed)` in the design).
- R4: a raise after the guard's replacement empties the list; its test belongs to `key-format.test.ts`.
- Cost on a real store is still unmeasured (design, "What is not known").
