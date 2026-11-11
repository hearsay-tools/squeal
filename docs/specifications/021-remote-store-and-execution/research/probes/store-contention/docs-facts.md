# Store contention: facts from official docs and source

Retrieved 2026-11-11 (UTC) with `curl`, `git clone --depth 1` and `npm view` (`HOME` pointed at a scratch dir). No code from any clone or package was run. The one runtime check is `PRAGMA compile_options` read through the host's own `node` v24.22.1, noted under G.

## A. SQLite core

Sources: https://www.sqlite.org/wal.html (page updated 2026-08-25), https://www.sqlite.org/lang_transaction.html (2026-02-18), https://www.sqlite.org/c3ref/busy_handler.html, https://www.sqlite.org/c3ref/busy_timeout.html, https://www.sqlite.org/pragma.html (2026-10-04), https://www.sqlite.org/lockingv3.html (2025-05-31). The current release named on sqlite.org is 3.54.1. Source: https://github.com/sqlite/sqlite tag `version-3.53.4`, commit `b09c88c14082339b66c7b7158d609a771e64ca69`, which matches Node's bundled 3.53.4.

**One writer at a time; readers and writers**
- wal.html §2.1: "Because writers do nothing that would interfere with the actions of readers, writers and readers can run at the same time. However, since there is only one WAL file, there can only be one writer at a time."
- wal.html §1: "WAL provides more concurrency as readers do not block writers and a writer does not block readers. Reading and writing can proceed concurrently."
- lang_transaction.html §2.1: "SQLite supports multiple simultaneous read transactions coming from separate database connections, possibly in separate threads or processes, but only one simultaneous write transaction."
- src/wal.c, `sqlite3WalBeginWriteTransaction`: "There can only be a single writer active at a time." and "Only one writer allowed at a time. Get the write lock. Return SQLITE_BUSY if unable."

Summary: WAL lets readers and the one writer run at the same time. Writers queue on one lock across every process.

**SQLITE_BUSY returned without calling the busy handler**
- busy_handler.html: "The presence of a busy handler does not guarantee that it will be invoked when there is lock contention. If SQLite determines that invoking the busy handler could result in a deadlock, it will go ahead and return SQLITE_BUSY to the application instead of invoking the busy handler." The example the page gives is the rollback-journal case: one process promoting a read lock to a reserved lock while another promotes a reserved lock to an exclusive lock.
- lang_transaction.html §2.1: "If some other database connection has already modified the database or is already in the process of modifying the database, then upgrading to a write transaction is not possible and the write statement will fail with SQLITE_BUSY."
- lang_transaction.html §2.2: "BEGIN IMMEDIATE might fail with SQLITE_BUSY if another write transaction is already active on another database connection."
- src/wal.c (comment above `sqlite3WalBeginWriteTransaction`): "If another thread or process has written into the database since the read transaction was started, then it is not possible for this thread to write as doing so would cause a fork. So this routine returns SQLITE_BUSY in that case and no write transaction is started." The code returns `SQLITE_BUSY_SNAPSHOT`.
- src/btree.c, `sqlite3BtreeBeginTrans` retry loop (lines 3740–3741): `}while( (rc&0xFF)==SQLITE_BUSY && pBt->inTransaction==TRANS_NONE && btreeInvokeBusyHandler(pBt) );`

Summary: SQLite calls the busy handler only when the connection holds no transaction. A deferred transaction that has already read and then tries to write gets SQLITE_BUSY at once, with no retry, when another writer holds the lock or has committed since its snapshot. `BEGIN IMMEDIATE` waits under the busy handler instead.

**Checkpoint starvation and WAL growth**
- wal.html §2.1: "Thus a long-running read transaction can prevent a checkpointer from making progress. But presumably every read transaction will eventually end and the checkpointer will be able to continue."
- wal.html §6, "Checkpoint starvation": "However, if a database has many concurrent overlapping readers and there is always at least one active reader, then no checkpoints will be able to complete and hence the WAL file will grow without bound."
- wal.html §6: "This scenario can be avoided by ensuring that there are "reader gaps": times when no processes are reading from the database and that checkpoints are attempted during those times."

Summary: the WAL file can only be reset once no reader is using it. With readers that always overlap, it grows without limit.

**Default automatic checkpoint and `journal_size_limit`**
- wal.html §3.1: "By default, SQLite will automatically checkpoint whenever a COMMIT occurs that causes the WAL file to be 1000 pages or more in size, or when the last database connection on a database file closes."
- pragma.html, wal_autocheckpoint: "All automatic checkpoints are PASSIVE. Autocheckpointing is enabled by default with an interval of 1000 or SQLITE_DEFAULT_WAL_AUTOCHECKPOINT."
- wal.html §6: "The checkpoint does not normally truncate the WAL file (unless the journal_size_limit pragma is set). Instead, it merely causes SQLite to start overwriting the WAL file from the beginning."
- pragma.html, journal_size_limit: "Each time a transaction is committed or a WAL file resets, SQLite compares the size of the rollback journal file or WAL file left in the file-system to the size limit set by this pragma and if the journal or WAL file is larger it is truncated to the limit." Also: "The default journal size limit is -1 (no limit)."

Summary: the connection whose COMMIT pushes the WAL past 1000 pages runs a passive checkpoint in that commit. The WAL file is reused, not shrunk, unless `journal_size_limit` is set.

**How the busy handler waits (not fair, not FIFO)**
- busy_timeout.html: "This routine sets a busy handler that sleeps for a specified amount of time when a table is locked. The handler will sleep multiple times until at least "ms" milliseconds of sleeping have accumulated. After at least "ms" milliseconds of sleeping, the handler returns 0 which causes sqlite3_step() to return SQLITE_BUSY."
- busy_handler.html: "If the callback returns non-zero, then another attempt is made to access the database and the cycle repeats."
- src/main.c, `sqliteDefaultBusyCallback` (sleep schedule in ms when nanosleep is available):
  ```c
  static const u8 delays[] =
     { 1, 2, 5, 10, 15, 20, 25, 25,  25,  50,  50, 100 };
  static const u8 totals[] =
     { 0, 1, 3,  8, 18, 33, 53, 78, 103, 128, 178, 228 };
  ```
  After the 12th try, every further sleep is 100 ms. Without usleep support, the handler sleeps in whole seconds ("Sleeping must be done in increments of whole seconds").
- lockingv3.html: "The document only describes locking for the older rollback-mode transaction mechanism." Its writer-starvation remedy, the PENDING lock, applies to rollback mode. No queue or fairness guarantee for WAL writers was found in any of these pages.

Summary: a waiting writer sleeps and retries with backoff (1, 2, 5, 10 … then 100 ms). The lock goes to whichever process tries just after it is released. No queue keeps waiters in order, so a waiter that has backed off to 100 ms sleeps loses to fresh arrivals. That fits starvation, though the docs do not use that word for WAL.

**-shm lock bytes (src/os_unix.c and src/wal.c at 3.53.4)**
- os_unix.c:
  ```c
  #define UNIX_SHM_BASE   ((22+SQLITE_SHM_NLOCK)*4)         /* first lock byte */
  #define UNIX_SHM_DMS    (UNIX_SHM_BASE+SQLITE_SHM_NLOCK)  /* deadman switch */
  ```
  `SQLITE_SHM_NLOCK` is 8 (sqlite.h.in), so the base is 120 and the deadman switch (DMS) is 128.
- os_unix.c (start-up assertions): `assert( UNIX_SHM_BASE==120 );  /* Start of locking area */`, followed by the table "WRITE UNIX_SHM_BASE 120 / CKPT +1 121 / RECOVER +2 122 / READ-0 … READ-4 123–127 / DMS UNIX_SHM_BASE+8 128".
- wal.c: "The standard implementation used on both unix and windows is for the index number to indicate a byte offset into the WalCkptInfo.aLock[] array in the wal-index header. In other words, all locks are on the shm file. The WALINDEX_LOCK_OFFSET constant (which should be 120) is the location in the shm file for the first locking byte."

Summary: the WAL writer lock is a POSIX advisory lock on byte 120 of `<db>-shm`. That is the byte a lock watcher should read, for example in `/proc/locks`.

**SQLITE_ENABLE_SETLK_TIMEOUT**
- sqlite.h.in, `sqlite3_setlk_timeout`: "This routine is only useful in SQLITE_ENABLE_SETLK_TIMEOUT builds. If the VFS supports blocking locks, it sets the timeout in ms used by eligible locks taken on wal mode databases by the specified database handle. In non-SQLITE_ENABLE_SETLK_TIMEOUT builds, or if the VFS does not support blocking locks, this function is a no-op."
- os_unix.c, `osSetPosixAdvisoryLock` (SETLK_TIMEOUT build): "The code below is placeholder code. If SQLITE_TEST is defined, the placeholder code retries the lock once every 1ms until it succeeds or the timeout is reached. Or, if SQLITE_TEST is not defined, the placeholder code attempts a non-blocking lock and sets unixFile->iBusyTimeout to 0." In this file, `F_SETLKW` appears only on the block-on-connect shared read lock (`unixFileLock`), not on the WAL write lock.
- os_unix.c (no SETLK_TIMEOUT): "If SQLITE_ENABLE_SETLK_TIMEOUT is not defined, then do a non-blocking attempt to set the lock."

Summary: the option would let some locks wait inside the kernel. At 3.53.4, though, the unix VFS still takes the WAL write lock without blocking, even with the option on. Node's build does not set the option anyway (see G).

## B. SQLite `BEGIN CONCURRENT` and `wal2` branches

Sources: `doc/begin_concurrent.md` on the `begin-concurrent` branch of https://github.com/sqlite/sqlite, commit `71f1e0e7384acdd2f80814a52df5f68cc4b99f33` (the same file is served at https://www.sqlite.org/src/doc/begin-concurrent/doc/begin_concurrent.md). `doc/wal2.md` on branch `wal2`, head `279fcddc23560095cc5a743d96d072474d5217f3`, fetched raw from GitHub.

- What it allows: "The BEGIN CONCURRENT enhancement allows multiple writers to process write transactions simultanously if the database is in "wal" or "wal2" mode, although the system still serializes COMMIT commands."
- Page-level conflict detection: "When a write-transaction is opened with "BEGIN CONCURRENT", actually locking the database is deferred until a COMMIT is executed. This means that any number of transactions started with BEGIN CONCURRENT may proceed concurrently. The system uses optimistic page-level-locking to prevent conflicting concurrent transactions from being committed."
- Conflict outcome: "Otherwise, if the transaction does conflict, it cannot be committed and an SQLITE_BUSY_SNAPSHOT error is returned. At this point, all the client can do is ROLLBACK the transaction."
- COMMIT still serializes, on the same busy handler: "In order to serialize COMMIT processing, SQLite takes a lock on the database as part of each COMMIT command and releases it before returning. At most one writer may hold this lock at any one time. If a writer cannot obtain the lock, it uses SQLite's busy-handler to pause and retry for a while:" The doc goes on: "If there is significant contention for the writer lock, this mechanism can be inefficient. In this case it is better for the application to use a mutex or some other mechanism that supports blocking to ensure that at most one writer is attempting to COMMIT a BEGIN CONCURRENT transaction at a time."
- Hot pages: "then monotonically increasing values are assigned automatically. This is terrible for concurrency, as it all but ensures that all new rows are added to the same database page."
- Branch, not release: not stated in begin_concurrent.md. Checked in source instead: `src/parse.y` on the branch has `CONCURRENT /* BEGIN CONCURRENT */` and a `TK_CONCURRENT` token, and `src/parse.y` at `version-3.53.4` has no match for "concurrent".
- wal2 (doc/wal2.md): "A database in wal2 mode may only be accessed by versions of SQLite compiled from this branch. Attempting to use any other version of SQLite results in an SQLITE_NOTADB error." Also: "Wal2 mode does not have this problem. In wal2 mode, wal files do not grow indefinitely even if the checkpointer never has a chance to finish uninterrupted."

Summary: BEGIN CONCURRENT runs transaction bodies in parallel but still commits one at a time through the same sleep-and-retry handler. It needs WAL or wal2 and exists only on a branch, so node:sqlite cannot use it. wal2 fixes unbounded WAL growth, but its database files can only be opened by builds of that branch.

## C. libSQL

Sources: https://github.com/tursodatabase/libsql at `a1d031cb602fedefbcf55c568e98e998a2274400` (README.md, docs/, libsql-sqlite3/doc/libsql_extensions.md). npm package `libsql` 0.5.29 (npm view and its tarball README).

- README: "**libSQL** (this repository) is an open-source fork of SQLite. It extends SQLite with features like embedded replicas and remote access, but inherits SQLite's fundamental limitations such as the single-writer model."
- README: "**If you're starting a new project, you probably want to look into [Turso](https://github.com/tursodatabase/turso).** libSQL is actively maintained, but new features are being developed in Turso."
- libsql_extensions.md, "Virtual WAL": "Write-ahead log is a journaling mode which enables nice write concurrency characteristics - it not only allows a single writer to run in parallel with readers, but also makes `BEGIN CONCURRENT` transactions with optimistic locking possible." This describes WAL in general. libSQL's own `libsql-sqlite3/src/parse.y` has no match for "concurrent".
- docs/ (ADMIN_API, CONSISTENCY_MODEL, DESIGN, USER_GUIDE, HRANA/HTTP specs): concurrent writers: not found in libSQL docs/.
- npm `libsql` 0.5.29: dependencies `detect-libc`, `@neon-rs/load`. optionalDependencies `@libsql/{darwin-x64, darwin-arm64, linux-x64-gnu, linux-x64-musl, win32-x64-msvc, linux-arm64-gnu, linux-arm64-musl, linux-arm-gnueabihf, linux-arm-musleabihf}` 0.5.29. Wrapper unpacked size 43,990 B; `@libsql/linux-x64-gnu` is 9,719,847 B with `main` `index.node`. README: "This source repository contains libSQL API bindings for Node, which aims to be compatible with [better-sqlite3](https://github.com/WiseLibs/better-sqlite3/), but with opt-in promise API." and "Supports Bun, Deno, and Node on macOS, Linux, and Windows."

Summary: libSQL keeps SQLite's single writer and has no BEGIN CONCURRENT. Its Node package is a native addon with prebuilt binaries for 9 OS/CPU targets, about 9.7 MB on linux-x64.

## D. Turso (Rust rewrite)

Sources: https://github.com/tursodatabase/turso at `0c9fe0dd94c14a4f00106bffa9c9433d5965fd3a` (README.md, COMPAT.md, docs/manual.md, core/database.rs, bindings/javascript). npm `@tursodatabase/database` 0.8.3. The clone is main, which may be newer than 0.8.3.

- Status, README FAQ: "That said, we have not yet reached 1.0. The project is under active development, and some features are explicitly marked experimental." libSQL's README says: "Turso is currently in beta."
- Concurrent writes, README feature list (not the experimental list): "**`BEGIN CONCURRENT`** for improved write throughput using multi-version concurrency control (MVCC)." manual.md: "MVCC is a supported journal mode." COMPAT.md still says "In experimental MVCC mode there is an additional known gap: all statements on a connection share one MVCC transaction, …".
- Conflict model, manual.md: "When a concurrent transaction commits, the database performs row-level conflict detection and returns a `SQLITE_BUSY` (write-write conflict) error if the transaction attempted to modify a row that was concurrently modified by another transaction. This mode provides the highest level of concurrency at the cost of potential transaction conflicts that must be retried by the application. The transaction isolation level provided by concurrent transactions is snapshot isolation."
- MVCC is per process, manual.md: "The database maintains a centralized in-memory MVCC index that serves as the primary coordination point for all database connections." core/database.rs: `"cannot open MVCC database '{}' with experimental multiprocess WAL: MVCC does not support multiprocess access"`, next to the comment "concurrent multiprocess access silently loses committed transactions and corrupts live views."
- Multi-process, manual.md Limitations: "* No multi-process access". README experimental list: "**Multi-process WAL coordination** via the `.tshm` sidecar for cross-process WAL readers and writers." manual.md flag `--experimental-multiprocess-wal`: "**Note:** the feature is not production ready so do not use it for critical data right now." The JS binding exposes it as `experimental: ['multiprocess_wal']` (bindings/javascript/packages/common/types.ts).
- File format, README: "Turso is compatible with SQLite at the SQL dialect, file format, and C API levels, and existing SQLite database files work as-is. We are not at 100% yet, so some differences are still expected". COMPAT.md: "4. We don't support mixed SQLite and Turso in multi-process scenarios." manual.md: "If a database is written to using MVCC and then opened again without MVCC, the changes are not visible unless first checkpointed".
- Node package: `@tursodatabase/database` 0.8.3 depends on `@tursodatabase/database-common` ^0.8.3 (107,757 B). optionalDependencies: `database-darwin-arm64`, `database-linux-x64-gnu`, `database-win32-x64-msvc`, `database-linux-arm64-gnu`, all 0.8.3. Wrapper unpacked size 69,751 B; `@tursodatabase/database-linux-x64-gnu` is 18,911,943 B with `main` `turso.linux-x64-gnu.node` (napi-rs native addon). README: "**Cross-platform**: Supports Linux (x86 and arm64), macOS, Windows".

Summary: Turso's BEGIN CONCURRENT gives row-level optimistic writes, but only between connections inside one process. Two OS processes cannot share MVCC, and multi-process WAL is experimental and "not production ready". The Node package is a native addon of about 19 MB on linux-x64. It has 4 prebuilt targets, with no musl or Intel-mac build.

## E. PostgreSQL

Sources: https://www.postgresql.org/docs/current/ (PostgreSQL 18.6): explicit-locking.html, mvcc-intro.html, creating-cluster.html, server-start.html.

- mvcc-intro.html: "The main advantage of using the MVCC model of concurrency control rather than locking is that in MVCC locks acquired for querying (reading) data do not conflict with locks acquired for writing data, and so reading never blocks writing and writing never blocks reading."
- explicit-locking.html §13.3.2: "Row-level locks do not affect data querying; they block only writers and lockers to the same row."
- creating-cluster.html: "The data directory must be initialized before being used, using the program initdb which is installed with PostgreSQL."
- server-start.html: "Before anyone can access the database, you must start the database server. The database server program is called postgres."

Summary: writers to different rows run concurrently and only writers to the same row wait. A local install needs `initdb` plus a long-running `postgres` server process.

## F. LMDB and lmdb-js

Sources: `libraries/liblmdb/lmdb.h` from https://git.openldap.org/openldap/openldap, branch `mdb.master` at `59e5488d0362529ed924e903f4bcfb3efe05b847` (header version 0.9.70). http://www.lmdb.tech/doc/ was fetched but not needed. npm `lmdb` 3.5.9 (kriszyp/lmdb-js) and its README.

- lmdb.h: "The library is fully thread-aware and supports concurrent read/write access from multiple processes and threads." and "Writes are fully serialized; only one write transaction may be active at a time, which guarantees that writers can never deadlock. The database structure is multi-versioned so readers run with no locks; writers cannot block readers, and readers don't block writers."
- lmdb.h caveats: "Avoid long-lived transactions. Read transactions prevent reuse of pages freed by newer write transactions, thus the database can grow quickly. Write transactions prevent other write transactions, since writes are serialized."
- lmdb.h, how a stale writer is cleared: "Linux, systems using POSIX mutexes with Robust option - automatic". This implies a waiting writer sleeps on a shared mutex rather than polling, but that is inferred, not stated.
- npm `lmdb` 3.5.9: dependencies include `node-addon-api`, `node-gyp-build-optional-packages`, `msgpackr`. optionalDependencies `@lmdb/lmdb-{linux-arm, linux-x64, win32-x64, darwin-x64, linux-arm64, win32-arm64, darwin-arm64}` 3.5.9. Wrapper unpacked size 2,549,484 B; `@lmdb/lmdb-linux-x64` is 15,921,709 B. README: "`lmdb-js` is based on the Node-API for maximum compatibility across all supported Node versions and current Deno and Bun versions." and "`lmdb-js` is designed for transactions to go through this asynchronous batching process and return a simple promise that resolves once data is written and flushed to disk."

Summary: LMDB is also single-writer, but it supports several processes and a waiting writer blocks on a mutex instead of sleep-polling. It is a key-value store, not SQL. lmdb-js is a native addon with 7 prebuilt targets, about 16 MB on linux-x64, and batches writes on its own.

## G. Node.js `node:sqlite`

Source: https://nodejs.org/docs/latest-v24.x/api/sqlite.html (page is for v24.22.2).

- Stability: "Stability: 1.2 - Release candidate."
- `DatabaseSync` options, added in v24.0.0 ("Add timeout option."): "timeout <number> The busy timeout in milliseconds. This is the maximum amount of time that SQLite will wait for a database lock to be released before returning an error. Default: 0."
- Custom busy handler: not found in node:sqlite docs. The only "handler" on the page is the changeset conflict handler.
- Swapping the bundled SQLite: not found in node:sqlite docs.
- Runtime check (host `node` v24.22.1, `PRAGMA compile_options`): `sqlite_version()` = 3.53.4. Options include `DEFAULT_WAL_AUTOCHECKPOINT=1000`, `DEFAULT_JOURNAL_SIZE_LIMIT=-1`, `THREADSAFE=1`, `MUTEX_PTHREADS`. There is no `ENABLE_SETLK_TIMEOUT`.

Summary: node:sqlite offers only the `timeout` option, a millisecond budget for SQLite's default sleep-and-retry handler, with no way to install a custom or blocking handler. The docs do not say the bundled SQLite can be replaced, and the shipped build has no blocking-lock option.
