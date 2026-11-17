# 005-101: where the session-start hook's time goes

Researcher of row 005-101 (task 38faef1c), 2026-11-17, 08:20Z to 09:00Z. Brief: `session-start-cost-brief.md`. Read: `docs/vision.md`, `docs/styleguide.md`, `status.md`, `daemon-restart-per-turn.md` (005-99). Source: main at `395a2a8b7` (0.1.540) and `origin/cand/0.1.541` at `78397162f` (rows 005-98, 005-100). The live hooks and daemons ran the installed 0.1.531. Claude Code 2.1.321.

Data, read-only: Claude Code transcripts under `~/.claude/projects/` and Squawk run logs `~/projects/{cezar,squeal}/.ai/squawk/runs/*.ndjson` since 2026-11-14; daemon logs `~/projects/{cezar,squeal}/.git/squeal/logs/` for 2026-11-16 09:00Z to 2026-11-17 09:00Z. Stores: one consistent copy of each (`store.sqlite`, `code.sqlite`, `lint.sqlite`) taken 08:23Z in the scratch directory. Each copy's daemon sockets were rewritten to paths that do not exist before any hook code opened it. Probes: `probes/session-start-cost/` (throwaway, README there).

**Method.** `step-budget.ts` runs the hook's own code in-process on a copy, for the real worktree id of a subject worktree: cezar `3766b155` (32,390 known states), squeal `d36c4d53` (17,329). A `resume` with a new session id: not registered, so the full registration, as after Squawk's session end. The daemon spawn is a stub that starts `/bin/sleep`; no heartbeat comes, as on a real resume (below). Headline numbers come from `series-fresh.sh`: one run per process, no trace, variants interleaved, 12 rounds, because a real hook is always a fresh process with a cold JIT. Step splits inside the registration come from a traced series and from CPU profiles. "As a hook" adds the measured Node start and bundle load (median 90 ms, p90 114 ms, n=20). **Load:** the host's own, 1-minute load average 21 to 37 on 24 vCPUs during the series, stated per group below. No load was made on purpose; the probe is one hook's work at a time.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Time budget by step | Main, cezar: a median 2.29 s as a hook (p90 2.69 s), 11 of 12 runs over 2 s. The 750 ms wait for a heartbeat that does not come: 756 ms. The registration: 1.42 s (p90 1.83 s). Everything else: about 110 ms. Squeal: 1.57 s (p90 1.86 s), 758 ms and 686 ms. Field: 32 of 65 cezar and 23 of 111 squeal Claude resumes in Squawk ended cancelled | verified by experiment |
| 2 | Indexes | Every read is an index search but one: `runs.inFlight` scans all runs (cezar 10.6 ms warm, 459 ms cold; a partial index: 0.02 ms). The costliest read, the complexity store's uncounted files, searches by primary key into a table of 3.5 to 7.9 KB rows: a key-only index cuts it from 193 to 3.1 ms (cezar) and 97.5 to 2.8 ms (squeal), but only when forced with `INDEXED BY` | verified by experiment |
| 3 | Read less | The text of 0.1.537 still needs the known failures, the file counts and whether complexity counting is done. The registration also copies every known state into the consumer's view, three statements per state: 251 ms SQL in cezar; one `INSERT ... SELECT` writes the same rows in 48 ms. A daemon-kept summary would save the states' decode (about 300 ms) and part of the header (229 ms) | verified by experiment (SQL forms); the summary's gain inferred, its write cost not determined |
| 4 | Retain less | Stores 4.9 GB (cezar) and 4.2 GB (squeal), most in `results` and `loaded_modules`, which the registration does not read. The hook's reads are searches by worktree: their cost follows the worktree's own known states, about 40 to 44 µs each, not the table sizes. Only the runs scan grows with retention (84% of cezar's runs belong to unlisted worktrees) | verified by experiment |
| 5 | No daemon at session start | Both real repositories use `lookup-only`. The hook reads the setting only for one text clause, so its own time is the same under both settings. With no ensure: cezar 1.72 s as a hook (p90 2.25 s), squeal 0.81 s. Against 0.1.541 it saves about 4 ms, the spawn call. Against main it saves the 756 ms wait, which 0.1.541 already removes | verified by experiment; the setting's read in source code |
| 6 | Candidate `cand/0.1.541` (register first) | Cezar 1.67 s as a hook (p90 2.15 s), 2 of 12 over 2 s; squeal 0.82 s (p90 0.98 s). With the write lock held, it ends silent at 1.0 s and spawns no daemon (12 of 12); main spawns (12 of 12) | verified by experiment |
| 7 | The daemon's store check (the coordinator's addition) | The hook opens the store with no check; only a daemon's start runs `quick_check`, before it writes its record, so no heartbeat can come during it. On the copies: cezar 82.7 s cold, 12.6 s warm; squeal 36.3 s cold, 2.9 s warm. `results` and `loaded_modules` take 12.6 s of cezar's warm check and 2.8 s of squeal's. The 53 s and 98 s of 023-15 were this `quick_check`, on `VACUUM INTO` copies | verified by experiment; the order read in source code |

## 1. The budget

`series-fresh.sh`, 12 runs per group, one per process, untraced. Median / p90, ms. Cezar load 23 to 37, squeal 25 to 33.

| Step | cezar main | squeal main |
|---|---|---|
| Node start and bundle load (`node-start.sh`, n=20) | 90 / 114 | 90 / 114 |
| Store open, with the code and lint stores (`openContext`) | 4 / 5 | 5 / 6 |
| Ensure: stop and handoff reads, spawn call (median 4 ms, n=112) | 2 / 2 | 2 / 3 |
| Wait for the new daemon's heartbeat (`settle`, `SPAWN_SETTLE_MS` 750) | 754 / 759 | 756 / 756 |
| Sweep of the session's other consumers | 16 / 29 | 11 / 24 |
| Registration (`registerNow`, one write transaction) | 1,423 / 1,829 | 686 / 966 |
| Format | 2 / 2 | 2 / 2 |
| Output, hand-off commit, store close | 2 / 2 | 20 / 23 |
| **As a hook** | **2,290 / 2,693** | **1,569 / 1,862** |
| Over 2 s | 11 of 12 | 0 of 12 |

Inside cezar's registration, the mean of 3 fresh-process CPU profiles (1,404 ms sampled, `profile.py`): complexity registration 315 ms (`registerCode`); known states read 205 ms and decoded 96 ms; the view write 341 ms (`ensureCheckId` 200, the inserts 141); the header 229 ms (`readLiveHeader`); `tellRegistered` 122 ms; lint 26 ms; the rest 70 ms. The traced series (warm, several runs per process) names the statements, cezar / squeal median ms: known states with their checks 187 / 70 (32,390 / 17,329 rows); uncounted code files 155 / 91 (0 rows); views 108 / 60, check interning 101 / 50 and its id lookup 72 / 36 (each once per state); failing code states 82 / 29; `COMMIT` 35 / 8; the runs scan 11 / under 4. The write transaction is held from the registration until the output is written (row 011-288); its `BEGIN IMMEDIATE` waited 24 ms or less with no other writer.

**What keeps the process alive after the output.** With no daemon serving, the hand-off commits and closes in 2 to 20 ms, and `handOff.sent()` resolves at once (`src/harness/shared/hand-off.ts`). The spawned daemon is detached and unref'd (`src/core/daemon/ensure.ts`). *Read in source code; the 2 to 20 ms verified by experiment.* So a cancelled hook with its whole text written was killed in the last few ms. Its text was ready only near the 2 s limit. 2 of the 72 cancelled Claude SessionStart items in the Squawk logs carry the text.

**The field agrees.** Claude Code records `durationMs` for completed hooks, and for cancelled startup hooks; it records nothing for a cancelled resume (`hook-durations.py`, `squawk-hooks.py`, since 2026-11-14):

| Hook | cezar | squeal |
|---|---|---|
| Resume in Squawk (run logs): cancelled | 32 of 65 | 23 of 111 |
| Resume, completed: median / p90 ms (transcripts) | 1,587 / 1,857 (n=85) | 1,329 / 1,714 (n=106) |
| Startup in a task worktree: cancelled | 22 of 134 | 3 of 138 |
| Startup in the main checkout (Squawk's naming sessions): cancelled | 1,595 of 1,737 | 145 of 2,056 |

Of 200 completed resume registrations, 147 say "A daemon is starting": the 750 ms wait ran out. Of those, 144 took 1 s or more.

**With the write lock held** (`lock-holder.mjs`, 3.6 s from the hook's start, 6 runs per group): every variant fails after the 1,000 ms busy timeout (`STATUS_BUSY_TIMEOUT_MS`) with "database is locked" and says nothing. Main has spawned first (1.77 s); 0.1.541 and the no-ensure form have not (1.02 s). In the field, no completed hook ended empty (0 of 2,530). Other daemons' logged long writes held the store 17.1% of the last 24 h in cezar (median hold 485 ms, p90 1,133 ms) and 4.7% in squeal (`lock-share.py`). A write that starts at a random instant waits a mean 92 ms (cezar) and 27 ms (squeal), and waits past the busy timeout at 2.4% and 0.8% of instants. On main, a resume's own daemon is not that writer: the registration runs 750 ms after the spawn, while the daemon is still in its integrity check (005-99). *Verified by experiment; the last clause inferred.*

## 2. Query plans and indexes

`explain.mjs` on every statement over 5 ms, cezar copy (squeal the same):

| Read | Plan | Index gain, measured on a copy |
|---|---|---|
| Known states of the worktree, with checks | SEARCH `known_states` autoindex (worktree_id); temp B-tree for ORDER BY | none needed |
| Check id lookups and interning | SEARCH covering autoindex of `checks` | none needed |
| `runs.inFlight` (`src/core/store/repos/runs.ts:36`), from `status/open-runs.ts` and `presence/facts.ts` | **SCAN runs**, 35,718 rows | partial index `(worktree_id, started_at) WHERE end_state IS NULL`: 10.6 to 0.02 ms (median, n=50), built in 16 ms, one 4 KiB page |
| Uncounted code files (`src/core/code/store/counts.ts:57`) | SEARCH `files` PK; per file SEARCH `counts` PK | the planner keeps the PK. Forced key-only index: cezar 193 to 3.1 ms, squeal 97.5 to 2.8 ms (n=15). The `counts` rows carry `functions` JSON of 7.9 KB (cezar) and 3.5 KB (squeal) on average in a WITHOUT ROWID table, so each lookup reads wide pages. Cold page cache: 3.5 s in one run |
| Failing code states (`failingIn`) | SEARCH `states` PK (worktree_id); the outcome filter is `(? IS NULL OR s.outcome = ?)` | none: an index `(worktree_id, outcome)` with a plain predicate took 11.4 ms against 9.0 ms (squeal). The worktree has 260,733 code states in cezar |
| Lint states, test file keys, meta, worktrees, consumers | SEARCH by key | none needed |

## 3. What the text needs, and a cheaper write

The 0.1.537 registration says the revision and the daemon's state, `Known failures: N; X of Y test files are current`, the failure blocks, group lines, the complexity line only once counting is done (`codeAndLintLines`, `format.ts:540`), and lint. It no longer prints the worktree counts, inherited or imported counts.

- **The view copy is the largest avoidable cost.** `registerNow` writes every known state into the consumer's view (`views.writeMany`). `writeMany` resolves each check's id again with an insert and a select (`src/core/store/repos/consumers.ts:126`), although the state already holds `check_id`. `toView` copies only the check, the outcome and the fingerprint (`src/core/delivery/delta.ts:113`), so a set-based statement writes the same rows. `read-less.mjs`, 15 runs, rolled back: cezar 250.7 ms as now, 107.1 ms with the state's `check_id`, 47.8 ms as one `INSERT ... SELECT FROM known_states`. Squeal: 157.4, 55.5 and 25.0 ms. With the JS of `ensureCheckId` and the inserts (341 ms in the cezar profiles), the set-based form saves about 300 ms in cezar and about 150 ms in squeal per registration. *Verified by experiment (SQL); the JS share from profiles.*
- **Counting done.** The complexity line needs only "is every file counted". The read lists every uncounted file: 3,756 subquery lookups for 0 rows. The forced index above, or a done mark the daemon writes, cuts about 180 ms (cezar) and 95 ms (squeal).
- **A summary row.** Kept by the daemon in each commit that changes known states, with the file counts and the failing checks, it would spare the decode of every state (about 300 ms in cezar) and part of the header (229 ms). The view still needs the states, but the set-based write needs no decode. Its write cost is one more row in each state commit, and a second record of a fact the store already holds (styleguide: record a fact where it is known). *Inferred; write cost not determined, because no daemon was run.*

## 4. Sizes and retention

`table-sizes.mjs` and `orphans.mjs` on the copies. Rows; table + indexes in MiB.

| Table | cezar | squeal | Read by the registration |
|---|---|---|---|
| `results` | 4,293,196; 1,037 + 1,489 | 1,709,589; 413 + 555 | no |
| `loaded_modules` | 57,488; 1,482 | 75,050; 2,639 | no |
| `known_states` | 1,031,811; 216 + 34 | 314,881; 62 + 10 | its worktree's rows |
| `test_file_imports`, `import_files`, `file_hashes` | 126, 62, 25 | 158, 0, 48 | no |
| `runs` | 35,718; 24 + 2.5 | 18,130; 18 + 1.1 | scanned whole |
| `consumer_views` | 92,313; 7 + 7 | 117,152; 9 + 9 | written, one row per state |
| code store: `states`; `counts` | 6,411,557; 22,166 (2.0 GB file) | (1.3 GB file); 15,906 | its worktree's rows; looked up per file |

No statement on `results` or `loaded_modules` was among the 16 costliest of any run. Rows no read needs: cezar `results` of worktrees no longer listed 3,992,027 (93%), `runs` 29,931 (84%), `known_states` 15,419 of unlisted worktrees and 33,113 of 1 removed root; squeal `results` 82%, `runs` 86%. No view belongs to an unregistered consumer. Each registered consumer holds a full copy of its worktree's states (cezar: 8 consumers, 92,313 rows). The registration's cost follows the worktree's own states: 1,423 ms for 32,390 (cezar) and 686 ms for 17,329 (squeal), about 44 and 40 µs per state. Pruning other worktrees' rows does not change it, except the runs scan, which the index removes. *Verified by experiment.* Whether `results` of unlisted worktrees can go is a question for inherited results (row 011-35), not for this hook.

## 5 and 6. A start with no daemon, and 0.1.541

| As a hook, median / p90 ms (over 2 s) | cezar | squeal |
|---|---|---|
| Main, spawn and wait | 2,290 / 2,693 (11 of 12) | 1,569 / 1,862 (0) |
| Main's own `startSession` | 2,459 / 2,833 (12 of 12) | 1,583 / 1,719 (0) |
| `cand/0.1.541`: register first, then spawn, no wait | 1,667 / 2,154 (2 of 12) | 822 / 984 (0) |
| No ensure at all (question 5) | 1,722 / 2,254 (3 of 12) | 809 / 976 (0) |
| Daemon alive (no spawn, no wait) | 1,499 / 2,565 (3 of 12) | 799 / 1,042 (0) |

The last three rows differ within the load's noise (load 23 to 37). The spawn call costs a median 4 ms. So a start with no daemon adds nothing for the hook that 0.1.541 does not already give. Its gain is the machine's: no daemon for a session that never reaches a tool boundary (005-99: 847 daemon starts in squeal's main checkout in 2.6 days, nearly all for naming sessions with no tool call). The human's rule of 2026-11-17 allows it only where `baseline.onStart` is `lookup-only`. Both real repositories are: `~/projects/cezar/squeal.config.json` and `squeal.config.json` both say `"onStart": "lookup-only"`. With `lookup-then-run-missing` the hook's cost is the same, and the daemon starts at the session start as now.

**One finding against that rule.** In 0.1.541 a registration that fails (a busy store, any thrown error) also skips the spawn: `startSession` sets `ensured` before `registerFirst`, and `first.ensure()` runs only after the registration returns. The daemon then starts at the first tool boundary (`ensureIfStale`) also in a `lookup-then-run-missing` repository. Measured: 12 of 12 runs with the lock held spawned nothing. Frequency in the field: at most the busy-timeout share above, 2.4% (cezar) and 0.8% (squeal) of instants. *Verified by experiment; frequency inferred.*

## 7. The daemon's store check

Asked by the coordinator during the work, after row 023-15 (`../../023-results-at-commit/research/keys-by-walk.md` Q1) measured a lookup-only start of 60 to 107 s before its first key rows.

**The hook runs no check.** `openContext` opens the store with no `checkIntegrity` (`src/core/store/open.ts`, `connect`). The only caller that asks for one is the daemon's open, `checkIntegrity: "quick"` (`src/core/daemon/open.ts:228`). No traced hook run issued `quick_check` or `integrity_check` (0 of 148 runs). The code and lint stores are not checked at a start. *Read in source code; verified by experiment.*

**Which check the 53 s and 98 s were.** 023-15 timed `PRAGMA quick_check` on `VACUUM INTO` copies: 53.4 s (Squeal, 3.95 GB, load 15) and 97.6 s (squawk's store, 4.88 GB, load 20). That is the start's check. The full `integrity_check` runs after serving, in a child process at nice 10, at most once per store per 24 h (`FULL_CHECK_EVERY_MS`, `src/core/daemon/full-check-claim.ts`, row 011-226). *Read in their findings and in source code.*

**It delays the heartbeat.** The daemon takes its lock, opens the store with the check, writes its record, then starts its timers (`open.ts:96-228`, `daemon.ts:350-369`). So main's 750 ms wait cannot see a heartbeat on any start that checks a 4 GB store, which is why 147 of 200 completed resume registrations say "starting". *Read in source code; the count verified by experiment.*

**Time on the copies** (`quick-check.sh`: `evict.py` drops a copy's pages with `posix_fadvise`, `mincore` confirms, then `quick-check.mjs`; one run each, load 11 to 16):

| | cezar (4.9 GB) | squeal (4.2 GB) |
|---|---|---|
| Whole, cold page cache (0.0% resident) | 82.7 s | 36.3 s |
| Whole, warm (84% and 99.9% resident) | 12.6 s | 2.9 s |
| `results` alone, warm | 9.1 s | 1.4 s |
| `loaded_modules` alone, warm | 3.5 s | 1.4 s |
| Every other table, warm, summed | 1.8 s | 0.4 s |
| Live store resident now (`mincore` only) | 28.3% | 99.9% |

The live squeal store sits in memory, so its starts pay about 3 s. Cezar's sits mostly on disk, so its starts pay between 13 and 83 s. In the last 24 h of daemon logs, a later daemon gave up after waiting 30 s for the lock of a daemon that did not yet serve 237 times in cezar and 10 times in squeal. *Counts verified by experiment; that the check made those waits inferred: other start steps hold the lock too.*

**What would bound it.** SQLite's documentation (pragma page, fetched 2026-11-17; Node 26 ships SQLite 3.54.0): `quick_check` "runs in O(N) time" in the rows of the database. `quick_check(TABLENAME)` checks "only ... the table named and its associated indexes", and then "errors such as unused sections of the file or duplication use of the same section of the file by two or more tables cannot be detected". SQLite has no check of only new pages.

| Bound | Effect on the copies | Cost |
|---|---|---|
| A. Check once per store per period, a mark in `meta` as the full check keeps | Each start after the first in the period skips the whole check: 2.9 to 83 s to serving. Starts per day (005-99, worktrees alive only): squeal about 450, cezar about 230. At today's live residency that is about 22 min (squeal) and 48 min to 5.3 h (cezar) of one core per day, down to one check | A fault found up to one period later, as the 24 h full check already accepts |
| B. Check only the tables the start reads, not `results` and `loaded_modules` | cezar 12.6 to about 1.8 s warm, squeal 2.9 to about 0.4 s | Misses the whole-file faults the docs name; those two tables are checked only by the full check |
| C. A smaller store by retention | `results` of unlisted worktrees are 93% (cezar) and 82% (squeal) of its rows; by O(N), about 8.5 s and 1.2 s of the warm check. Cold, in proportion to its 2.5 GB and 1.0 GB: roughly half of 83 s and a quarter of 36 s | Only if inherited results allow it (row 011-35); also a `VACUUM` to shrink the file. *Inferred* |

## Root cause

The hook does a fixed wait and then a large write inside a 2 s budget. On main, after spawning a daemon, it waits up to 750 ms for a heartbeat that does not come in time on a resume (147 of 200 completed resume registrations say "starting"). It then copies every known state of the worktree into the new consumer's view, three statements per state, inside one write transaction. It also lists every uncounted complexity file through wide-row lookups. The registration's cost grows linearly with the worktree's known states, about 40 to 44 µs per state at this host's load. Cezar's task worktrees hold about 32,000 states, so the hook needs a median 2.3 s; squeal's hold about 17,000, so it needs 1.6 s and passes 2 s only in its tail. For the hook, store size, missing indexes and other daemons' writes add little on average: the one scan costs 11 ms warm, and lock contention a mean 27 to 92 ms. The cold-cache tail is not small: 3.3 to 3.5 s for a first run against a cold code store. The store's size matters for the daemon's start instead: its `quick_check` takes 2.9 to 83 s before the daemon writes any heartbeat (section 7).

## Candidate rows, ranked by measured gain per cost

| # | Change | Gain per registration, measured | Cost | Owner | Outside Squawk |
|---|---|---|---|---|---|
| 1 | Land 0.1.541 (005-98): no heartbeat wait | cezar 2.29 to 1.67 s, over 2 s 11 to 2 of 12; squeal 1.57 to 0.82 s | done, in review | 005 | Every Claude Code session start; every Codex start |
| 2 | The daemon's `quick_check` once per store per period (bound A, section 7) | 2.9 to 83 s of each later start's time to serving; up to hours of one core per day in cezar. Not the hook's time after row 1 | a `meta` mark, as the full check's | 011 | Every daemon start, in every repository; largest for large stores outside the page cache |
| 3 | 0.1.541 repair: spawn also when the registration fails | keeps the daemon's start at the session start in `lookup-then-run-missing` repositories; no time | a `finally` around the ensure | 005 | Repositories with `lookup-then-run-missing` |
| 4 | Seed the view with one `INSERT ... SELECT` from `known_states` | about 300 ms (cezar), 150 ms (squeal); SQL 251 to 48 and 157 to 25 ms | one store method; same rows (`toView` is a copy) | 011 (store), 005 (caller) | Every registration, also at a prompt or a tool boundary |
| 5 | Key-only index on code `counts`, used by the uncounted read (or a done mark) | 190 to 3 ms (cezar), 97 to 3 ms (squeal); 3.5 s cold | a code-store migration and `INDEXED BY`, or the JSON moved out of the key table | 011 (code store; spec 015) | Repositories with complexity on |
| 6 | Partial index on open runs | 10.6 ms to 0.02 ms warm, 459 ms cold | one migration, one 4 KiB page | 011 | Also `squeal status` and presence reads |
| 7 | The start's check without `results` and `loaded_modules` (bound B) | warm 12.6 to 1.8 s (cezar), 2.9 to 0.4 s (squeal); a smaller share than row 2 | whole-file faults found only by the 24 h full check | 011 | Every daemon start |
| 8 | A daemon-kept summary row for counts and failing checks | about 300 to 500 ms (cezar), inferred | a write in each state commit; a second record of a fact | 011 | Every registration; design risk |
| 9 | No daemon at session start (lookup-only repositories only) | about 4 ms per hook; the machine's daemon starts for sessions with no tool call | a policy branch in the hook | 005 | Users whose sessions often end with no tool call |
| 10 | Prune unlisted worktrees' results (bound C) | none for the hook; about 8.5 s (cezar) and 1.2 s (squeal) of a warm start check, inferred | depends on inherited results (011-35) and a `VACUUM` | 011 | Long-lived stores |

Rows 1, 4, 5 and 6 together would bring cezar's hook median near 1.2 s. *Inferred: the sum was not measured in one build.*

## Open questions

1. The time from the output to the process's exit in the real bundle: not determined, because the real bundle was not run against a copy. The in-process hand-off and close took 2 to 20 ms.
2. Why squeal's completed-resume p90 in the field (1.7 s) and its 21% cancellations exceed the probe's p90 (1.86 s, 0 of 12): not determined. Candidates: load spikes over 37, a cold page cache, and other daemons' writes. Claude Code records no time for a cancelled resume.
3. The registration's cost while a daemon serves the worktree, when the writes go to the daemon (spec 021 D15): not determined, because no daemon was run on a copy. 7% of resumes found a live daemon (005-99).
4. `tellRegistered`'s 122 ms in cezar: measured, not analyzed.
5. The write-side cost of a summary row (row 6): not determined.

## Sources

- SQLite, PRAGMA `integrity_check` and `quick_check`, fetched 2026-11-17: https://www.sqlite.org/pragma.html#pragma_quick_check
- Row 023-15: `../../023-results-at-commit/research/keys-by-walk.md` Q1 on `origin/main`.
- Squeal source at `395a2a8b7`: `src/core/daemon/open.ts:96-228`, `daemon.ts:350-369`, `full-check-claim.ts`; `src/harness/shared/session.ts`, `ensure.ts` (`SPAWN_SETTLE_MS`, `settle`, `ensureToRegister`), `deliver.ts`, `hook.ts`, `context.ts`, `hand-off.ts`, `sweep.ts`; `src/harness/claude-code/main.ts`, `run.ts`; `src/core/delivery/delivery.ts` (`registerNow`), `delta.ts:113`, `code-deliver.ts:165`, `format.ts:540`, `sent-store.ts`, `counts-owed.ts:47`; `src/core/store/open.ts`, `schema.ts`, `repos/consumers.ts:126`, `repos/runs.ts:36`; `src/core/code/store/counts.ts:57`; `src/core/daemon/ensure.ts`; `src/core/status/open.ts` (`STATUS_BUSY_TIMEOUT_MS`); `plugins/claude-code/hooks/hooks.json` (timeout 2), `hooks/run`.
- `origin/cand/0.1.541` at `78397162f`: `src/harness/shared/session.ts`, `ensure.ts` (`registerFirst`).
- Store copies, logs and transcripts as listed at the top; probe outputs in the task's scratch directory, not kept.
- Earlier findings: `daemon-restart-per-turn.md` (005-99), `../../011-core/research/fresh-start-counts.md` (011-223).
