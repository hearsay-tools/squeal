# Row 011-44: a named wait on a source path reads every closure only after a closure write

Worker 304fc6e2, 2026-11-14, brief `tasks/wave-90.md` W1, lead (a) of the row.

## What changed

| File | Change |
| --- | --- |
| `src/core/store/closure-writes.ts` (new) | The closure-write marker: `meta` key `closure-writes`, set to a new random 16-hex value by `markClosureWrite(conn)`; `closureWrites(meta)` reads it raw; `trustedClosureWrites(store)` returns it only while the trust rule (decision 6) holds. |
| `src/core/scheduler/revision.ts`, `src/core/store/transfer-rows.ts` | The two writers of closures, `storeClosures` and the transfer import's `addClosures`, move the marker once after their `testFiles.put` calls, in the same transaction (`storeClosures`' own, the import slice's). `TestFileRepo` is unchanged (repair round 1; decision 1). |
| `src/cli/stored-closures.ts` (new) | `StoredClosures`: one wait's stored closures by test-file id, read again only when the marker moved since its last read, read every time from a store with no marker. `storedReaders`: the rows whose stored closure holds the path and is valid for the row's key (001 D6's rule, as `validClosures` read it). |
| `src/cli/named-selection.ts` | `selectNamedFiles` takes an optional seventh argument, `stored` (default: a new `StoredClosures`, so a one-shot selection reads as before). `validClosures` is gone; `storedReaders` replaces it. |
| `src/cli/wait/named.ts` | `namedPoll` keeps one `StoredClosures` for the wait and passes it to each poll's selection. The snapshot (`wait/snapshot.ts`) reads once and is unchanged. |

## Decisions the row and brief did not settle

1. **The marker is written by the two closure writers, not by `TestFileRepo`** (repair round 1). The first shape bumped in `TestFileRepo.put` and `remove`, so a later writer could not miss it. After the rebase onto row 011-45, the key-format guard refused it: `repos/test-files.ts` is on the validity path and no case runs a closure write ("changed lines no case runs" on the put and remove lines and on `markClosureWrite`). Row 011-45 met the same refusal and moved its removals' bump to their one caller. So the bump moved to `storeClosures` (`scheduler/revision.ts`) and `addClosures` (`store/transfer-rows.ts`), neither on the validity path; `markClosureWrite` takes the `Store` and sets the meta row with a random value from `node:crypto`. `test/cli/stored-closures.test.ts` fails when another file calls `testFiles.put(` or `testFiles.remove(`, when a writer's bump line goes, or when another file writes `test_files` in SQL.
2. **A random value, not a counter.** A store removed and made again (a corrupt store moved aside, a schema reset) would count again from 1 and could repeat a value a running wait holds. `lower(hex(randomblob(8)))` never repeats in practice. A reader compares equality only.
3. **Order.** The writer moves the marker after the row, in the same transaction; the reader reads the marker before the rows. A reader whose read falls between two writes of a long import then keeps rows newer than its marker, and reads again at the next poll: never older rows under a newer marker.
4. **Validity stays per selection.** A closure's validity depends on keys (this worktree's and the writer's), which move without a closure write. So the kept part is the parsed closures only. Each selection checks, for the rows whose closure holds the path, `updatedBy === worktree` or the writer's current key for that file, read with `testFileKeys.list(writer, files)` in chunks of 500 files. The old read listed every key of every writer (`testFileKeys.list(writer)` for each writer). The result is the same rows: a test compares it with a fresh full read after each closure write and key move.
5. **Path sets are lazy.** A kept closure builds its `Set` at its first question; a closure read for one selection (no marker) searches its list. The first version built a set for every stored closure, which cost a store with no marker about 30% more than before on the cezar copy (the old read built sets only for valid rows).
6. **Trust: one rule for both store markers** (the coordinator's decision of 2026-11-14 15:00Z, repair round 1). A daemon of an earlier release writes closures with no bump, so an unconditional marker let a wait keep closures such a daemon replaced. The marker is now trusted only while at least one daemon is registered on the store and every registered daemon claimed its states marker (`everyDaemonClaims(store)`, `src/core/store/states-marker.ts`, row 011-45), read in the poll's read transaction with the marker, before the closures. Otherwise, with no marker, or with no registered daemon (as `statesMark`), the wait lists every closure each poll, as before. Rows 011-44 and 011-45 ship in one release, so a daemon that claims its states marker also moves the closure marker with each closure write. A poll that does not trust the marker forgets the kept value, so the next trusted poll lists again. The edge the states marker shares stays: an earlier daemon that registers, writes and leaves between two polls is not seen.
   An alternative that needs no writer's help: `SELECT MAX(rowid), COUNT(*) FROM test_files` (`INSERT OR REPLACE` gives the new row a rowid above every row; checked on Node 26's SQLite). A `remove` of the highest row followed by a put could repeat the pair. Not taken: the coordinator chose one rule for both markers.
7. **No key-format change.** After the repair, the global validity entries (`test/keys/validity/entries/global.ts`) reach `store/repos/test-files.ts`, unchanged from its base, and none of `store/closure-writes.ts`, `scheduler/revision.ts`, `store/transfer-rows.ts` or `cli/` (esbuild's metafile). `test/keys/key-format.test.ts` run directly on this branch: 12 passed, no raise. `KEY_FORMAT_VERSION` is untouched.

## Type changes (additive)

- `selectNamedFiles(store, worktreeId, root, cwd, paths, readers?, stored?)`: new optional `stored: StoredClosures`.
- New exports: `CLOSURE_WRITES_KEY`, `markClosureWrite`, `closureWrites`, `trustedClosureWrites` (`src/core/store/closure-writes.ts`); `StoredClosures`, `storedReaders` (`src/cli/stored-closures.ts`). `closure-writes.ts` imports `everyDaemonClaims` from `states-marker.ts`, unchanged.
- `TestFileRepo` is unchanged. `markClosureWrite(store: Store)` (it took a `Connection` before the repair).

## Tests

- `test/cli/stored-closures.test.ts`: the marker is absent until a closure write, moves on each closure the transfer import adds and stays when it adds none; the two writers are the only code that writes closures, and each bumps; a rolled-back write leaves it; a kept read lists the closures again only after a write; a store with no marker lists every time; a kept selection equals a fresh full read's after a key move with no closure write (W keyed as X: 12 to 13), the writer's key move (13 to 12), a closure that drops the path (to 11) and one that adds it (to 13), with three lists in all. Trust rows: the marker is trusted while every registered daemon claimed its states marker, and not once a daemon of an earlier release registers (`registerUnclaimed`, `test/cli/closure-trust.ts`); not with no daemon registered; and a closure such a daemon writes with no bump is in the next kept selection (12 to 13, equal to a full read's). The three trust rows fail when the rule ignores the claims (red check). The fixtures' daemons claim their states markers (`claimAll`), as a daemon of this release registers.
- `test/cli/named-wait-closures.test.ts`: the done-when's counting-store test. A named wait on `START` with a daemon that answers no readers polls at 20 ms; the store logs each poll's `testFiles.list` calls. A closure that adds the path (13 files) or drops it (11) is recorded after the third poll, and the held file runs after the sixth. Lists per poll: `[1, 0, 0, 1, 0, 0, 0]`, none after; the wait settles with the selection a full read gives. With the kept closures removed from `namedPoll` (red check), every poll lists once and both cases fail.

## CPU per poll, before and after, on a cezar store copy

Store: a copy of `~/projects/cezar/.git/squeal/store.sqlite` (2.8 GB) made with the SQLite backup API into a private `/tmp` directory, 2026-11-14 15:06Z; 2,451 stored closures, 45.0 MB of closure JSON, 79 writing worktrees, 88,888 test-file key rows. The copy had no marker (cezar's daemons run an earlier release); the "marker" rows set one, as a daemon of this release writes it.

Script: one `selectNamedFiles` call per poll in a store transaction, with no daemon readers (the store rule this row is about), 10 polls per row, `process.cpuUsage()` user plus system. "Before" is the source at `4244f2cb6` (the base); "after" is this branch. Bundled with esbuild from copies of `src/`, run on Node 26. Host load average 11.5 to 13.9 (24 vCPUs), from other sessions and this worktree's Squeal catch-up; no load was made on purpose.

| Worktree (its closures) | Path (readers) | Before, median | After, no marker | After, marker: first poll | After, marker: median |
| --- | --- | --- | --- | --- | --- |
| cezar main (23 of its own) | `packages/cezar/src/application-update/helper.ts` (selects 0) | 294 ms | 294 ms | 412 ms | 9.8 ms |
| the main writer, `c0567d84` (1,862) | same (selects 20) | 411 ms | 269 ms | 381 ms | 8.8 ms |
| cezar main | `package.json` (selects 23) | 247 ms | 243 ms | 388 ms | 18.3 ms |
| `c0567d84` | `package.json` (selects 1,856) | 387 ms | 262 ms | 413 ms | 18.9 ms |

The first poll with a marker builds the path sets it asks about; every later poll until a closure write costs 5 to 35 ms, most of it this worktree's key rows (1,926 for main), which the selection read before this row too. The rest of a named poll (the selected files' states, the daemon check) is unchanged; 011-42 measured the named test-file wait's whole poll at 7.8 ms.

## For the next worker

- Row 011-45 adds its own state marker beside this one; `closure-writes` is the only meta key used here.
- Lead (b) of the row, a by-path index in the store, is not needed for the poll; the first poll of a wait and every poll after a closure write still read every closure.
- The snapshot (`status <path>` without `--wait`) reads once and is unchanged.

## Repair round 1 (2026-11-14)

- Rebased the three commits onto row 011-45's `d52c02e0a` (`git rebase --onto d52c02e0a 4244f2cb6`). No conflict. 011-45 bumps its states marker in `TestFileKeyRepo`'s upserts; this row no longer touches `repos/test-files.ts` (decision 1), so that file is 011-45's as it was.
- The trust rule (decision 6): `src/core/store/closure-writes.ts` `trustedClosureWrites`, read by `StoredClosures.read`. The bump moved to the writers (decision 1) after key-format refused the repository's lines.
- The CPU table above was measured before the rule. The rule adds one `worktrees` list and one `meta` read per registered daemon per poll; on cezar's store copy (about 80 worktree rows) that is small beside the 9 to 19 ms the poll took. Not measured again: the store copy was removed.
