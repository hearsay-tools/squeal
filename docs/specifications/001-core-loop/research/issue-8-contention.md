# Issue 8: do result queries fail after one second of store contention?

Research for [hearsay-tools/squeal#8](https://github.com/hearsay-tools/squeal/issues/8), brief `tasks/issue-8-triage.md`, 2026-10-16. Baseline `a5789453` (its committed bundle `plugins/claude-code/dist/cli/squeal.mjs`, 0.1.200) and shipped 0.1.199 (`~/.claude/plugins/cache/hearsay/squeal/0.1.199/dist/cli/squeal.mjs`). Node v24.21.0, `node:sqlite` SQLite 3.53.4, 24 CPUs, load average 15.6 to 32.9 during the runs. Every experiment ran on a disposable repository under `/tmp/i8`. The live cezar store was only listed (`ls`, `/proc/*/fd`), never opened. Probes: `probes/issue-8-contention/` (throwaway), raw output in its `results.txt` (E1 to E7).

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1a | Can controlled contention reproduce `why` and `status` failing after 1000 ms? | Yes, on both versions, with the issue's exact text. An exclusive lock on the database file fails `why` and `status --json` with exit 1 after 1120 to 1165 ms. The next call after release succeeds in 119 to 156 ms. | verified by experiment |
| 1b | Does a normal WAL writer reproduce it? | No. `BEGIN IMMEDIATE` or `BEGIN EXCLUSIVE` held 3 s or 8 s: every `why`, `status` and `failures` form answered in 109 to 206 ms. Four looping writers plus a looping `integrity_check`: 70 of 70 `why` succeeded, slowest 371 ms. | verified by experiment |
| 1c | Which real mechanism takes that lock? | SQLite names three cases. Two reproduce with Squeal's own access pattern, and only when no other connection holds the store open. In production no holder was observed, and eight live daemons held cezar's store at the time of this research, which rules out both of them then. The production holder is not determined. | verified by experiment; read in official docs; not determined |
| 2 | Is an existing row the same scope? | No. 001-10, 001-207, 001-412 and 001-422 are about writers or opening a new store; 001-409 and 001-411 add readers that share the same path. No row covers read availability of the CLI. The comments add two more 0.1.199 occurrences, one with the daemon live, and show `why` failing with and without `--include-logs`. | read in board, spec and source |
| 3 | How does the request fit the decision filter? | It passes 1, 2 and 6, is neutral on 3 to 5 if the retry is bounded and the diagnostic is honest. A bounded retry does not fix a lock held for longer than its bound. | inferred |

## Findings

### Q1. Reproduction

**What a read does on a busy store** (*read in source code*, `a5789453`). `withStatusStore` (`src/core/status/open.ts:53`) opens the store with `busyTimeoutMs` 1000 (`STATUS_BUSY_TIMEOUT_MS`), then runs the query in one deferred `BEGIN` (`Connection.read`, `src/core/store/connection.ts:65`). Any `SQLITE_BUSY` or `SQLITE_LOCKED`, at open or in the read, becomes `{ available: false, reason: "timeout", message: "status unavailable, store busy for more than 1000 ms" }`. There is no retry. `why`, `status` and `failures` all take this path. `status --wait` takes it too, but skips a busy read after its first one and polls again (`src/cli/status-wait.ts:168` and `:319`).

**E1, lock-mode matrix** (*verified by experiment*). Command per cell: `cd /tmp/i8/repo && node <cli> why 'auth > login'` or `node <cli> status --json`, run while `hold.mjs` held the lock for 3000 ms, then once after release. The disposable store was seeded by `seed.mjs` with the baseline's own store API.

| Lock held on the store | `why` held | `status --json` held | After release |
|---|---|---|---|
| none | exit 0, 148 to 189 ms | exit 0, 148 to 180 ms | n/a |
| `BEGIN IMMEDIATE` + write (normal daemon write, D8) | exit 0, 152 to 154 ms | exit 0, 119 to 194 ms | exit 0, 123 to 206 ms |
| `BEGIN EXCLUSIVE` + write (same as immediate in WAL) | exit 0, 109 to 189 ms | exit 0, 124 to 146 ms | exit 0, 125 to 199 ms |
| `locking_mode=EXCLUSIVE` + write (exclusive file lock) | **exit 1, 1131 (0.1.199), 1165 ms (baseline)** | **exit 1, 1120 (0.1.199), 1136 ms (baseline)** | exit 0, 119 to 156 ms |

The two versions behave the same. Failing outputs, verbatim: `Status unavailable, store busy for more than 1000 ms`; with `--json`, `{"schemaVersion":1,"available":false,"reason":"timeout","message":"status unavailable, store busy for more than 1000 ms"}`. A call that started 1.6 s into a 2.5 s hold waited out the last 0.9 s and succeeded (E1b): recovery is immediate once the lock frees within the budget.

**E2, no query writes** (*verified by experiment*). With `BEGIN IMMEDIATE` held 8 s, nine forms answered in 110 to 178 ms on both versions: `why` by exact name, by substring, with `--include-logs`, with no match, with `--json`; `status`, `status --json`, `status --notes`; `failures`. So no read path upgrades to a write lock, and a writer alone cannot explain the issue.

**What can block a WAL reader** (*read in official docs*, [sqlite.org/wal.html](https://www.sqlite.org/wal.html), section "Sometimes Queries Return SQLITE_BUSY In WAL Mode", fetched 2026-10-16). The page says "writers do not block readers and readers do not block writers. This is mostly true." It names three exceptions: another connection in exclusive locking mode; the last connection to close, which "will acquire an exclusive lock for a short time while it cleans up the WAL and shared-memory files"; and recovery after the last connection crashed. Squeal never sets `locking_mode=EXCLUSIVE` on the store. It does so only on its lock files, `locks/*.sqlite` (`src/core/daemon/lock.ts:88`, `src/core/slow/slot.ts:116`, `src/core/waiter-lock/waiter-lock.ts:81`) (*read in source code*).

**E3 to E6, the two other cases** (*verified by experiment*, 0.1.199):

- **Last close.** `lastclose.mjs` grew a WAL that no checkpoint could backfill, then closed the store's only connection. That close checkpoints under an exclusive lock. With a 403 MB WAL the close took 737 ms, and the overlapping `why` calls waited 290 to 758 ms and succeeded. With a 941 MB WAL it took 1941 ms: 6 of 7 overlapping `why` calls exited 1 with the issue's message at 1145 to 1185 ms (E3).
- **Control.** The same 941 MB close with one idle extra connection (`keeper.mjs`, standing in for a live daemon) took 3 ms and left the WAL in place, and 16 of 16 `why` calls succeeded (E4). SQLite checkpoints on close only for the last connection.
- **Crash recovery.** A writer SIGKILLed with a 941 MB WAL and no other connection, then 6 `why` calls opened at once: all exited 0, 5 of them in 699 to 732 ms (E6). Recovery fit the budget on this host. It could exceed it on a bigger WAL or a slower disk. That is *inferred*, not measured.

**Synthetic versus production** (*observed without opening the store; inferred*). At 22:39 local, cezar's store was 265 MB with a 90.6 MB WAL. Eight processes held it open, all 0.1.199 `squeal.mjs daemon`. Comment 1 of the issue says "the daemon remained live in this session", and other worktrees' daemons shared the store. A live daemon keeps its connection open from start to shutdown (`src/core/daemon/daemon.ts:706`). E4 shows that one open connection removes the last-close lock, and with it the precondition for crash recovery. The later process snapshot does not establish which connections were open at the reported failure times. If another daemon connection remained open throughout those failures, the last-close and recovery explanations would not apply. The process that held cezar's store exclusively for more than 1 s on 2026-10-16 between 19:14 and 19:18 UTC was not observed. It is not determined. What decides it is a capture during an occurrence: `/proc/*/fd` holders of `store.sqlite` and its locks (`/proc/locks`, or `fuser -v`). The reproduction proves the symptom and the recovery, not the cause.

### Q2. Existing rows and what the comments add

*Read in `docs/board.md`, spec 001 D7, D8, D12 and source, `a5789453`.*

| Row | Scope | Same as issue 8? |
|---|---|---|
| 001-10 shared store | WAL, a busy timeout on every connection, 4 writers and 4 readers lose nothing | No. It is the foundation. The 1000 ms read budget dates from the hooks (spec goal 6, D9), not from this row. |
| 001-207 | Opening a new store beside concurrent openers. The WAL switch skips the busy handler, so it retries. | No. On a store already in WAL the switch writes nothing, and E1 shows it is not hit under a held writer. |
| 001-409 `squeal failures` | A new read command through `withStatusStore` | No. It is a third command on the same path, so it fails the same way under an exclusive lock (read in source; E2 tested it only under a writer, where it answered). |
| 001-411 `why` durations | Reads every stored result of the check and of each candidate | No. It lengthens `why`'s read but adds no lock. A read in WAL takes none. |
| 001-412 "daemon error: database is locked" | Idle daemon passes took the write lock. Fixed; the ≥5 s holder was left unnamed. | No. That is writer against writer. |
| 001-422 (in review on cand/0.1.201) | A busy store costs the daemon a pass and its heartbeats: 250 ms busy slices with retry. From squeal#1. | No. Daemon side only. It is the nearest precedent for a bounded retry. |

No row covers whether the CLI's reads stay available. The issue itself separates this from squeal#1.

**What the comments add.** (a) Two more occurrences on 0.1.199: 19:16 to 19:18 UTC during cezarion#1138, and cezarion#1142. (b) In #1138, `why WP1 --include-logs` and plain `why WP1` both failed, so `--include-logs` is not the trigger. (c) "The daemon remained live in this session." That weighs against the last-close and recovery mechanisms (above). (d) In #1142, `status` and `status --json` "generally succeeded" while two `why` calls failed. Under the same lock both commands fail alike (E1), and their open path is the same code, so the difference is in timing and frequency, not code path. That is *inferred*: no experiment separates them. (e) The workaround was reading `.git/squeal/runs/*/vitest.log` by hand. A later `why` succeeded, which matches E1's recovery once the lock is released. (f) The reports ask for a bounded retry, a diagnostic that names the retry path, and a contention regression for `why` and `status`.

### Q3. Decision filter (`docs/vision.md`)

*Inferred.*

1. **Faster, more relevant, more trustworthy feedback: yes.** A 1 s failure hides a stored red result exactly when the agent checks it.
2. **Less noise or blocking: yes,** if the retry is bounded. A CLI query is not a hook, and goal 6's 2 s hook budget does not bind it. `status --wait` already waits much longer. Retrying past one second can block the agent only up to the bound. The synthetic holds here lasted up to 2 s; how long production holds last is unknown.
3. **Provenance and uncertainty: neutral,** if a final failure still says "unavailable" and why. A stale answer must not pass as current.
4. **Across harnesses: neutral.** It is the CLI every adapter uses.
5. **Project policy: neutral.** It needs no policy.
6. **Push transitions, pull state: yes.** It is the pull path's availability.

Limit: a retry cannot help when the unknown holder keeps the lock longer than the bound. Naming that holder (Q1) stays separate work.

## Recommendation for Squeal

Treat issue 8 as a new row on the read path, separate from 001-422. The row would add a bounded retry for `why`, `status` and `failures` when the store is busy, and a final message that says how long it waited and names the retry (`squeal status --wait`). It would also add a regression that holds an exclusive lock (`locking_mode=EXCLUSIVE`, as `hold.mjs` does), since a normal writer never reproduces it. The issue asks for a `why` and `status` regression; the same test should cover `failures`. Separately, capture the holder during the next occurrence before claiming a cause. The bound is the spec's to decide.

## Open questions

- Who held cezar's store exclusively for more than 1 s on 2026-10-16 while daemons were live? Not determined: no capture exists. Candidates outside Squeal's code (a tool opening the file in exclusive mode) are unexamined.
- Why did `status` succeed more often than `why` in #1142? Not determined. The code path is shared, and the only lead is the call count.
- Is cezar's 90.6 MB WAL a high-water mark or live, un-backfilled frames? Not determined without opening the store. It sets what a last close or recovery would cost if every daemon stopped.

## Sources

- Issue #8 and its two comments: `gh issue view 8 --repo hearsay-tools/squeal --comments`, read 2026-10-16.
- SQLite, "Write-Ahead Logging", https://www.sqlite.org/wal.html, sections 1 and "Sometimes Queries Return SQLITE_BUSY In WAL Mode", fetched 2026-10-16.
- Source at `a5789453`: `src/core/status/open.ts`, `src/core/store/open.ts`, `src/core/store/connection.ts`, `src/core/status/why.ts`, `src/cli/main.ts:177`, `src/cli/status-wait.ts:160-330`, `src/core/daemon/lock.ts`, `src/core/daemon/daemon.ts:706`.
- `docs/board.md` rows 001-10, 001-207, 001-409, 001-411, 001-412, 001-422; `tasks/001-412/notes.md`; spec 001 D7, D8, D9 goal 6, D12; `docs/vision.md` decision filter.
- Probes and raw output: `probes/issue-8-contention/` (`results.txt`, E1 to E7).
