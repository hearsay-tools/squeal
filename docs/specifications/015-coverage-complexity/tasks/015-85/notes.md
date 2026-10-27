# 015-85 notes: shared coverage record parts, the storage contract

Worker e50e8775, 2026-10-27, from `tasks/wave-19.md` W3. Shape: survey. No product edits. Baseline `776712148` (package 0.1.359).

## Answer

Store each source's part once, in one new table `coverage_parts`, made at open with no `user_version` raise. A record stays one row at its key in `coverage`. Its bytes become a short manifest: the part ids, and a path list that makes an older daemon read the record as "cannot confirm these sources". On the newest 2,400 records, 73.5 MiB becomes about 10 MiB. This needs one explicit amendment to D4: a table made at open, as 015-44 made an index. Three options for the parent are at the end; option A is my default.

## Evidence (measured 2026-10-27, read-only, this repository's `code.sqlite`)

Method: a `node:sqlite` read-only connection at `nice 19`, load 35 to 47 on 24 CPUs. The keys come from the `coverage_stored` index, newest first, then each record by its key. Each source entry is re-encoded as a part (below) and hashed. Ids are given in order of first appearance, oldest record first. Scripts were in this worker's scratch directory (`t/e50e8775/probe/`), not committed (outside this row's files).

| Measure | Newest 600 (00:45, 8 min) | Newest 2,400, run 1 (00:46, 39 min) | Newest 2,400, run 2 (00:51) |
| --- | --- | --- | --- |
| Records stored as today | 17.4 MiB, 29.7 KiB each | 67.3 MiB, 28.7 KiB each | 73.5 MiB, 31.4 KiB each |
| Sources per record, mean (median) | 290 (335) | 275 (322) | not read |
| Source parts in the records | 173,877 | 660,547 | not read |
| Distinct parts (same path, blob and hits) | 7,789 (4.5%) | 13,068 (2.0%) | 12,453 |
| Distinct parts, each deflated alone | 1.9 MiB | 3.5 MiB | 3.4 MiB, 283 B each |
| `(path, blob)` pairs with more than one distinct part | 770 of 1,470 | 893 of 2,305 | not read |
| Manifest, option A (ids and path list) | not measured | not measured | 2,046 B each |
| Manifest, option B (ids only) | not measured | not measured | 201 B each |

- Run 2 is the second probe, five minutes after run 1. New records had been stored in between, so its window is not the same.
- From run 2: option A stores 3.4 MiB of parts, about 2.2 MiB of part rows and 4.7 MiB of manifests, about 10.2 MiB in all, 86% less. Option B stores about 6.0 MiB, 92% less.
- The `(path, blob)` row is why a blob alone never names a part: about half the sources ran differently in different test files.
- The store held 96,457 records: 65,917 stored in the last 24 hours, 30,556 the day before, 442 older. So about 66,000 records a day are stored here now, about 2 GB a day (lessons Round 2 measured 1.5 GB).
- Projection, inferred and not observed: at 7 days, today's form holds about 13 GB. Option A holds about 1.0 to 2.0 GB, option B about 0.1 to 1.2 GB. The lower ends assume nearly every part already existed. The upper ends assume each 40-minute window's distinct parts were all new. A part row adds about 180 B (hash, id, time and two index entries), estimated and not measured.

## What the code does today (seam map)

- **Record.** One `coverage` row per `(result_key, provider_version)`. The bytes are `deflateRaw(JSON(CoverageRecord))` (`encodeRecord`, `src/core/code/coverage/record.ts`). `recorded_at` is the stored-time identity: `max(at, previous + 1)` (015-44).
- **Writers.** `writer.ts` `keep` calls `coverage.put`. The map worker (`map-worker.ts`) or the main-thread mapper (`mapper.ts`) gives the encoded bytes.
- **Readers.** Only the daemon reads records. `crap/cache.ts` `record` decodes a record once for each digest of its bytes. `crap/loaders.ts` reads `storedAt` for readiness. Only `coverageOf` (`crap/file.ts:138`) reads a record's contents. A path in `unread` gives `"unread"` (state `unknown`), or the record is left out of an early judgement. A path in neither `sources` nor `unread` means "this test file ran none of it". Hooks, `status` and `squeal code` read states, never records.
- **Prune.** `pruneCodeStoreAfter` runs 60 s after a daemon starts and every hour after that, in each daemon. It deletes records whose result key the main store no longer holds, 256 at a time.
- **Result lifetime.** The main store keeps a result at any key that is current in a live worktree, at any age. It also keeps the newest result per check of the main worktree. Other keys go after 7 days. So a record can live much longer than 7 days. Part pruning must allow for that.
- **Older daemon on a newer code `user_version`.** The code pass logs `the code store did not open` once and runs without complexity and coverage (`code/pass/index.ts`). Tests are not affected. Hooks show no code part.
- **011 C7, as amended 2026-10-25 (016-15).** No column is added to an existing table under an unchanged `user_version`. A new field goes in a new table, in a `meta` row, or with a raise. D4 (015-44) allows indexes made at open. The brief asks for an explicit amendment before a new table.

## The contract (option A)

### Persisted identity

- **Record.** As today: `(result_key, provider_version = COVERAGE_PROVIDER_VERSION)`. One row per key. `recorded_at` is still its stored-time identity. The keys do not change, and nothing is re-keyed.
- **Part.** Its content identity is `hash`: the lowercase hex SHA-256 of the part text. The part text holds the provider version, path, blob, line bitsets and function hits. So a part is shared only when all of these are equal. Equal blobs with different hits are two parts. Equal bytes at two paths are two parts. Parts are never shared across provider versions.
- **Part handle.** `id INTEGER PRIMARY KEY AUTOINCREMENT`. Manifests list ids. An id is never used again after its row is deleted, so a stale id can never name another part.

### Schema made at open (`user_version` stays 1)

```sql
CREATE TABLE coverage_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hash TEXT NOT NULL UNIQUE,
  part BLOB NOT NULL,
  used_at INTEGER NOT NULL
) STRICT;
CREATE INDEX coverage_parts_used ON coverage_parts (used_at);
CREATE INDEX coverage_recorded ON coverage (recorded_at);
```

These are made as `CODE_INDEXES` are (`open.ts` `makeIndexes`). An opener that may create the file looks in `sqlite_master`. When an object is absent, it takes `BEGIN IMMEDIATE`, looks again, and makes every absent object in that one transaction. A reader (`create: false`) never makes them. No existing table gets a column. `coverage_recorded` is an index on an existing table, which D4 allows already. `AUTOINCREMENT` also makes `sqlite_sequence`.

### Encoding

- **Part text.** `JSON.stringify([COVERAGE_PROVIDER_VERSION, path, blob, lines, covered, functions])`. The fields are those of `CoverageSource`, and `functions` is in its sorted order (`sourceEntry`). `hash` is computed over the UTF-8 bytes of that text, not over deflated bytes. `part = deflateRaw(text)`.
- **Manifest** (the `record` column): `deflateRaw(JSON.stringify({ v: 1, sources: [], unread: U, parts: D }))`.
  - `U` is every path of the record's parts plus its own unread paths, without duplicates, sorted by `compare`.
  - `D` is the part ids sorted in ascending order, delta-coded: the first id, then each difference.
- **Reading.** A decoded `record` with a `parts` array is a manifest. Otherwise it is a full record of today's form, read as today. The record's own unread paths are `U` minus the paths of its parts.

### Write: one transaction per record

The worker (or the main-thread mapper) makes each part's text, `hash` and deflated bytes, and gives them with the unread paths. The main thread then does only SQL, in one `BEGIN IMMEDIATE`:

1. `r = max(at, recorded_at + 1)` of the row at the key, read through `coverage_stored`. `r = at` when no row exists.
2. Find the stored parts in one statement: `SELECT id, hash, used_at FROM coverage_parts WHERE hash IN (SELECT value FROM json_each(?))`.
3. Insert each absent part with `used_at = r`.
4. Refresh the stale ones: `UPDATE coverage_parts SET used_at = r WHERE id IN (…) AND used_at < r - PART_REFRESH_MS`.
5. Upsert the manifest at the key with today's statement, passing `r` as `at`.

`PART_REFRESH_MS` is 1 hour (my choice). A shorter refresh writes more rows. A longer one makes prune decode more manifests.

### Read: one read transaction

`store.read`: read the row at the key. If it is a manifest, read `SELECT id, part FROM coverage_parts WHERE id IN (…)` and decode each part. A part is used only when it exists, its provider version is `COVERAGE_PROVIDER_VERSION` and its path is in `U`. Otherwise its path is unread (`unknown`), never "ran none of it", and the daemon logs it once. The daemon may keep decoded parts by id, with a limit as `BLOB_CACHE_LIMIT` has. A part's bytes never change, and its id is never used again.

### Replacement

The upsert replaces the row at the key and advances `recorded_at`, as today. The replaced manifest's parts keep their rows. No other record changes. Nothing is deleted at write time.

### Pruning and retention

- **Records.** As today: a record goes with the last result at its key. Old and new forms go by the same rule.
- **Invariant.** For each kept manifest R and each part P it lists: `P.used_at >= R.recorded_at - PART_REFRESH_MS`. Write steps 3 and 4 keep this invariant. Only daemons that write manifests must keep it, and an older daemon writes none.
- **Parts.** After the record prune, with `cutoff = now - retentionDays × day` and `bound = cutoff + PART_REFRESH_MS`:
  1. Read the rows with `recorded_at < bound` through `coverage_recorded`. These are the records kept past the retention, mostly at keys current in a live worktree.
  2. The mark is the ids those rows list when they are manifests. A daemon may keep each row's ids by `(key, provider_version, recorded_at)` from one prune to the next, so it decodes only rows it has not seen.
  3. Delete `coverage_parts` rows where `used_at < cutoff AND id NOT IN (mark)`, 256 at a time in their own transactions (`deleteInBatches`). Then vacuum as today.
- **Why a listed part is never deleted.** Suppose a kept manifest R lists P when P is deleted. If `R.recorded_at < bound`, R was in the mark: a record written after step 1 has `r` at the time of its write, far above `bound`, so R existed at step 1. If `R.recorded_at >= bound`, the invariant gives `P.used_at >= cutoff`, so P was not a candidate. Each delete batch tests `used_at` again under the write lock, so a write that refreshed P meanwhile keeps it. A clock that jumps back by more than about 7 days breaks this argument; I do not handle that case.
- **Retention.** A part is kept while any kept record lists it. It goes at most `retentionDays` plus 1 hour after a record last used it.

### Records stored before the change

They stay full records. They are read whole and go with their results. Nothing is rewritten, and nothing is backfilled. A full record at a key that stays current stays full until its key's next run.

### Older daemons (0.1.362 and before) beside a newer one

- **Open.** `user_version` is 1, so they open the store. Their statements do not read `coverage_parts`. The schema change makes SQLite prepare their statements again, but no existing table changes shape, so the Node 22 `SELECT r.*` failure (016-15) cannot happen. SQLite keeps `coverage_recorded` current on their writes.
- **Reads.** A manifest decodes as `{ v: 1, sources: [], unread: U }`. `coverageOf` gives `"unread"`, so each source the record holds reads `unknown`, and an early judgement leaves the record out. They show no false pass or fail, and they do not fail on the record. `has` and `storedAt` are unchanged.
- **Writes.** A full record replaces a manifest at the same key in one statement, and `recorded_at` advances. A newer daemon reads that record whole. The parts it no longer lists age out.
- **Prune.** They delete manifests with their results and never touch parts. Parts that only those manifests listed go at a newer daemon's prune, once they are older than the cutoff.

### Downgrade

An older Squeal reads every manifest as unread. Those sources stay `unknown` until their test files run again at a new key. `coverage_parts` stays and is not pruned until a newer daemon runs. Nothing fails to open.

### Read-only processes

Hooks, `status` and `squeal code` open with `create: false`. They make no table or index and write nothing. They read no record today. A future reader that finds a manifest finds the table too, because the table is made before the first manifest is written and is never dropped.

### Compatibility cost

- While older and newer daemons share a repository (hours, until plugin caches update), an older daemon reads the sources of every record a newer one wrote as `unknown`. It gives no false lines, only fewer lines.
- After a downgrade, the same `unknown` lasts until each test file runs again.
- About 1.85 KB of every manifest is the path list. It is there only for older readers: about 0.85 GB at 7 days at today's rate (inferred).
- The main thread does more SQL per stored record: one lookup statement, a few inserts and one update, in place of one 30 KB insert. I estimate 1 to 4 ms against about 1 ms today. I did not measure it. This is the done-when line most likely to be false.

## Options for the parent (design request)

| | A: one table at open, manifest in the same row (default) | B: one table at open, manifest where older daemons do not read | C: `user_version` 2 |
| --- | --- | --- | --- |
| Record row | Same key, same row, same `recorded_at` rule | A second row at `provider_version = -2` (or a second new table). Readers take the later of two rows. A write deletes the full row | New tables, rows designed freely |
| Manifest size (measured) | 2,046 B | 201 B | about 200 B |
| 7-day store (inferred) | about 1.0 to 2.0 GB | about 0.1 to 1.2 GB | about B's |
| Older daemon | Reads `unknown` (unread) at once | Reads no record: pending 36 s, then `unknown` (no record) | Loses complexity and coverage until it updates. After a downgrade, the code store never opens until the file is deleted |
| Spec change | D4: a table made at open | D4 as A, and a second meaning of the `provider_version` column, which the 2026-10-27 amendment says stays | A raise goes to the human first (C7, 016) |

Smallest migration: A. No raise, no rewrite and no backfill. Existing records age out with their results. B can follow A later without breaking it, and so can a raise that drops the path list.

Proposed D4 text for A, after "Indexes after version 1": "**A table after version 1** (015-85). `coverage_parts` is made at open as an index is, with `user_version` unchanged. It holds each source's coverage part once, by the SHA-256 of its text. A record stores the ids of its parts, and lists every path it holds as unread for daemons that predate the table. A part is deleted only when no kept record lists it and it was last used before the retention cutoff."

## Red-first store test plan

Every case is red at `776712148`, because there is no `coverage_parts` table.

1. `test/code/coverage/parts.test.ts`, "two records of one test file that differ in one source store the unchanged parts once": records with sources s1, s2, s3 at K1 and s1, s2, s3′ at K2 give four `coverage_parts` rows. Each key reads back equal to its input (`toEqual`).
2. Same file, "an equal blob never merges different hits": two records hold s at one path and blob, one with a line covered or a function hit that the other lacks. This gives two parts, and each key reads its own hits. The same blob at two paths also gives two parts.
3. Same file, "replacing one record leaves another whole": K1 and K2 share parts. Storing K1 again with another record leaves K2 equal to its input, advances `storedAt(K1)`, and deletes no part.
4. `test/code/prune.test.ts`, "pruning one record leaves another whole": K1's result goes. After a prune past the retention plus 1 hour, K2 still reads whole, and the parts that only K1 listed are gone.
5. Same file, "a part a long-kept record lists is kept": a record stored 30 days ago at a live key keeps every part it lists, whatever their `used_at`.
6. Same file, "a write during prune keeps what it lists": a part is stored before the cutoff. The mark is read. Then a new record lists the part. The sweep keeps it.
7. `test/code/coverage/parts.test.ts`, "an older daemon reads a shared record as unknown": the frozen 0.1.362 reading (`decodeRecord`, then `coverageOf`) of a manifest gives `"unread"` for each of its paths, and leaves the record out with `inHand`. A path the record does not hold gives no source, as today.
8. Same file, "an older daemon's write over a shared record is read whole": the frozen 0.1.362 `INSERT … ON CONFLICT` over a manifest is read whole by the new reader, with a later `storedAt`.
9. Same file, "an older daemon's prune keeps every part": the frozen 0.1.362 prune deletes records by key and leaves `coverage_parts` as it was.
10. Same file, "a missing part is unread, never ran-none": delete a part row with SQL, and its path reads `unknown`.
11. `test/code/store-index.test.ts`, as for 015-44: the table and indexes are made once at the first open, `user_version` stays 1, a reader makes none and reads full records the same, a second open takes no write lock, and two processes make them once.
12. `test/code/store.test.ts`: `TABLES` gains `coverage_parts` and `sqlite_sequence`. Pin the new table's columns.

## Implementation map, after the decision

- **Store** (`src/core/code/store/{schema,open,coverage,prune,types}.ts`): the schema objects and `makeIndexes` generalised to tables. `CodeCoverageRepo` gains `read(key): CoverageRecord | null` and a write that takes parts. `prune` gains the part sweep. Type changes are additive. `get` and `put` stay for full records and tests.
- **Coverage** (`src/core/code/coverage/{record,types,map-worker,mapper,writer}.ts`): part text, hash and deflate in the worker. `CoverageManifest` is a new type. The worker message carries parts instead of one encoded record.
- **CRAP cache** (`src/core/code/crap/cache.ts`): `record` reads through the repo, not `decodeRecord`. This file is under 015-78's ownership (`src/core/code/crap/**`) in this wave, so the change waits for 015-78 to land or needs its agreement.
- **Bundles** (`plugins/*/dist`): they drift and are rebuilt by whoever owns the build.
- **Measure in the slice:** main-thread time per stored record, before and after, on the writer's own pace tests.

## Checks run (survey)

No code changed, so lint, typecheck and tests were not run. The only runs were the two read-only probes above. Squeal had no changed path to check.

## As built (implementation, 2026-10-27)

The parent chose option A. The slice is commits `555a7445e`, `c9d95f23d` and `6ed5daa9d`, after the merge `7e6325831` of `682d635e3` (the D4 amendment and 015-78).

### What changed

- `coverage/parts.ts` (new): `shareRecord` makes a record's parts, hashes and bytes. `manifestBytes`, `readManifest`, `storedPart` and `assemble` write and read the manifest.
- `store/schema.ts`: `CODE_TABLES.coverage_parts` with `coverage_parts_used`, and `CODE_INDEXES.coverage_recorded`. `store/open.ts` makes both at a writable open, with the 015-44 lock and recheck. A reader makes nothing.
- `store/coverage.ts`: `putParts` writes one record in one `BEGIN IMMEDIATE`. `get` gives a manifest's parts joined. `put` is unchanged.
- `store/parts.ts` (new): `PART_REFRESH_MS`, the mark and the sweep, the invariant and the backwards-clock assumption. `store/prune.ts` runs the sweep after the record prune and reports `partsRemoved`.
- `coverage/map-worker.ts`, `mapper.ts`: the worker, or the main-thread mapper inside its pace unit, gives a `SharedRecord`. `writer.ts` `keep` calls `putParts` where it called `put`. Nothing else in `keep` changed.
- `crap/cache.ts`: unchanged (see below).

### Where it differs from the contract above

1. **Encoding.** A part's text is the source's entry as `encodeRecord` writes it, `{"path":…,"blob":…,"lines":…,"covered":…,"functions":…}`. Its hash is the SHA-256 of the provider version, a newline and that text. Each stored piece is raw deflate that ends byte-aligned (a stored block or a sync flush). So `get` joins a manifest's parts into the bytes `encodeRecord` gives, with no inflate and no new deflate. Reason: `crap/cache.ts`, `test/code/crap/chain.test.ts` and the runner tests read `get` and then `decodeRecord`. They did not need a change, so `cache.ts` stays as it is.
2. **Compression.** A part holds its head `{"path":<path>,` in a stored block, then its rest, which is deflated only when the text is over 1,024 bytes. On 600 records (scratch bench, not committed), a deflate of every part took 28 ms of the worker per record, with a 1.59 ms read and 2,110 KiB of parts. This way takes 2.67 ms and a 0.78 ms read, for 3,313 KiB (57% more). No deflate gives 3,737 KiB.
3. **Manifest.** It begins with the stored block `{"v":1,"sources":[],"parts":`. Its parts are pairs of (path index change, id change) in source order, not sorted ids, so a record reads back in its own order. `unreadAt` holds the indices of its own unread paths. `unread` holds every path, for older readers.
4. **Part check.** A part holds no provider version. A manifest at version V can name only parts that a write at V stored, because the hash covers V and ids are never used again. The read checks the path in the part's stored head against the manifest's path at that index. A part that is missing, unreadable or at another path reads unread, and the daemon logs nothing (`get` has no log).
5. **No `read(key)`, no mark cache.** `get` does what `read` was to do. The mark decodes the manifests of all records stored before `cutoff + 1 h` at each prune. Today's store holds no record older than 3 days (read 01:38), so with 7-day retention the mark reads none.

### Decisions the contract did not settle

- A reader keeps up to 8,192 parts by id with the path from each stored head (about 450 B each, so about 4 MB). A part's bytes never change under its id, and a test proves that a swept part's id is not used again.
- A write finds its known parts with one join on `json_each`, so each found part maps to its own index.
- `mapHere` still gives the whole encoded record, for `test/runners/node-test/coverage.test.ts` (outside this row).
- `put` stays, as the older daemon's write and for tests.

### Type changes (additive)

- `coverage/parts.ts` exports `SharedRecord`, `SharedPart`, `StoredPart` and `Manifest`.
- `CodeCoverageRepo.putParts(key, record: SharedRecord, at)`. `CodePruneReport.partsRemoved`. `CODE_TABLES` in `store/schema.ts`.
- `Mapper.map` gives `SharedRecord` (was `Uint8Array`). `FromWorker`'s `record` is a `SharedRecord`.

### What the tests pin

`test/code/coverage/parts.test.ts` and `parts-prune.test.ts` read every kept record back with `toEqual`, so a wrong merge or a deleted part shows as wrong coverage, not only as a row count:

- Sharing: two records that differ in one source store 4 parts and read back whole. Other hits, another path or another provider version give their own parts. A record stored again leaves another record that shares its parts whole, and `storedAt` advances. A long, deflated part reads back. A record's own unread paths and an empty record read back.
- Compatibility: a whole record reads as before. The 0.1.362 `put` statement over a manifest reads whole, with `storedAt` advanced. The released `decodeRecord` reads a manifest's own bytes as no source with every path unread. `coverageOf` then gives `"unread"`, and the early judgement leaves the record out. The 0.1.362 prune deletes records and no part.
- Damage: a deleted part and a part at another path read unread, never as "ran none of it".
- Prune: a 30-day-old record at a live key keeps its parts. A part no record lists goes once it is past the retention. A part a new record lists again stays. `used_at` moves only past the 1-hour refresh. A record stored by another connection between the mark and the sweep keeps its part. A clock moved back 29 days loses a part, and its sources read unread. A swept id is not used again. A store without the table prunes 0 parts.
- Store: `store.test.ts` and `store-index.test.ts` pin the new table, `sqlite_sequence` and `coverage_recorded`: made once, by a writable open only.
- A mutation check (refresh and mark turned off) made 5 prune tests fail. Restored.

### Measured (`probes/measure.mts`, 01:35)

The probe replays the newest 600 records of this repository's `code.sqlite` (5.8 minutes of writes), read-only, into two scratch stores. It times each write, each `get` plus `decodeRecord`, the worker's share and one mark with every record kept. Load average 48.3, then 47.3, on 24 CPUs. That is the host's real load from parallel coordinators, not load made on purpose.

| | Whole (0.1.362) | Shared |
| --- | --- | --- |
| File after checkpoint | 16,822,272 B | 6,926,336 B (59% less) |
| Record and part bytes | 15,555,144 B | 4,217,805 B, 6,994 parts |
| Main-thread write, ms (median, p95, max) | 0.36, 0.66, 25.5 | 1.84, 4.60, 77.7 |
| Main-thread `get` + decode, ms | 0.96, 1.80, 10.5 | 1.11, 2.34, 7.9 |
| Worker share, ms | (in `encodeRecord`) | 2.33, 4.78, 164.3 |
| Mark, every record kept | 150.5 ms (reads whole rows) | 72.5 ms |
| Records read back different | 0 | 0 |

- The write costs about 1.5 ms more per record on the main thread. It is inside the writer's `pace.measure`, so the next unit of the shared pace waits as long again, and the change feed and hooks keep at least half the time (015-42). The 77.7 ms maximum is one write under load; I did not find its cause.
- 600 records in 5.8 minutes share less than the survey's 2,400 in 39 minutes did (86% less there). The 7-day size stays a projection.

### Pacing, turns and locks

- `keep` is still one unit of the shared pace. The main-thread mapper counts the hash and compression in its unit. With the worker, the main thread does only SQL.
- The prune is one synchronous call each hour, as before. The mark reads outside a write transaction, one row at a time: about 0.12 ms per manifest and 0.25 ms per whole record kept past the cutoff. The sweep deletes 256 parts per `BEGIN IMMEDIATE` and tests `used_at` again in each.
- 015-79 (writer loses a record after `SQLITE_BUSY`): `putParts` takes the lock in the same busy slice as `put`, so a busy store throws from `keep` as before. This slice does not repair that. The write lock is held for about 1.8 ms in place of 0.4 ms.

### Backwards clock (assumed, not measured)

As the header of `store/parts.ts` says: the clock must not move back by more than the retention less 1 hour between a record's write and a prune. If it does, a part can go while a kept record lists it. That record's sources then read unread, never as not run. A test pins this outcome.

### Remaining concerns

- The bundles (`plugins/*/dist`) drift from the build. They are not this row's files.
- Older daemons read every shared record as unknown while versions mix, and after a downgrade (the cost the contract accepted).
- The mark decodes all records kept past the cutoff at each prune and does not keep them. If many records outlive the retention, its turn grows by about 0.12 ms per record.
- The part cache holds up to about 4 MB per daemon's code-store connection (estimated from part sizes, not measured).
