# 011-102 notes: the workarounds for Node below 22.19

Worker 5721e776, brief W2 of `tasks/wave-11.md`, base main at 46b7911c2. Shape: survey, then repair. The host has Node 24.21.0, 24.15.0 and 22.23.3, no 22.19 and no container runtime; none was installed. Each probe reads Node's own docs, changelog and source at the release tags, and a CI run on v22.19.0 where one exists.

## Results on Node 22.19

| Workaround | Needs | First Node with it | On 22.19 | Commit |
| --- | --- | --- | --- | --- |
| (a) `permitRecord` copies the permit file to read its `holder` row | a `URL` path and the `immutable` URI parameter | 22.15.0 | passes | 46388a99e, the change |
| (b) `rollback` drops "no transaction is active" by its text | `DatabaseSync.prototype.isTransaction` | 22.16.0 | passes | 584fafbc0, the comment only |

(a) is changed: `src/core/slow/slot.ts` has no `copyFileSync`, `mkdtempSync` or `tmpdir`. (b) is not: `rollback` is on the key format's path, and the coordinator's rule for that (below) keeps its code until the next key-format raise. Its comment now gives that reason, so `src/core/store/connection.ts` keeps its message regex.

## (a) The `immutable` URI read

- **Docs.** `doc/api/sqlite.md` at v22.13.0 and v22.14.0: `path` {string}. From v22.15.0 to v22.19.0: `path` {string | Buffer | URL}.
- **Changelog.** `CHANGELOG_V22.md`, 22.15.0: "**sqlite,test,doc**: allow Buffer and URL as database location (Edy Silva) [#56991](https://github.com/nodejs/node/pull/56991)", commit 227603dc30.
- **Source.** `src/node_sqlite.cc` at v22.19.0: `DatabaseSync::Open` passes `default_flags = SQLITE_OPEN_URI` to every `sqlite3_open_v2`, and `ValidateDatabasePath` passes a `URL`'s `href`, which must start `file:`, to it as the location. So SQLite parses `?immutable=1`. At v22.15.0 the same two lines are there. At v22.13.0 and v22.14.0 neither is: the path must be a string and no open passes `SQLITE_OPEN_URI`. This is why review 0.1.239 B1 found a `URL` refused and a `file:` string not opened on 22.13.
- **CI on v22.19.0.** Run 39712182091 (`cand/0.1.253`, 6a9dff11), job "Node 22 (2/3)" (119636702818), `node: v22.19.0`: `test/ps/work-store.test.ts (7 tests)` passed. Its test "a store no connection holds open, without -wal and -shm, is read and left as it was" opens `new DatabaseSync(<file: URL with search immutable=1>, { readOnly: true })` in `src/core/ps/work.ts` (014-26), reads the rows, and checks that the read made no `-wal` or `-shm`. A WAL store opened without `immutable` makes both, so the parameter took effect. The permit read is the same call on another file.
- **Change.** `permitRecord` opens `new URL(`${pathToFileURL(path).href}?immutable=1`)` read-only, as 011-58 first did (f8aeab919), and the copy is gone.
- **Test.** `test/slow/slot-holders.test.ts` "reads the holder in place, through SQLite's immutable URI, and writes no copy (011-102)" sets `TMPDIR` to a missing directory. The copy cannot be made there, so the old code returns `unreadable`; it failed on the base (red) and passes with the change. The file's other three tests read real holders through the same path.

## (b) `isTransaction`

- **Docs.** `doc/api/sqlite.md` has no `database.isTransaction` at v22.13.0 to v22.15.0. From v22.16.0 to v22.19.0: "`database.isTransaction` ... added: v22.16.0 ... Whether the database is currently within a transaction. This method is a wrapper around `sqlite3_get_autocommit()`."
- **Changelog.** `CHANGELOG_V22.md`, 22.16.0: "**sqlite**: add getter to detect transactions (Colin Ihrig) [#57925](https://github.com/nodejs/node/pull/57925)", commit 0e999eb65f.
- **Source.** `src/node_sqlite.cc` at v22.19.0, `DatabaseSync::IsTransactionGetter`: throws "database is not open" on a closed database, else returns `sqlite3_get_autocommit(connection) == 0`. A closed database throws from `exec` too, and the text match lets that error through, so the change at the next raise keeps that behaviour.
- **CI on v22.19.0.** No test that has run there discriminates it: `test/harness/stop.test.ts:206` reads `holder.isTransaction`, but `undefined` would pass there too. The test below expects `isTransaction` to be `false`, so CI's `node22` job on the candidate checks that 22.19 has it.
- **The key-format alarm.** `src/core/store/schema.ts` imports `rollback`, and `test/keys/validity/entries/global.ts` exports the schema, so `rollback` is in the global entry's emitted code. The change (9891c7b4c, `if (db.isTransaction) db.exec("ROLLBACK");`, since dropped from the branch) failed `test/keys/key-format.test.ts` at revision 5: "KEY_FORMAT_VERSION (src/core/keys/key-format.ts): changed lines no case runs, each needing a case under test/keys/validity/cases/: src/core/store/connection.ts:163 (baseline bundle line 3896); src/core/store/connection.ts:164 (baseline bundle line 3897); src/core/store/connection.ts:164, src/core/store/connection.ts:165 (baseline bundle line 3898); src/core/store/connection.ts:166 (baseline bundle line 3899); src/core/store/connection.ts:166, src/core/store/connection.ts:167 (baseline bundle line 3900); src/core/store/connection.ts:162 (candidate bundle line 3896)". No case reaches the catch branch, and a deleted line counts on the release side.
- **Outcome (the coordinator's rule, as for 011-101 the same day).** Code on that path stays until the next key-format raise (011-64 design 4, 011-37 D6); no harness or case is added only to permit a removal. So the code is the base's, and only the comment changes. It now says that Node 22.19 has `isTransaction` and that the change waits for the next key-format raise. The emitted bundle strips comments, and `test/keys/key-format.test.ts` passes at revision 7.
- **Test.** `test/store/opening.test.ts`, "rolling back a failed transaction (011-102)": after `INSERT OR ROLLBACK` makes SQLite end the transaction itself, `Connection.transaction` rethrows the constraint error, not "no transaction is active", and nothing is written. It covers the text match's branch, which had no test.
- **At the next key-format raise.** Replace the body with `if (db.isTransaction) db.exec("ROLLBACK");`, drop the comment's last sentence, and add the test that tells the two apart: with no transaction open, `rollback(db)` runs no statement (`vi.spyOn(db, "exec")` is not called). The base calls `exec("ROLLBACK")` once there; this test was red on the base and green with the change.

## Local runs

On Node 24.21.0 and on the host's 22.23.3 (`PATH=<22.23.3>/bin:$PATH node node_modules/vitest/vitest.mjs run ... --maxWorkers=1`):

- `test/slow/slot-holders.test.ts`, `test/status/slot-holders.test.ts`: 2 files, 9 tests passed on each.
- With the `isTransaction` change (9891c7b4c): `test/store/opening.test.ts`, `test/store/repos.test.ts`, `test/store/open.test.ts`, 3 files, 47 tests passed on each.
- With the kept code (584fafbc0): `test/store/opening.test.ts`, 1 file, 3 tests passed on 22.23.3, and on 24.21.0 through Squeal at revision 7.

## If CI's `node22` job fails (a)

Revert 46388a99e alone: it holds its test, and 584fafbc0 does not depend on it. Then the comment names 22.19, as the row asks. In `src/core/slow/slot.ts`, the `heldPermits` comment reads:

```ts
 * `slowSlotHeld` tests it, and a held one's `holder` row is read from a
 * copy of the file's bytes, since the holder's exclusive lock keeps every
 * other reader out and Node 22.19 opens no SQLite URI (`immutable`; row
 * 011-102). The row is committed before the holder keeps its lock, so the
 * bytes hold it. A missing directory or
```

The text matches no floor phrasing of `test/node-floor.test.ts`: it is a fact about one version.

(b) changes no code. Its new test reads `isTransaction` only to check that no transaction is left open; should 22.19 lack it, that line fails and the docs and source above are wrong.

## Left for the coordinator

- **Spec text.** 011 C6 (`spec.md` line 206) still says the holder record "is read without a lock, from a private copy of the permit file's bytes (Node 22.13 opens no SQLite URI; review 0.1.239 B1)". With (a) kept, it reads through SQLite's `immutable` URI, which needs Node 22.15.
- **Bundles.** `slot.ts` and `connection.ts` are in the CLI and plugin bundles, so they drift until the build runs. This tree ran no build.
- **Not changed.** `test/node-floor.test.ts:113` keeps "Node 22.13 opens no SQLite URI, and `isTransaction` needs Node 22.16;" as sample text of a fact about one version. The recorders under `src/runners/` run in the project's Node and are out of the row.
- **Key format.** `test/keys/key-format.test.ts` passes at revision 7 with (a) changed and (b) comment-only, so `slot.ts` is off the key format's path. `KEY_FORMAT_VERSION` and the adapter versions are unchanged.
- **Next key-format raise.** (b)'s change waits for it, with the code and the test given above. It is a follow-up line beside 011-101's, not a raise.
