# Store contention: why the local store reports "database is locked", and the smallest fix

Row 021-03, topic `store-contention` of `README.md` (second round). Researcher a1540808, 2026-11-11. Source read at `0fa197e09`; the probes ran the committed bundle `plugins/claude-code/dist/cli/squeal.mjs` (0.1.430), the version every live daemon on this host ran. Node v24.22.1, SQLite 3.53.4, 24 CPUs. Store copies made 14:22Z to 14:23Z with `cp`; live stores were only observed through `/proc/locks` and `/proc/*/fd`, never opened. Probes, raw output and doc quotes: `probes/store-contention/` (throwaway). Tags: **[exp]** verified by experiment, **[docs]** read in official docs, **[src]** read in source code, **[inf]** inferred.

## Questions answered

| # | Question | Answer |
|---|---|---|
| 1 | Inventory of lock failures | More than 40 reports on record (issues, their comments, board rows, CI runs). Two classes are still open: one-shot CLI writes with a 1 to 2 s busy timeout and no retry (`hold`, `stop` mark, `start` mark clear: about 20 reports since 2026-11-06), and daemon writes outside the retry path (revision apply #138 and 011-104, startup #176). Before this research no incident since 2026-10-09 named its holder. **[src, docs]** |
| 2 | Writers today | Every daemon, every hook process and eight CLI commands write. All writes use `BEGIN IMMEDIATE`. Busy timeouts are 1 s (hooks, `hold`, status), 2 s (`stop`/`start` marks, `retry`, `import`), 5 s (daemon serving), 120 s (daemon start). No checkpoint setting is made; cezar's WAL was 443 MB beside a 4.0 GB store. **[src, exp]** |
| 3 | Reproduce | Yes for #162: six daemons alone gave 0 failures in 54 CLI calls; with one extra process that holds the write lock 1.5 s in every 3 s (what live hooks do), `hold` failed with #162's exact message. Live, the holders are now named: cezar's daemons held the lock 55% of a 4-minute window in holds up to 1.2 s, and hook processes held it 0.9 to 1.8 s while writing one page. **[exp]** |
| 4 | Options | (a) fixes every failure class in 1 that has a bounded holder, with no new dependency. (b) removes cross-worktree contention for per-worktree writes but loses atomicity across files in WAL. (c) works but needs a process that must always run. (d) no engine on the list gives multi-process concurrent writes that Squeal can ship. **[docs, src, inf]** |
| 5 | Fit with the remote path | (a) is neutral. (b) helps: the shared file is the natural unit to export or sync. (c) and (d) make a remote store harder. **[inf]** |
| 6 | Recommendation | Option (a), in three parts: a bounded retry for every one-shot writer (011-212's `whileBusy`), daemon writes that are now unsliced moved into the retry path, and shorter hook holds. Keep `lock-watch.mjs` as the way to name a holder. Split the file (b) only if the watch still shows the lock busy more than about half the time after that. |

## Findings

### Q1. Inventory, grouped by cause

The full table with citations is in `probes/store-contention/inventory.md`. Summary **[src, docs]** (issue texts read with `gh issue view`, board and findings files at `0fa197e09`):

| Cause | Incidents | Timeout, retry | What the user saw | State |
|---|---|---|---|---|
| A. One-shot CLI write, short timeout, no retry | #162 (4 workers in one night) and 3 comments, #186 (duplicate); #158 and 4 comments, #181, #78 comment; #108 and 5 later reports (#1 c10/c11, #80, #138 c3, #108 c2) | `hold` 1 s; `stop`/`start` mark 2 s; none retried | `nothing is on hold: its Squeal store could not be written (database is locked)`, and the command still ran; `could not record the stop ... database is locked`, exit 0; `could not clear the stop mark: database is locked` | Open (#162, #158), deferred (#108). `retry` (#86, #1 c3/c4) had the same cause; fixed by 011-212 in 0.1.319 with a 10 s retry bound |
| B. Daemon write outside the retry path | 011-104 (599 of 825 files left unkeyed), #138, #1 c10; 5 notes `could not apply revision N: Error: database is locked` in cezar's store, the last at 14:19Z today; `could not record revision N as refined`, `runner testFiles failed: database is locked` (13:50Z today) | revision apply and refinement: 5 s, not retried (`runner-work.ts:248-268`) | a revision applied late or a test file with no key | Held (011-104), open (#138) |
| C. Daemon startup | #176 (revision 0, no request taken), 001-161, 005-53 | 120 s at start | `deadline passed before the daemon took request` | Open; issue-176.md found a 4 s lock recovers, cause not reproduced |
| D. Daemon writes that stopped the pump or held the event loop | #1 body, 001-412, 011-126, gh-12, 001-346 | 5 s | `scheduler stopped running tiers: Error: database is locked` | Fixed in 0.1.198, 0.1.203 (001-422: 250 ms slices and retry), 0.1.273 |
| E. Read failures | #8 (exclusive file lock), #7 and 011-113 (a read that turns into a write gets BUSY at once) | 1 s | `status unavailable, store busy` | Fixed by 0.1.266 |
| F. Code store (`code.sqlite`, same pattern) | 015 dogfood C2; 18 notes `coverage: N completed test files got no record ... N busy` in cezar's store, the last at 14:20Z today | coverage writer: paced retry since 015-79 | coverage records dropped | Fixed for the writer; the lock is still held for minutes (Q3) |

The holders identified before today: a prune (15.1 s, 001-141), a tier record (11 to 67 s for 198 files, 001-161), `beginTier` (001-161). Every incident after 2026-10-09 has "holder unknown". The longest recorded busy episode is 1,853.8 s (cezar, 2026-11-11 08:32Z, `pruning, the heartbeat, consumer expiry`; `out/busy-notes-cezar.txt`) **[exp, on the copy]**. An episode runs from the first refused write to the last retry (`src/core/store/busy.ts`), so it is not one hold. The `pruning` group also contains the code-store prune (`lifecycle.ts:417-428`), and the note says "the store" for both files, so this episode may be on `code.sqlite` **[src; inf]**.

Notes persisted per worktree (newest 20 kept, so these are lower bounds) **[exp, on the copies]**: squeal's store has 56 busy episodes since 2026-10-04 (p50 0.2 s, 9 at 1 s or more); cezar's has 146 since 2026-10-14 (p50 0.5 s, p90 6.9 s, 51 at 1 s or more, 14 at 10 s or more).

### Q2. The writers today

**[src]** at `0fa197e09`, from `probes/store-contention/writers.md`, which carries the line citations:

- **Transaction mode.** Every write is `BEGIN IMMEDIATE` (`connection.ts:47`); reads are deferred `BEGIN` (`connection.ts:65`). Nested writes are savepoints.
- **Busy timeouts.** Default 1,000 ms (`open.ts:46`). Hooks 1,000 ms (`harness/shared/context.ts:95`); `hold` 1,000 ms with no retry (`cli/hold.ts:252`); `stop` mark and `start` mark clear 2,000 ms with no retry (`cli/stopped-mark.ts:12,68`); `start`'s handoff claim 1,000 ms (`cli/start.ts:266`); `retry`, named waits and `import` 2,000 ms per try inside a 10 s retry loop (`cli/store-writes.ts:20,51`). The daemon: 120 s until ready (`daemon/open.ts:54`), then 5,000 ms (`daemon.ts:852`). Change-feed passes, tier selection and record, `#requeue`, heartbeat, consumer expiry and prune wait a 250 ms slice and retry (`store/busy.ts`, `connection.ts:99-110`). Socket requests (retry, promote, focus, group, full suite), `#reconcilePaths`, refinement apply, CI import, `#register`, baseline and shutdown wait the full 5 s and are not retried.
- **The busy handler polls.** `node:sqlite`'s `timeout` sets SQLite's default handler, which sleeps 1, 2, 5, 10, 15, 20, 25, 25, 25, 50, 50, 100 ms and then 100 ms per try (`main.c` `sqliteDefaultBusyCallback`, version-3.53.4). There is no queue: the process that tries first after a release wins. `node:sqlite` offers no custom busy handler. Node's build has no `SQLITE_ENABLE_SETLK_TIMEOUT`, and at 3.53.4 that option is "placeholder code" for the WAL write lock **[docs, src; exp: `PRAGMA compile_options`]** (`docs-facts.md` A, G).
- **Long write transactions.** Tier record (results of every file of the tier, then the ledger; 11 to 67 s for 198 files in 001-161), revision apply (`scheduler/batch.ts:62-85`), the baseline's ledger commit (every test file and inherited state), CI import (one transaction per bundle, unsliced, `transfer-import.ts:84-114`), prune (`worktrees.remove` and `dropRuns` unbatched; results in batches of 256). No transaction spans an `await`, except one: **a hook that tells a report holds `BEGIN IMMEDIATE` across the rest of the hook and the write of its output, up to `HOOK_TIMEOUT_MS` = 2,000 ms** (`delivery/held-connection.ts:72-102`, `delivery/prepared.ts:133`, `harness/shared/hand-off.ts`; row 011-288, released in 0.1.386 on 2026-10-31). Inside that hold it may open a second hold on `code.sqlite` (`delivery/code-source.ts:108-130`).
- **WAL.** Only `journal_mode=WAL` and `synchronous=NORMAL` are set (`open.ts:155-156`). No `wal_autocheckpoint`, `journal_size_limit` or explicit checkpoint, so the defaults hold: a PASSIVE checkpoint by the committer past 1,000 pages, and no size limit (`DEFAULT_JOURNAL_SIZE_LIMIT=-1` in Node's build). SQLite's docs: with readers that always overlap, the WAL "grows without bound" **[docs]**. Observed: squeal's WAL 69.8 MB beside 841 MB, cezar's 443 MB beside 4,022 MB at 14:21Z **[exp]**.
- **Who had the store open** at 14:25Z **[exp, `/proc/*/fd`]**: squeal's store, 9 daemons; cezar's, 8 daemons and 2 `squeal code` gates.

**Sizes on the copies** (`out/store-stats.txt`) **[exp]**:

| Store | Size | Shared tables (content-keyed) | Per-worktree tables | `meta` (mixed) |
|---|---|---|---|---|
| squeal | 846 MB, 32 worktrees | results 606, test_file_imports 48, test_files 21, checks 6, failure_texts 3: 684 MB (81%) | known_states 55, file_hashes 47, consumer_views 18, test_file_keys 11, runs 11, revisions 8, transitions 2, checkpoints 1: 153 MB (18%) | 8 MB |
| cezar | 4,025 MB, 63 worktrees | results 2,272, test_file_imports 145, test_files 49, checks 18, failure_texts 12, import_files 10: 2,507 MB (62%) | known_states 1,215, file_hashes 42, runs 37, test_file_keys 35, checkpoints 35, consumer_views 16, transitions 4, revisions 4: 1,388 MB (34%) | 126 MB |

Per worktree: the tables in `WORKTREE_SCOPED_TABLES` (`repos/worktrees.ts:19-27`) plus `runs`, `checkpoints`, `worktree_environment_hashes`. Shared: `results` (its `worktree_id` is provenance only), `checks`, `failure_texts`, `test_files`, `test_file_imports`, `environments`, `imports`. The `hold` rows and the stop mark are per-worktree `meta` keys (`scheduler/hold-rows.ts:104`, `presence/events.ts:159`).

### Q3. Reproduction, and the holders named

**How a holder is named** **[docs, src, exp]**. SQLite's unix VFS takes the WAL write lock as a POSIX lock on byte 120 of the `-shm` file (`UNIX_SHM_BASE` = (22+8)*4, `os_unix.c` at version-3.53.4). `/proc/locks` lists that lock with its pid. `lock-watch.mjs` polls it and prints each hold: holder pid, command line, duration, WAL frames added. It opens no database. One poll interval merges back-to-back transactions of one process into one hold; to a waiter whose busy handler sleeps 100 ms, that is one hold too.

**Live, cezar and squeal, 14:34Z to 14:38Z, 20 ms polls, load 12.7 to 18.9** (`out/lockwatch-live.txt`) **[exp]**:

| Store | Lock held | By daemons | By hooks | Longest holds |
|---|---|---|---|---|
| cezar `store.sqlite` (8 daemons) | 59% of 248 s | 54.7%: three daemons about 19% each, holds p50 250 to 300 ms, 35 holds of 1.0 to 1.2 s, many with 0 frames written | 4.6%: `post-tool-batch` 1.3 to 1.8 s, `user-prompt-submit` 1.6 s, `stop` 0.9 s, each writing 0 or 1 frame | 1.8 s (a hook) |
| squeal `store.sqlite` (9 daemons) | 12.5% of 245 s | 2.2%, max 0.9 s | 10.3%: 88 `post-tool-batch` holds, max 0.5 s | 0.9 s (a daemon) |
| cezar `code.sqlite` | 99.9% of 190 s | one daemon (worktree 4d2e4314): holds of 4.8, 6.9, 10.9, 13.9, 35.5 and 116.1 s | none | 116.1 s |

A second 60 s watch at 3 ms resolution, 14:39Z, load 15 to 17, saw cezar's lock held only 3.9% of the time (max 0.3 s) **[exp]**: the load on the lock changes from minute to minute with the work of the worktrees. Over the full 25 minutes (14:34Z to 14:59Z, load 12.7 to 35.8) **[exp]**: cezar's store lock was held 24% of the time (by 5-minute window 8 to 49%), daemons 19.4% with 54 holds of 1 s or more and 6 of 2 s or more (max 3.4 s), hooks 4.5% with 28 holds of 1 s or more (max 2.0 s); squeal's store 17.4%, half by hooks (max 1.3 s), half by daemons (max 2.1 s); cezar's `code.sqlite` 43%, with 10 daemon holds of 5 s or more (59 to 116 s by two daemons). Holds of 2 s or more, which beat the `stop`/`start` timeout, happened about once every 4 minutes on cezar's store. A hold that crosses a window counts in the window it started in.

Three points follow. First, a 1 s busy timeout loses often against a lock held 59% of the time in holds near 1 s, because the handler polls. Second, a hook holds the shared write lock for most of its run under load to write one page; that is a holder of the length that fails `hold` (1 s) and comes near `stop`/`start` (2 s). Third, on cezar the hook holds are three times longer than on squeal. One explanation fits the source: the hook opens its code-store hold inside the store hold (Q2), and `code.sqlite` was held by one daemon for up to 116 s, so the hook waits its busy timeout on `code.sqlite` while it holds `store.sqlite` **[inf; not confirmed]**. The daemons' 0-frame holds of up to 1.2 s are write transactions that wrote nothing; the source does not show which operation they are, and this research did not determine it.

**Fixture reproduction** (`repro.mjs`, `out/repro-6.jsonl`): one clone under `$TMPDIR` with six worktrees, each with a real 0.1.430 daemon (`squeal daemon <root>`), 24 Vitest files of 20 tests. Each second: two edits, then one of `hold --max 1m -- true`, `stop --until-start` plus `start`, `status --json`, `retry`. `HOME` and XDG directories under `$TMPDIR`. Load 14.6 at start, 16.9 at end **[exp]**:

- Phase A, 60 s, daemons only: 54 CLI calls, 0 failures. Daemon holds: 324, max 36 ms. Small fixture, so short tier records.
- Phase B, 60 s, plus a stand-in that holds `BEGIN IMMEDIATE` 1.5 s in every 3 s, as the live hooks did: 1 of 10 `hold` calls failed after 1,161 ms with `squeal: nothing is on hold: its Squeal store could not be written (database is locked)` (#162, #186). `stop` and `start` (2 s) did not fail; the slowest took 2,009 ms. The daemons wrote 18 busy notes of 0.2 to 1.4 s, for revisions, heartbeats and tier results, and recovered.

Reproduced: #162 and #186 (cause A). Not reproduced: #158 and #108 (they need a hold of more than 2 s; the stand-in held 1.5 s), #138 and 011-104 (need a hold of more than 5 s during a revision apply), #176. Their mechanism is the same busy timeout at a longer hold, and the triage files reproduced each with a synthetic holder (issue-158.md: 2,252 ms; issue-138.md: 100 ms timeout) **[exp in those files]**.

**Polling and starvation** (`starve.mjs`, `out/starve.jsonl`, scratch database). One process that holds 1.5 s and pauses 1.5 s: a 1 s timeout got the lock in 18 of 20 tries, 2 s and 10 s in 20 of 20 (load 23.5) **[exp]**. Holders that take the lock again within 10 to 20 ms are different (load 20.5 to 21.2) **[exp]**:

| Holders, hold, pause | 1 s timeout | 2 s | 10 s |
|---|---|---|---|
| 1 × 1,500 ms, 1,500 ms | 18/20 | 20/20 | 20/20 |
| 3 × 300 ms, 20 ms | 9/20 | 18/20 | 20/20, slowest 6.4 s |
| 2 × 1,000 ms, 10 ms | 2/20 | 1/20 | 16/20, slowest 9.9 s |

No hold in the third row is longer than 1 s, yet a 10 s timeout fails 4 times in 20. The waiter sleeps up to 100 ms between tries, and the other holder takes the lock in the 10 ms gap first. So a retry bound alone does not help against a holder that keeps the lock almost all the time; it helps against holds that end and leave the lock free. The live cezar window (59% held, gaps unknown below 20 ms) lies between the first and second rows.

### Q4. Options

**(a) One file, fix the use.** Removes every cause-A failure whose holder is shorter than the bound: 011-212 already did this for `retry` with a 10 s bound, and #86 closed. The same `whileBusy` for `hold`, the stop mark, the mark clear and `start`'s claim; `hold` refuses to start its command when the write never lands (#162's ask). For cause B: revision apply, refinement and the socket requests through the sliced, retried path that 001-422 built for tiers (011-104's proposal). For holders: shorten the hook's hold, so it is not held while the hook waits for another file's lock or for its output; how is the spec's choice. Checkpoint policy (a `journal_size_limit`, a TRUNCATE checkpoint when idle) bounds the WAL but removes none of the failures in Q1 **[inf]**. Cost: code changes in `src/cli/` and `src/core/scheduler/`, no dependency, no migration, nothing for a user to run. It does not lower how often the lock is busy, only what a busy lock costs.

**(b) Split the file.** A per-worktree file for the tables in Q2 plus one shared file for content-keyed results, joined with `ATTACH`. `hold` and the stop mark would then wait only for their own worktree's daemon and hooks, not for 7 to 8 other daemons. Cross-worktree reuse (decision 0002) survives because results stay in the shared file. Costs: SQLite's docs say a transaction over attached WAL files "is atomic for each individual database, but [is] not atomic across all databases as a set" (`lang_attach.html`, `wal.html`) **[docs]**, and a tier record writes results (shared) and `known_states` (per worktree) in one transaction, so a crash could leave a state without its result; a migration that moves 34% (cezar) or 18% (squeal) of the rows into new files; every query that joins the two halves. Tier records still contend on the shared file **[inf]**.

**(c) One writer process per clone.** It could queue writes in order and batch them, so nothing polls. But hooks and the CLI write when no daemon runs (the stop mark, deliveries), so either a process must always run or there are two write paths. The `daemon-model` topic owns the process model; this topic notes only that (c) needs it **[inf]**.

**(d) Another engine on the same machine** (`docs-facts.md` B to G) **[docs, src]**:

| Engine | Concurrent writers across processes? | What Squeal would ship or run |
|---|---|---|
| SQLite `BEGIN CONCURRENT` (branch, 71f1e0e7) | Bodies run at once, page-level conflict check, but COMMIT still one at a time behind the same busy handler; not in any release, `parse.y` of 3.53.4 has no `CONCURRENT` | A custom SQLite build; `node:sqlite` cannot load one |
| libSQL (a1d031cb) | No: its README keeps SQLite's single writer | Native addon `libsql` 0.5.29, 9.7 MB on linux-x64, 9 targets |
| Turso (0c9fe0dd) | `BEGIN CONCURRENT` with row-level MVCC, but only inside one process; source refuses MVCC with multi-process access; multi-process WAL is "not production ready" | Native addon `@tursodatabase/database` 0.8.3, about 19 MB, 4 targets; pre-1.0 |
| PostgreSQL 18 | Yes, row-level locks | A server per user (`initdb`, `postgres`), against vision principle 2's "nothing to run" |
| LMDB (mdb.master 59e5488d) | No: one writer; a waiter blocks on a mutex instead of polling | Native addon `lmdb` 3.5.9, about 16 MB, 7 targets; no SQL, a full rewrite of `src/core/store/` |

None removes the serialization for many processes without a server or a rewrite. LMDB's blocking wait would remove polling starvation, but not the waits.

### Q5. Fit with the remote path

(a) changes nothing for a remote or shared store. (b) makes it simpler: the shared file holds exactly what `store-service.md` would share (results, checks, failure texts, closures), so it is the natural unit to export, import or replicate, apart from the per-worktree state no other machine needs. (c) would be the only process that writes, so a remote transport would sit behind it; that couples the two designs. (d) makes it harder: a second engine beside the git-ref route and the SQLite reader of `squeal import` **[inf]**.

### Q6. Recommendation

Do (a), and measure before anything larger.

1. Give every one-shot writer the retry bound of 011-212: `hold` (and refuse to launch when the hold is not stored), the stop mark, the mark clear and `start`'s claim. This removes causes A of #162, #186, #158 and #108 whenever no single holder runs past the bound. Evidence: #86 closed after the same change; the fixture failure in Q3 is a 1.5 s holder against a 1 s timeout.
2. Move the daemon writes that wait 5 s and are not retried (revision apply, refinement, socket requests) into the sliced, retried path of 001-422. This addresses cause B (#138, 011-104), with the same evidence as 001-422's fix of cause D.
3. Shorten the longest regular holders that Q3 named: the hook's hand-off hold (0.9 to 1.8 s on cezar, writing one page) and whatever the daemons' 0-frame holds of up to 1.2 s are. Find the latter with `lock-watch.mjs` and a daemon log line per write transaction over 250 ms.
4. Keep `lock-watch.mjs`'s method as a diagnostic: it names the holder by pid, which no incident report has done.

Steps 1 and 2 need step 3. SQLite's busy handler polls, and `starve.mjs` shows that a 10 s bound still fails when holders take the lock back to back. A bounded retry removes failures from holds that end; it does not remove failures from a lock that is almost never free.

What this does not fix: a holder that keeps the lock longer than any bound (the 116 s `code.sqlite` holds, 001-161's 11 to 67 s tier records on cezar's store), the fraction of time the lock is busy with 8 or more daemons, and #176's startup stall, whose cause issue-176.md did not find. If after steps 1 to 3 the watch still shows the lock busy more than about half the time, split the file (b), and accept its cross-file atomicity cost in the spec.

## Open questions

- What are the daemons' 0-frame write transactions of 0.3 to 1.2 s on cezar's store? Not determined: `/proc/locks` names the process, not the statement, and the source read did not pin it.
- Is the hook hold long on cezar because it waits for `code.sqlite` inside it? Inferred from source and the timing, not confirmed. A watch of both files with the hook's pid would decide it.
- Was the 1,853.8 s `pruning` episode on `store.sqlite` or `code.sqlite`? Not determined: the note names neither file.
- What held cezar's `code.sqlite` for 116 s? A daemon (worktree 4d2e4314); its operation is not determined. The coverage-busy notes say it drops coverage records today.

## Sources

- Issues #1, #7, #8, #86, #108, #138, #158, #162, #176, #186 and their comments, `gh issue view --comments`, read 2026-11-11. Board rows 011-104, 011-113, 011-126, 011-212, 011-288, 001-141, 001-161, 001-412, 001-422, gh-108, gh-158, gh-162, gh-176 in `docs/board.md` at `0fa197e09`; `docs/specifications/011-core/research/issue-{1,86,108,138,158,162,176}.md`; `docs/specifications/001-core-loop/research/issue-8-contention.md`; `docs/specifications/001-core-loop/tasks/{001-141,001-161,001-412}/notes.md`. Collated in `probes/store-contention/inventory.md`.
- Source at `0fa197e09`: `src/core/store/{open,connection,busy,paths,prune}.ts`, `src/core/store/repos/worktrees.ts`, `src/cli/{hold,stopped-mark,store-writes,start}.ts`, `src/core/daemon/{open,daemon,lifecycle}.ts`, `src/core/scheduler/{scheduler,batch,hold-rows}.ts`, `src/core/delivery/{held-connection,prepared,code-source}.ts`, `src/harness/shared/hand-off.ts`. Collated in `probes/store-contention/writers.md`.
- SQLite: https://www.sqlite.org/wal.html, https://www.sqlite.org/lang_attach.html, https://www.sqlite.org/lang_transaction.html, https://www.sqlite.org/c3ref/busy_timeout.html; source `version-3.53.4` (b09c88c1) `src/os_unix.c`, `src/main.c`; branch `begin-concurrent` (71f1e0e7) `doc/begin_concurrent.md`. libSQL https://github.com/tursodatabase/libsql (a1d031cb). Turso https://github.com/tursodatabase/turso (0c9fe0dd). PostgreSQL https://www.postgresql.org/docs/current/ (18). LMDB openldap `mdb.master` (59e5488d). Node https://nodejs.org/docs/latest-v24.x/api/sqlite.html. npm: `libsql` 0.5.29, `@tursodatabase/database` 0.8.3, `lmdb` 3.5.9. All retrieved 2026-11-11; quotes in `probes/store-contention/docs-facts.md`.
- Probes: `probes/store-contention/` (`lock-watch.mjs`, `repro.mjs`, `starve.mjs`, `store-stats.mjs`, `busy-notes.mjs`, `out/`).
