# 005-110: why the tool-boundary hooks pass their 2 s limit in cezar

**Interim, 2026-11-17 20:20Z.** Budget table and the cause of the slow runs are measured; questions 3 and 4, R1/R2 and the ranked rows follow in the final version of this file.

Researcher of row 005-110 (task cd01ba62), 2026-11-17 from 19:46Z. Brief: `boundary-hook-cost-brief.md`. Read: `docs/vision.md`, `docs/styleguide.md`, `session-start-cost.md` (005-101), `../../011-core/research/unlisted-after-start.md` (011-385, on `origin/main`). Source: main at `991aa1d60` (0.1.548) and tag `v0.1.546` (the field's release), extracted to the scratch directory. Probes: `probes/boundary-hook-cost/` (throwaway, README there).

**Method.** Store copies (`store`, `code`, `lint`) of cezar and squeal, taken 19:53Z with SQLite's backup API from read-only connections; every `daemon_socket` rewritten to a path that does not exist. `boundary.ts` runs the hook's own handler in-process on a copy, for a fake session id, with the location's common dir set to the copy; a guard refuses any SQLite statement on a path outside the scratch directory. Subjects: cezar `d9416fae` (34,510 known states, 1,922 test files, 15,602 states pending), squeal `d36c4d53` (17,539 states). "As a hook" adds the real bundle's Node start and load: 82 ms median, 93 ms p90 (`node-start.sh`, n=15). **A served daemon** is `stub-daemon.ts`: a socket in the scratch directory with the real `WriteDesk` and the real `writeBatch`, which writes each batch into the copy after a set delay; it runs no tests. **Load**: the host's own, 1-minute load average 8 to 17 on 24 vCPUs, stated per group. Every run falls inside the eval window that another coordinator started at about 19:50Z; no run outside it exists to compare.

## Field (transcripts since 2026-11-14, `field-hooks.py`, `field-rate.py`)

Claude Code records a hook only when it printed text or was cancelled; Squawk's run logs likewise. So the denominator is counted from the transcripts: tool batches (distinct assistant message ids with a tool use) and human prompts. *Verified by experiment.*

| Task worktrees | cezar | squeal |
|---|---|---|
| PostToolBatch cancelled / tool batches | 8,068 / 17,617 (46%) | 1,337 / 15,466 (8.6%) |
| PostToolBatch completed with text: median / p90 ms | 1,104 / 1,818 (n=809) | 659 / 1,362 (n=1,027) |
| Stop cancelled / recorded | 1,602 / 1,614 | 173 / 174 |
| UserPromptSubmit cancelled / prompts | 984 / 3,007 (33%) | 41 / 1,988 (2%) |
| Task `d9416fae` (0.1.546) | 37 of 37 PostToolBatch, 1 Stop, 1 UserPromptSubmit cancelled, each at 2,038 to 2,047 ms | |

## 1. The budget

Fresh process per run, untraced, versions interleaved (`series.sh`). Median / p90 ms in-process; add 82 / 93 ms for Node start and bundle load.

| Hook, store copy | main 0.1.548 | 0.1.546 | Load |
|---|---|---|---|
| cezar PostToolBatch with news (n=24) | 809 / 964 | 956 / 1,025 | 8.4 to 10.5 |
| cezar PostToolBatch silent (n=12) | 611 / 689 | 720 / 758 | 8.5 to 10.5 |
| cezar Stop silent (n=12) | 1,322 / 1,379 | 1,542 / 1,678 (max 2,207) | 8.4 to 10.3 |
| squeal PostToolBatch with news (n=12) | 358 / 379 | 399 / 420 | 8.2 to 8.9 |
| squeal PostToolBatch silent (n=6) | 267 / 281 | 354 / 399 | 8.2 to 8.9 |
| squeal Stop silent (n=6) | 501 / 510 | 591 / 733 | 8.3 to 8.9 |
| cezar PostToolBatch, cold page cache (copy evicted, `evict.py`), news | 1,175 to 1,292 (n=3) | | 7.7 to 8.3 |
| cezar Stop, cold page cache | 1,680, 1,869 | | 7.8 to 8.1 |
| **cezar first delivery after the listing, writing the store (`first-series.sh`, n=4)** | **1,076 / 1,124** | **865 / 884** | 9.5 to 10.6 |
| **the same, writes sent to a served daemon (n=3 + 8 earlier)** | **8,271 to 9,480, every run failed, nothing written** | **9,020 to 10,124, the same** | 9.1 to 16.8 |
| squeal first delivery, served daemon (n=3) | 2,784 / 2,970 (completes) | 2,449 / 2,605 (completes) | 11.3 to 12.4 |

PostToolBatch by step (main, cezar, `MARKS=1`, load 9.5 to 11.2): store open 3 to 5 ms; `ensureIfStale` under 1 ms; owed registration read under 1 ms; `syncOnHeadMove` 1 ms; **`onToolBoundary` 552 to 844 ms**; `uncoveredEditLine` 1.4 to 3.8 ms; format 2 ms; output, hand-off commit and close 0.2 to 3.7 ms. Inside `onToolBoundary` (statement trace and 3 CPU profiles, news): known states with their checks, 34,510 rows, 186 to 250 ms of SQL and about 50 ms decode; the live header's counts (`readLiveHeader`: `laneCounts`, `countSlowPending`, `countNotCurrent`, `testFileId`) 252 ms, read only when news goes out; complexity news (`tellCode`), three code-store reads twice each, 155 ms SQL, 211 ms in all; the delta plan 121 ms, of it `markedView` 47 ms (main only); lint 9 ms; test file keys 8 ms; GC about 160 ms.

Stop (main, cezar, trace and 3 profiles): it lists all known states **three times** (103,530 rows, 578 ms of SQL in a traced run) and each code-store read three times: once for its news (`newsText`, a `stop` delivery), once in `decide` (`readRequired`, `readHeader`, 381 ms), once in `endTurn` (`plan`, 192 ms). That is why it costs about twice a PostToolBatch.

**With a writer.** Writing the store itself, a write that finds the lock held waits the 1,000 ms busy timeout. Through a served daemon (`stub-daemon.ts` `DELAY`): each batch's write time is added to the hook, up to the 1,000 ms bound (`boundMs`), then the hook fails with "database is locked: the daemon has not written this batch yet". Silent PostToolBatch: 1,077 ms at a 500 ms delay, error at 1,673 ms at 1,200 ms. With news, the held batch is sent after the output, and the process waits for it before it exits: +509 ms at 500, +1,001 ms at 1,200 (`writeThenCommit` awaits `handOff.sent()`). *Verified by experiment.* Field lock share in the `d9416fae` window (19:31 to 19:47Z, all cezar daemons' logged long writes, `lock-share.py` of 005-101): 22.2%, a random write waits a mean 125 ms and past 1 s at 2.9% of instants. Code-store holds (24 h): 706, median 1.5 s, p90 6.0 s; the hook waits up to 1 s for that lock before each hold (`codeLockFree`).

## 2. What makes a run take 9 to 11 s

**The first delivery after the listing, sent to a serving daemon.** Replayed on the cezar copy (`first-results.mjs`): hide the worktree's states, register a fake consumer, put the states back (the insert trigger gives them birth marks above the registration's mark, as the daemon's first import did), then run PostToolBatch with the stub daemon serving. Every run took 8.3 to 12.2 s and failed with "no answer from <socket> in 1000 ms"; the consumer's view stayed empty, so the next run repeated it (8 of 8 runs in two sessions, 6 more in the series). Both versions. *Verified by experiment.* The parts, from a CPU profile of a 9.2 s run and the stub's log:

1. **5.4 s: a quadratic read path.** The delivery writes one view row per state (34,510) and interns each check first (`ensureCheckId`, `findCheckId`: a `get` per state). While a daemon serves, every `get` of the hook's `SendingConnection` builds `[...held, ...batch]` (`#pending()`, `src/core/delivery/sending-connection.ts:138` and `:256`) before `overlaidMeta` checks whether the read is a `meta` read at all. The batch grows with each state, so the copies grow with the square of the states.
2. **About 1 s and then the bound: an 8 to 9 MB request line.** The batch, 69,020 statements, goes to the daemon as one line. The stub had 7.6 to 9.4 MB of it (119 to 146 chunks) when the hook's 1,000 ms request bound (`REQUEST_TIMEOUT_MS`) passed and it closed the socket. The real daemon reads its socket lines the same way as the stub (`buffer += chunk`, `indexOf("\n")`, `src/core/daemon/server.ts:108`), with a 32 MiB limit for write lines. A write the daemon never received is never written: the next boundary does the same work.
3. The rest: the delivery's ordinary work, about 1 s.

Writing the store itself (no daemon serving) the same delivery takes 0.87 to 1.12 s on the copy: the extra view write is about 300 ms in cezar. With squeal's 17,539 states a served first delivery completes in 2.4 to 3.0 s, still past Claude Code's 2 s, so it is killed and repeated until one run fits. This is the loop 011-385 describes (5,661 of 5,662 cezar hooks after the listing timed out); it matches the hand runs of the brief (8.8 to 11.6 s with text): **a lock wait, a cold cache and the ordinary work do not explain them; the served first delivery does.** *The match with the hand runs inferred: they ran on the live store with no trace.*

**The ordinary boundary.** On the warm copies at load 8 to 10.5 an ordinary cezar PostToolBatch takes 0.69 to 1.05 s as a hook and Stop 1.40 s on main (1.62 s, p90 1.77 s on 0.1.546); the field's completed PostToolBatch runs have a median of 1.10 s (p90 1.82 s). What adds the field's tail past 2 s outside the stretch is still being measured: a busy daemon's write (up to +1 s per batch), a cold page cache (+0.4 to 0.6 s), and load.

## Next in this file

Questions 3 and 4; R1 and R2 of 011-385 measured on the copies; the cost of an ordinary Stop and of UserPromptSubmit split by step on 0.1.546; candidate rows ranked by measured gain per cost; open questions; sources.
