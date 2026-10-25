# 015-44 notes: a new record at a judged key re-judges its sources

Worker 40cd05f1, 2026-10-25. Brief: `tasks/wave-5.md` W1, after 015-45. The index's arrival is the coordinator's decision (reply to request `f4adcb18`, option b, with three conditions): an additive index made at open, with no `user_version` raise.

## The gap

`signatureOf` hashed the blob, the counter version, `crap.threshold` and the loaders' keys. A later run at a key stores its record over the first (`put` upserts), so the keys stay and the file kept the judgement from the first record. Since 015-12.

## What changed

- **Each record's own stored time** (`store/coverage.ts`). `put` sets `recorded_at` to `max(at, the stored row's recorded_at + 1)`, so each record stored at a key has its own value, also within one ms. Record bytes, `COVERAGE_PROVIDER_VERSION` and result keys are unchanged.
- **A read without the blob** (`store/schema.ts` `CODE_INDEXES`, `store/open.ts`, `store/coverage.ts`). `coverage_stored ON coverage (result_key, provider_version, recorded_at)`. An opener that may create the file (the daemon) looks for the index in `sqlite_master`; when it is absent it takes `BEGIN IMMEDIATE`, looks again, and makes it. A store that has it opens with no write lock. A reader (`create: false`: status, `squeal code`, hooks) never makes it. `CodeCoverageRepo.storedAt` and `has` read through the index with `INDEXED BY` when the connection saw it at open, and through the table's key when not.
- **The signature** (`crap/cache.ts`, `crap/loaders.ts`, `crap/file.ts`). A ready condition carries `storedAt`; `signatureOf` hashes each ready loader's key with it. A settled ready condition is looked up again at each read of the map: a new stored time gives a new condition; a record that went drops it.

After the upgrade every judged file with loaders is judged once more, with the same records, so with no transition (`replaced.test.ts`). A file no test file loads keeps its signature.

## Measurements (011-197's code store, copied; 4,932 records, 25 KiB mean; load 0.8 to 9)

| Read, 1,072 keys | Time |
| --- | --- |
| `has` through the table's key, warm | 105 to 160 ms |
| `recorded_at` through the table's key | 104 to 379 ms (it sits after the blob, in overflow pages) |
| `recorded_at` through `coverage_stored` (`INDEXED BY`) | 4.7 to 5.9 ms, cold or warm |

- Without `INDEXED BY`, SQLite's planner takes the primary key even with the index there.
- Making the index at the first open: 565 to 616 ms, once, on the main thread of the first daemon at this version. A second open: 0 ms.
- The cold loader map after a revision (015-45's bench): 3 reading steps of 50 to 52 ms (8 to 10 before this row), since `storedAt` replaces the slow `has`.

## Tests

- `test/code/crap/replaced.test.ts`: judged from record v1, v2 stored at the same key with other hits at the same clock, and the file is judged again from v2, with its transitions; the same through a chain's `StepCache` after `invalidate`; a summary signed as 0.1.305 signed it is judged once more with no transition.
- `test/code/store-index.test.ts`: a version-1 store without the index (as an older daemon leaves it) opens, gains it, and keeps `user_version` 1; a second open takes no write lock (another connection holds `BEGIN IMMEDIATE`, busy timeout 0, file bytes unchanged); a reader on a store without the index does not make it and gives the same `storedAt`, `has` and `get`; each record stored at a key gets its own time within one ms; while another process makes the index under the lock, the open makes it once (without the second look it fails with "index coverage_stored already exists", checked by removing that look).
- `test/code/child/holder.ts` gains an `index` mode for that test.

## Proposed D4 amendment (the coordinator folds it in)

> **Indexes after version 1** (amended 2026-10-25, row 015-44). An index that only adds a read path arrives at open, not as a migration: an opener that may create the file looks for it in `sqlite_master`, and when it is absent takes the write lock, looks again, and makes it. `user_version` stays, so a daemon that predates the index keeps the store, and SQLite keeps the index current on its writes. A store that has the index opens with no write lock. A reader never makes it and reads the same answers without it, more slowly. The first is `coverage_stored (result_key, provider_version, recorded_at)`, which gives a record's stored time without its blob.

And for D9, the signature: "A judgement's signature holds each loader's key and when its record was stored, so a record a later run stores at the same key judges the file again (row 015-44)." Open question 5's "low impact while records at one content agree" is then closed for same-key records.

## Decisions the brief did not settle

1. **`recorded_at` names the record**, not a digest. A digest would need a new column, a table rebuild or a read of each blob; the stored time, made unique per key by `put`, needs neither. A daemon at 0.1.305 or older writing the same store sets `recorded_at` to its own clock: two of its records at one key within the same ms would read as one. Not seen; it needs two runs of one test file to end in the same ms.
2. **The decoded records' check stays the bytes' sha1** (`StepCache.record`, review 0.1.305 B1). The stored time could replace it and skip the blob read after each `invalidate`, but the older daemons' same-ms case above would then judge from a stale decode. Kept exact.
3. **A connection decides at open whether it reads through the index.** A reader opened before a daemon made the index reads through the key until it opens again.
4. **`has` stays** (tests and `writer-stored.test.ts` read it); it is `storedAt(key) !== null`.

## Type changes (additive)

- `CodeCoverageRepo.storedAt(key): EpochMs | null`.
- `LoaderCondition` ready: `storedAt: EpochMs`; `ReadyLoader.storedAt: EpochMs`; `LoaderInputs.coverage` is `Pick<CodeCoverageRepo, "storedAt">` (was `"has"`).
- `signatureOf` and `StepCache.signature` take loaders with `storedAt`.
- `CODE_INDEXES` (new, `store/schema.ts`).

## Residue

- This row's one judgement again after the upgrade showed that the first judging step after a start read its files' prior states and edits by scanning every state of the worktree: a 110 to 132 ms step on 011-197's store. Those reads go by path in 015-45's commit (`tasks/015-45/notes.md`).
- Bundles not built (the brief).
