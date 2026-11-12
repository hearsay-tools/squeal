# 011-313: what a daemon does with a core while no test runs

Researcher (W1 of wave 74), 2026-11-12. Brief: `../tasks/wave-74.md`, section W1. Host: 24 vCPUs, Linux 6.8.0-147, Node v26.13.0. Squeal 0.1.443, the installed plugin bundle `~/.claude/plugins/cache/hearsay/squeal/0.1.443/dist/cli/squeal.mjs`. The worktree source at `ecf2d8bfb` matches 0.1.443 in every file named here. All times are UTC. The host clock is CET (UTC+1). Probes: `probes/daemon-idle-cpu/` (throwaway, README there). Profiles and store copies stayed in the task's scratch directory and are deleted, except the profile files, which the scratch directory keeps until the task ends.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | What the main thread does with a core while no test process runs | It parses a long protocol line from its runner host. In a live daemon at 1.0 core with a pending fast tier and no test process, **98.9% of 25,037 samples** were self time in `LineReader.push` (`src/core/runner-host/protocol.ts`, bundle line 60702). Each call joins the unfinished line with the new chunk and splits the whole buffer again, so one line of N bytes costs O(N²). The tier cannot end until the line is read, so the daemon shows "fast tier" with no test process for many minutes. | verified by experiment (profile, /proc, `ss`), cost model verified by experiment (bench) |
| 2 | Which database and code path make the 4 KB reads | Mostly not the daemon's main thread. `/proc/<pid>/io` adds the I/O of children the process has reaped. The daily full `integrity_check` runs in such a child: on a copy of cezar's 3.9 GB store it made **11.4 M reads of 4,094 B (46.6 GB)** in 124 s. On the main thread, `store.sqlite` is read by the startup `quick_check` (8.0 GB, 2.0 M reads before the daemon served) and by the hourly prune; `code.sqlite` by the hourly code-store prune (3.65 GB, 0.89 M reads). The hot daemons of question 1 read under 1 MB/s. | verified by experiment |
| 3 | No session, and a session with no test | Neither shows the 1-core cost. An idle daemon spends 11 to 20% of its main thread in its first 2 minutes (the first prune, 60 s after start), then 0.6 to 2%. The 1-core cost needs a tier whose host sends a long line; a session is not a factor. | verified by experiment |
| 4 | Host load during each measurement | Load average 7.6 to 29.4 from other sessions; one sample at 12.2 busy CPUs with Squeal at 79% of them. Per measurement below. | verified by experiment |
| 5 | A fix | Warranted: make the line reader linear (proposed row A). Two smaller rows are optional (B, C). | inferred |

## 1. The main thread at one core: `LineReader.push`

**The live daemons.** At 08:57:34 seven squeal-project daemons ran at about 1.0 core each, and `squeal ps` counted 0 test processes on the host. `ps` at 08:59:20 (load 16.3; Squeal 9.6 CPUs, 79% of busy; CPU pressure 4.9%; swap 4.0 of 4.0 GiB):

| PID | Worktree key | Up | CPU time | Work |
|---|---|---|---|---|
| 3490609 | 5fe44ca7 | 18 min | 13m14s | fast tier, 4 files; 394 pending; 1 session |
| 3492153 | dabd2fa9 | 18 min | 18m21s | fast tier, 200 files; 758 pending; 1 session |
| 3479655 | 9a7f9813 | 21 min | 21m17s | fast tier, 4 files; 942 pending; 1 session |
| 3526371 | b503aa3c | 14 min | 5m57s | fast tier, 4 files; 1,243 pending; 1 session |
| 3525757 | c65e240f | 14 min | 6m59s | fast tier, 4 files; 734 pending; 1 session |
| 3513445 | d5b258aa | 15 min | 11m12s | fast tier, 4 files; 354 pending; 1 session |
| 3500180 | 39e70d90 | 17 min | 14m49s | fast tier, 4 files; 178 pending; 1 session |

Per thread over 20 s (`threads.py`, 08:57:34, load 17.6): the main thread used 0.997 to 1.000 core in every one; the V8 GC helpers together 0.04 to 0.11 core. The process read 40 to 230 times a second (under 1 MB/s) and wrote about 3 KB/s. So the core goes to JavaScript, not to SQLite and not to GC. *Verified by experiment.*

**The profile.** The coordinator allowed one profile of one daemon. PID 3492153 (worktree `3739e45a`), 08:59:32 to 09:00:04, load 15.5 to 14.3. Port 9229 was free first. One `SIGUSR1` opened Node's inspector on 127.0.0.1:9229; `cdp-profile-strict.mjs` used only `Profiler.enable`, `Profiler.start` and `Profiler.stop`, then disconnected. The daemon kept running. **Its inspector port stays open on 127.0.0.1:9229 until that daemon exits.** Result, 25,037 samples over 30.7 s:

| Self time | Function |
|---|---|
| 98.9% | `push`, bundle line 60702 = `LineReader.push`, `src/core/runner-host/protocol.ts` |
| 0.7% | (garbage collector) |
| under 0.1% each | the heartbeat, `exec`, file reads, the rest |

Inclusive, the 98.9% is `onStreamRead` → `Readable.push` → `emit` → the `data` handler of `HostConnection` (`src/core/runner-host/connection.ts`) → `LineReader.push`. *Verified by experiment.*

**The code.** *Read in source code.*

```ts
push(chunk: string): HostMessage[] {
  const text = this.#rest + chunk;
  const lines = text.split("\n");
  this.#rest = lines.pop() ?? "";
  ...
```

Each chunk re-reads every byte of the unfinished line. A line of N bytes in chunks of c bytes costs about N²/2c byte scans.

**The bench** (`line-reader-bench.ts`, the real `LineReader`, one line of `x` characters; 09:00:49 to 09:01:06, load 13.8 to 15.2). *Verified by experiment.*

| Line | 64 KB chunks | 4 KB chunks |
|---|---|---|
| 1 MB | 9 ms | 111 ms |
| 2 MB | 22 ms | 452 ms |
| 4 MB | 107 ms | 2,010 ms |
| 8 MB | 671 ms | – |
| 16 MB | 3,032 ms | – |
| 32 MB | 10,414 ms | – |

From 4 MB up, each doubling costs 3.4 to 6.3 times more. At this rate a 128 MB line in 64 KB chunks needs about 160 s, and a 64 MB line in 4 KB chunks about 8 minutes. *Inferred from the bench.*

**The backpressure.** `ss -x` on the socket pair between 3492153 and its Vitest host 3492298, 09:01:57 to 09:02:09: the daemon's receive queue rose 15,104 → 80,640 → 146,176 B in steps of 65,536 B about every 3 s, then fell back. The host's send queue held 37,120 to 148,480 B. The host slept in `ep_poll` (6,216 → 6,222 CPU ticks in 12 s). So the host waits to write, and the daemon takes in only about 20 to 45 KB/s while it uses a full core. At the same time the hosts of 3490609, 3479655 and 3513445 had a full send queue (148,480 B), 3526371's held 111,360 B; 3500180's and 3525757's were empty (3525757 had left its tier, at 7% CPU). *Verified by experiment.*

**Which line.** The host's `coverage` event (`src/core/runner-host/host.ts:141`) sends one run's coverage as one line: `encodeCoverageRun` puts every executed project source once, and an `ExecutedSource` carries the file's transformed `code` and its source `map` (`src/core/code/coverage/types.ts:39`). Squeal's non-test source is 6.6 MB in 1,031 files, before maps, JSON escaping and the test files. So one tier's line can be tens of MB. Coverage is on by default. The runner host and this reader arrived in 0.1.436 (commit `7f50b2d8d`, 2026-11-11), the day before the overnight report. *Inferred*: the profile does not show the line's content, and the line's length is not determined, because the allowed CDP domains do not read the heap.

## 2. The 4 KB reads

The overnight report's lead: cezar daemon `8c09c4da` showed 337.7 GB in 82.9 M reads after 840 CPU seconds in 51 min. Three facts change that reading.

1. **`/proc/<pid>/io` counts reaped children.** In my daemon on a cezar copy, the 100 s window of the full check showed 51.3 GB and 12.5 M reads for the process, but 4.56 GB and 1.12 M reads for all its live threads together. The other 46.7 GB match the full-check child (next item). Linux adds a child's I/O to its parent when it reaps it. *The match is verified by experiment; the kernel rule is inferred (I did not fetch the kernel source).*
2. **The daily full check** (`src/core/daemon/full-check.ts`: `PRAGMA integrity_check(10)` in a child at nice 10, at most once per store in 24 h). On a copy of cezar's store (`integrity-io.sh`, 08:54:46 to 08:56:50, load 12.8 to 20.8): 124 s wall, 65 s CPU (27 s user, 39 s system), **11,382,459 reads of 4,094 B = 46.6 GB**, 5.4 GB from disk. *Verified by experiment.* A check that a daemon's exit stops restores the claim, so the next daemon runs it again (`full-check.ts` lines 59 to 72). *Read in source code.*
3. **Main-thread reads of `store.sqlite` and `code.sqlite`** happen at start and once an hour; the connections set no `cache_size` and no `mmap_size` (`src/core/store/open.ts`, `src/core/code/store/open.ts`), so SQLite keeps its default 2 MB cache and reads each page with its own 4 KB call. *Read in source code.* Measured on copies of cezar's stores (`prune-probe.ts`, 08:47:14 to 08:48:08, load 18.4 to 16.3):

| Step | When | Wall | CPU | Reads | Bytes |
|---|---|---|---|---|---|
| Start, `quick_check` and the rest until serving (`store.sqlite`) | each start | 70 s | 25 s | 2.0 M | 8.0 GB |
| Main-store prune, first pass | 60 s after start, then hourly | 12.4 s | 4.4 s | 0.29 M | 1.18 GB |
| Main-store prune, second pass | | 1.4 s | 1.4 s | 0.20 M | 0.80 GB |
| Code-store prune (`pruneCodeStoreAfter`) | after each main-store prune | 34.9 s | 12.0 s | 0.89 M | 3.65 GB |
| of it: `keysSince(0)`, every result key of `store.sqlite` | | 23.6 s | 7.4 s | 0.40 M | 1.65 GB |

All at 4,088 to 4,096 B a read. *Verified by experiment.*

Also large: cezar's `meta` holds `unknown-runs` at 52.5 MB and three `unknown-files:<worktree>` values at 12.7 to 22.0 MB. The prune's 9 `meta` reads cost 39,000 page reads. No idle timer reads these keys; status, retry and the scheduler do. *Verified by experiment (sizes), read in source code (readers).*

**What stays open.** These cover about 60 GB a daemon a day (one full check, one start, a prune an hour). The overnight 337.7 GB in 51 min is not explained by them. The rest is, by item 1, likely reaped test hosts and their workers, but that is *not determined*, because the raw samples were deleted and the overnight sampler did not record children's exits. The main thread's 4 KB reads are not why a daemon sits at one core.

## 3. With no session, and with a session but no test

| Daemon | State | Window (load) | Main thread busy | Top work |
|---|---|---|---|---|
| Mine, squeal worktree, store 0.95 GB | 1 session (mine), no test | 08:43:49 to 08:44:49 (7.6 → 29.4) | 11.0% of 49,158 samples | `pruneCodeStoreAfter` 6.3% incl. (`deleteInBatches` 4.0%, `keysSince` 1.5%), GC 1.5% |
| same | same, after the prune | 08:45:18, 20 s (27.2) | 0.019 core | – |
| Mine, cezar clone with store copies | no session, no test | 08:50:47 to 08:52:27 (18.0 → 15.6) | 19.7% of 89,566 | `pruneCodeStoreAfter` 16.6% incl., `keysSince` 3.4%; full-check child 46.7 GB |
| same | same | 08:52:28 to 08:54:09 (15.6 → 13.6) | 0.6% of 88,731 | watcher `lstat`, `git` calls |

*Verified by experiment.* The clone had no `node_modules`, so it listed no tests; that leaves out work that grows with a worktree's test files. The 1-core state of section 1 needs a tier, and all seven daemons there had a session.

## Recommendation

Fix the reader first. It alone explains a daemon at one core with a pending tier and no test process, and it holds that tier's tests back. It also feeds itself: a busy host makes each daemon slower to drain, and seven such daemons used 7 cores. The two prune costs are bounded (about 50 s an hour a daemon on cezar). The 4 KB-read lead of the overnight report reads the children's I/O as the daemon's.

### Proposed row A (warranted)

**Make the runner-host line reader linear.** `LineReader` keeps an unfinished line's chunks and searches only each new chunk for `\n`, so a line costs O(N). Optional, for the spec to weigh: send a coverage run's `code` and `map` by file, as the in-process path already sends `payload`, so the socket line stays small.

Done when: `line-reader-bench.ts` parses a 32 MB line in 64 KB chunks and a 4 MB line in 4 KB chunks each in under 0.5 s (now 10.4 s and 2.0 s); a unit test feeds a 16 MB line in 4 KB chunks and checks that it parses as one message; and a live daemon whose Vitest tier of at least 100 files records coverage leaves no unread bytes in its host's send queue (`ss -x`) when the tier ends and does not hold its main thread at one core for more than a minute.

### Proposed row B (optional, small)

**The code-store prune reads every result key from scratch.** `pruneCodeStoreAfter` calls `results.keysSince(0)`: 23.6 s and 1.65 GB of 4 KB reads an hour in each cezar daemon. Done when: on a copy of cezar's store, the code-store prune takes under 5 s and still keeps a coverage record whose key has a result.

### Proposed row C (docs only)

**The host-load runbook counts reaped children's I/O as the daemon's.** Add to `probes/host-load/README.md` that `/proc/<pid>/io` includes reaped children, and read per-thread I/O (`/proc/<pid>/task/<tid>/io`) for a daemon's own reads.

## Open questions

- The length of the line in the live daemon. A heap read needs a CDP domain the profile permission did not cover.
- Whether the four 4-file tiers above had long lines too. They showed the same /proc and `ss` signature, but only 3492153 was profiled.
- What made the rest of the overnight 337.7 GB (section 2, "What stays open").
- Side finding: `squeal ps` lists an `hsq job` supervisor whose command line names `squeal.mjs daemon <root>` as a daemon "waiting for its lock" and prints `ends it: kill <pid>` for it (seen for PIDs 3509090 and 3641565). Killing it would end the job's real daemon.

## Sources

- Board row 011-313 (`docs/board.md`); the overnight report of task 69b56ae6, `.ai/cezar/runs/69b56ae6-…-artifacts/633c4930-…/content`; `probes/host-load/README.md`.
- Source at `ecf2d8bfb` (= 0.1.443): `src/core/runner-host/protocol.ts` (`LineReader`), `src/core/runner-host/connection.ts`, `src/core/runner-host/host.ts:141`, `src/core/runner-host/coverage-wire.ts`, `src/core/code/coverage/types.ts`, `src/core/daemon/lifecycle.ts` (`startTimers`: heartbeat 5 s, presence 250 ms, prune 60 min, first prune 60 s), `src/core/daemon/full-check.ts`, `src/core/daemon/open.ts`, `src/core/store/open.ts`, `src/core/store/prune.ts`, `src/core/code/store/prune.ts`, `src/core/code/store/prune-main.ts`, `src/core/store/repos/results.ts` (`KEYS_SINCE`), `src/core/store/repos/unknown-runs.ts`.
- Bundle: `~/.claude/plugins/cache/hearsay/squeal/0.1.443/dist/cli/squeal.mjs`, lines 60680 to 60760.
- Probes: `probes/daemon-idle-cpu/threads.py`, `cdp-profile.mjs`, `cdp-profile-strict.mjs`, `summarize.mjs`, `prune-probe.ts`, `integrity-io.sh`, `line-reader-bench.ts`.
