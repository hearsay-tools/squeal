# 005-110: why the tool-boundary hooks pass their 2 s limit in cezar

Researcher of row 005-110 (task cd01ba62), 2026-11-17, 19:46Z to 20:35Z. Brief: `boundary-hook-cost-brief.md`. Read: `docs/vision.md`, `docs/styleguide.md`, `session-start-cost.md` (005-101), `../../011-core/research/unlisted-after-start.md` (011-385, on `origin/main`). Source: main at `991aa1d60` (0.1.548) and tag `v0.1.546` (the field's release), both run from the scratch directory. Probes: `probes/boundary-hook-cost/` (throwaway, README there). An interim version of this file was committed at `6cf4e7781`.

**Method.** Store copies (`store`, `code`, `lint`) of cezar and squeal, taken 19:53Z with SQLite's backup API from read-only connections, every `daemon_socket` rewritten to a path that does not exist. `boundary.ts` runs the hook's own handler in-process on a copy, for a fake session id, with the common dir set to the copy; a guard refuses any SQLite statement outside the scratch directory. Subjects: cezar `d9416fae` (34,510 known states, 15,602 of them pending, 1,922 test files), squeal `d36c4d53` (17,539 states). "As a hook" adds the real bundle's Node start and load, 82 ms median, 93 ms p90 (`node-start.sh`, n=15). **Served** means `stub-daemon.ts` takes the writes: a socket in the scratch directory, the real `WriteDesk` and the real `writeBatch`, a set delay per batch, no tests. **Load**: the host's own, 1-minute load average 6 to 17 on 24 vCPUs, given per group. Every run falls inside the eval window another coordinator started at about 19:50Z; there is no run outside it to compare.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Budget by step | Ordinary cezar PostToolBatch as a hook: 0.69 s silent, 0.89 s with news on main (0.80 s and 1.04 s on 0.1.546); Stop 1.40 s (1.62 s, max 2.29 s). Nearly all of it is the delivery: known states read, the delta, the header's counts, complexity news. A held lock or lease: silent at 1.0 s | verified by experiment |
| 2 | The 9 to 11 s runs | The first delivery after the listing, sent to a serving daemon: a quadratic read path (5.4 s) and an 8 to 9 MB request line that misses its 1 s bound. Nothing is written, so every boundary repeats it. Not a lock wait, not a cold cache | verified by experiment (replay on a copy with a stub daemon); the match with the field inferred |
| 3 | Reads and 005-101's candidates | The texts need the states, the view, the code and lint news; Stop reads the states three times. Candidate 5 saves nothing at the boundary (no `counts` read); 6 saves under 1 ms; 8 at most the header's counts, 252 ms (PTB with news) and about 590 ms (Stop) | verified by experiment; candidate 8 inferred |
| 4 | A bound that says less | Possible between steps, each 0.3 s or less on a warm copy. The served quadratic loop and a cold read are not divisible. A bound alone ends no loop: the abandoned report stays owed. It frees the lease, which a kill keeps 5 s | verified by experiment (step sizes, lease); the design inferred |

## Field (transcripts since 2026-11-14)

Claude Code and Squawk record a hook only when it printed text or was cancelled, so the denominators come from the transcripts: tool batches (distinct assistant message ids with a tool use) and turns (`stop_reason` `end_turn`). The stretch is 011-385's: from the first "not listed" text to the first later Squeal text. *Verified by experiment* (`field-rate.py`, `field-split.py`).

| Task worktrees | cezar in stretch | cezar outside | squeal in stretch | squeal outside |
|---|---|---|---|---|
| PostToolBatch cancelled / tool batches | 6,128 / 8,036 (76%) | 1,965 / 9,622 (20%) | 1,043 / 2,698 (39%) | 291 / 12,547 (2.3%) |
| PostToolBatch completed with text, median / p90 ms | 506 / 1,605 | 1,133 / 1,827 | 188 / 1,038 | 665 / 1,385 |
| Stop cancelled / turns | 652 / 958 (68%) | 958 / 2,376 (40%) | 21 / 73 | 134 / 1,934 (7%) |

UserPromptSubmit: cancelled at 984 of 3,007 cezar prompts, 41 of 1,988 squeal. Task `d9416fae`: 37 of 37 PostToolBatch cancelled at 2,038 to 2,047 ms.

## 1. The budget

One run per process, untraced, versions interleaved (`series.sh`). Median / p90 ms in-process, before the 82 ms start.

| Hook, copy | main 0.1.548 | 0.1.546 | Load |
|---|---|---|---|
| cezar PostToolBatch with news (n=24) | 809 / 964 | 956 / 1,025 | 8.4 to 10.5 |
| cezar PostToolBatch silent (n=12) | 611 / 689 | 720 / 758 | 8.5 to 10.5 |
| cezar Stop silent (n=12) | 1,322 / 1,379 | 1,542 / 1,678 (max 2,207) | 8.4 to 10.3 |
| cezar UserPromptSubmit (n=5) | 512 to 561 | 630 to 682 | 8.6 to 9.0 |
| squeal PostToolBatch with news / silent; Stop | 358 / 379; 267; 501 | 399 / 420; 354; 591 | 8.2 to 8.9 |
| cezar, cold page cache (`evict.py`): PostToolBatch news; Stop | 1,175 to 1,292; 1,680, 1,869 | | 7.7 to 8.3 |
| cezar, write lock held by another process (n=12, PTB and Stop) | 1,017 to 1,023, silent, "database is locked" | | 9.2 to 10.4 |
| cezar, served, daemon writes each batch after 500 / 1,200 ms | silent 1,077 / error at 1,673; news +509 / +1,001 ms after the output | | 12.6 to 13.4 |
| **cezar first delivery after the listing, writing the store (n=4)** | **1,076 / 1,124** | **865 / 884** | 9.5 to 10.6 |
| **the same, served (22 runs)** | **8,271 to 12,225, all failed, nothing written** | **9,020 to 10,124, the same** | 9.1 to 16.8 |
| squeal first delivery, served (n=3) | 2,784 / 2,970 | 2,449 / 2,605 | 11.3 to 12.4 |

**PostToolBatch by step** (main, cezar, marks, load 9.5 to 11.2): open 3 to 5; `ensureIfStale` under 1; owed registration read under 1; `syncOnHeadMove` 1; **`onToolBoundary` 552 to 844**; `uncoveredEditLine` 1.4 to 3.8; format 2; output, hand-off commit, close 0.2 to 3.7. Inside `onToolBoundary` (trace, 3 CPU profiles, with news): known states with checks, 34,510 rows, 186 to 250 ms SQL plus about 50 ms decode; the live header's counts (`readLiveHeader`: `laneCounts`, `countSlowPending`, `countNotCurrent`, `testFileId`) 252 ms, only when news goes out; complexity news (`tellCode`: two code reads, each run three times) 155 ms SQL, 211 ms in all; the delta plan 121 ms, of which `markedView` 47 ms (main only); lint 9; test file keys 8; GC about 160. 0.1.546 also reads the full view (34,510 rows, 110 ms SQL); main reads its 22 non-pass rows (005-106): that is most of main's gain in every row above.

**Stop** lists all known states **three times** (103,530 rows, 578 ms SQL in one traced run) and the code reads three times: for its news (`newsText`), in `decide` (`readRequired`, `readHeader`, 381 ms), in `endTurn` (`plan`, 192 ms). So it costs twice a PostToolBatch. In Squawk, `stop-slow` and `waiter` add no store work: Claude Code runs unattended (`CLAUDE_CODE_ENTRYPOINT=sdk-cli`), so the waiter exits at once, and cezar's policy requires nothing at Stop. *Read in source code.*

**Writers.** Writing the store itself, a held lock costs the 1,000 ms busy timeout, then silence. Served, each batch waits for the daemon's main thread, up to the 1,000 ms bound (`boundMs`); with news the held batch is sent after the output and the process waits for it before it exits (`writeThenCommit` awaits `handOff.sent()`). Field, `d9416fae` window (19:31 to 19:47Z): all cezar daemons held the store 22.2% of the time (a random write waits a mean 125 ms, past 1 s at 2.9% of instants, 005-101's `lock-share.py`); that worktree's own daemon spent 66 s of 960 s in logged long writes. Code-store holds in 24 h: 706, median 1.5 s, p90 6.0 s; a hook waits up to 1 s for that lock before each hold (`codeLockFree`). *Verified by experiment (copies, logs).*

## 2. The 9 to 11 s runs

Replayed on the cezar copy (`first-results.mjs`): hide the worktree's states, register a fake consumer, restore the states (the insert trigger gives them birth marks above the registration's mark, as the daemon's first import did), then run PostToolBatch with the stub daemon serving. Every run took 8.3 to 12.2 s, failed with "no answer from <socket> in 1000 ms" and left the view empty; the next run repeated it (22 of 22 runs, both versions). The delivery writes one view row per state, 69,020 statements: an interned check (`ensureCheckId`) and a view row for each of the 34,510 states. *Verified by experiment.* From a CPU profile of a 9.2 s run and the stub's log:

1. **5.4 s, quadratic.** While a daemon serves, every `get` of the hook's `SendingConnection` builds `[...held, ...batch]` (`#pending()`, `src/core/delivery/sending-connection.ts:138` and `:256`) before `overlaidMeta` checks whether the read is a `meta` read at all; `findCheckId` makes one `get` per state while the batch grows. A scratch copy of main that builds the overlay only for a `meta` read (`src-lazy`, one line) cut the served first delivery to 1.79 s (cezar) and 0.85 s (squeal).
2. **The request line.** The batch goes as one line of about 9.4 MB. The stub had 7.6 to 9.4 MB of it when the hook's 1,000 ms bound (`REQUEST_TIMEOUT_MS`) passed; squeal's 5.2 MB line arrived in 310 to 334 ms. The real daemon reads its lines as the stub does (`buffer += chunk`, `indexOf("\n")`, `src/core/daemon/server.ts:108`). With the quadratic step gone, cezar's delivery still failed this way in 2 of 3 runs. A write the daemon never received is not written.
3. **The lease.** The failed hook's lease stays until its 5 s time (`LEASE_TTL_MS`). Killing a served hook's node process while it held the lease: the next hook failed at 963 ms ("lease is held by <dead pid>") at gaps of 0 and 2 s, and ran at 4 and 7 s, delivering the killed hook's news. *Verified by experiment.*

Writing the store itself, the same delivery takes 0.87 to 1.12 s: the view write adds about 300 ms. This is the loop of 011-385 (5,661 of 5,662 cezar hooks after the listing timed out), and its open question 1 is answered: with a serving daemon the owed view write is about 90% of the hook's time (8.3 to 9.5 s of which about 1 s is the ordinary delivery); without one, about 30%. The served run matches the brief's hand runs (8.8 to 11.6 s); the two 1.1 s silent hand runs fit a lease left by the session's own killed hooks. *The match inferred: the hand runs ran on the live store without a trace.* Outside the stretch, cezar still loses 20% of its boundaries and 40% of its Stops: on the copies an ordinary hook needs 0.7 to 1.6 s as a hook, so the rest is the tail added by a busy daemon (up to 1 s per batch), a lease after a kill (1 s, then silence), a cold page cache (0.4 to 0.6 s) and load spikes (busy CPUs 7 to 22 in the window). Their shares are not determined.

## 3. What the texts read, and 005-101's candidates

| Read at a boundary (cezar, main) | Cost | Needed by |
|---|---|---|
| Known states with checks | 186 to 250 ms SQL, about 50 ms decode; Stop three times | the delta, the header; Stop's news, decision and turn end |
| Header counts | 252 ms (PTB with news); Stop 381 + 210 ms | the header lines of a text that speaks |
| Code: failing and edited states, each three times | 23 to 29 ms each, 155 ms SQL | complexity news. The planner scans the worktree's 260,000 code states by primary key. Forced partial indexes with plain predicates: 28.7 to 3.1 ms and 24.9 to 0.05 ms (cezar), 9 to 2.1 and 9.4 to 0.9 ms (squeal), `code-reads.mjs` |
| View, lint, keys, file hashes, meta (82 reads) | 22 rows (main); 9, 8, 5, 3 ms | the delta and the news |

005-101's **candidate 5** (index on code `counts`): no `counts` read in any traced boundary; it saves nothing here. **Candidate 6** (partial index on open runs): the boundary's runs reads took 0.1 ms; nothing to save. **Candidate 8** (a daemon-kept summary row): it could replace the header counts, 252 ms per PTB with news and about 590 ms per Stop, but not the states read the delta needs. *Inferred from profiles; write cost not determined.* R2's cheap read (`r2-read.ts`): the listed count 0.2 ms, the key rows 3.3 ms; "X of Y test files are current" needs the states and costs 228 ms (cezar) and 105 ms (squeal).

## 4. A bound that says less

A hook spends about 90 ms before its delivery; the delivery's synchronous steps each take 0.3 s or less on a warm copy (states 0.25 to 0.3, header 0.25, code news 0.21, plan 0.12). A deadline read from the process start and checked between them would end within about 0.3 s of the chosen limit. Two steps cannot be cut: the served quadratic loop (5.4 s in one loop) and a cold read (+0.4 to 0.6 s). A bounded hook that abandons its report says the same as a killed one, nothing, and the report stays owed (row 011-288), so an owed delivery repeats unless it gets smaller (R1). What the bound gains: the lease and the lock end at its exit instead of 5 s after a kill (measured above), no "cancelled" record with exit 1, and room for R2's short text. *Step sizes and the lease verified by experiment; the design inferred.*

## Candidate rows, ranked by measured gain per cost

| # | Change | Gain, measured on copies | Cost | Owner | Outside Squawk |
|---|---|---|---|---|---|
| 1 | Build the pending overlay only for a `meta` read (`SendingConnection.get`) | Served first delivery 8.3 to 9.5 s to 1.79 s (cezar), 2.4 to 3.0 s to 0.85 s (squeal); any served delivery that writes many rows | one line | 005 (delivery, spec 021 D15 code) | Every session whose daemon serves |
| 2 | R1: the owed first delivery seeds the view as 005-106's registration does (rows not `pass`, a new mark) | A registration at that moment: 0.60 to 0.62 s (cezar), 0.22 to 0.34 s (squeal), served; the next boundaries 0.52 to 0.59 s. The batch shrinks from 69,020 statements, so the 9 MB line goes; ends the loop | the delivery path; an inherited failure must not read as a told pass (011-385) | 005 | Every session that starts before the listing: new worktrees, first starts |
| 3 | Stop lists the states once (and the code reads once) | Two of three state lists: about 2 x 0.25 s SQL and decode, plus `endTurn`'s plan 0.19 s; Stop 1.32 s to about 0.8 s (inferred from the trace and profiles). Field: 40% of cezar turns outside stretches end with a cancelled Stop | a reorder of `stopTurn`, reads inside its writes | 005 | Every Stop, every harness |
| 4 | A dead hook's lease ends at once (the desk asks `leaseProcessAlive` when it refuses a lease) | The next hook within 5 s runs instead of failing at 963 ms | a check in `WriteDesk.#current` | 011 (daemon) | Every served worktree |
| 5 | The two code reads once per hook, with partial indexes and plain predicates | About 145 ms per cezar boundary, 50 ms squeal | a code-store migration and query change (`INDEXED BY` or no `? IS NULL OR`) | 011 (code store, spec 015) | Repositories with complexity on |
| 6 | A deadline between delivery steps; abandon and exit 0 before 2 s | No time saved; frees the lease and lock; no kill record | deadline checks in `deliver` and `stopTurn` | 005 | Every harness with a hook timeout |
| 7 | R2: near the budget, say the listed counts once | Read 0.2 to 3.3 ms (listed count, keys), 228 ms with "current"; ends a stretch at the first boundary after the listing only if its told mark commits (a write: lock or lease, up to 1 s) | a second text path; product-facing wording | 005 | Sessions that start before the listing |
| 8 | 005-101's summary row | Header counts: 252 ms (PTB with news), about 590 ms (Stop), inferred | a write in each state commit, a second record of a fact | 011 | Every delivery |
| 9 | 005-101's candidates 5 and 6 | none at the boundary | | 011 | |

Rows 1 and 2 remove the 9 to 11 s runs and the loop; row 1 alone is not enough for cezar (the line, section 2). Rows 3 and 5 together would bring an ordinary cezar Stop near 0.7 s and a PostToolBatch with news near 0.75 s as a hook. *Inferred: the sum was not measured in one build.*

## Open questions

1. The real daemon's receive time for an 8 to 9 MB line, in its socket worker at the field's load: not determined; only the stub was measured, with the same framing.
2. The split of the 20% (PTB) and 40% (Stop) cancellations outside the stretch among daemon write waits, leases after kills, cold pages and load: not determined, because killed hooks leave no trace and silent hooks no record.
3. Interactive sessions, where the waiter polls the store beside Stop and UserPromptSubmit, and Codex hooks: not measured.
4. The replay keeps the worktree's key rows, so the registration was listed: it replays the view write, not the owed counts text of a rowless registration.
5. All runs fall inside the eval window from 19:50Z (load 6 to 17); no comparison outside it.

## Sources

- Claude Code transcripts `~/.claude/projects/-<home>-projects-{cezar,squeal}--ai-squawk-worktrees-*/*.jsonl` since 2026-11-14 (hook attachments: `durationMs`, `timedOut`); Squawk run logs `~/projects/cezar/.ai/squawk/runs/d9416fae-*.ndjson`; daemon logs `~/projects/cezar/.git/squeal/logs/` (`daemon-04f207907ed953d6.log` for `d9416fae`).
- Store copies of `~/projects/{cezar,squeal}/.git/squeal/{store,code,lint}.sqlite`, 19:53Z; live residency read with `mincore` only: cezar store 29%, code 59%, lint 13%; squeal store 81%, code 99%.
- Source at `991aa1d60` and `v0.1.546`: `src/harness/claude-code/hooks/{post-tool-batch,stop,user-prompt-submit,stop-slow,waiter}.ts`, `main.ts`, `run.ts`; `src/harness/shared/{deliver,hook,context,stop,stop-slow,ensure,hand-off,owed}.ts`; `src/core/delivery/{delivery,sending-connection,sent-meta,sent-store,daemon-writer,code-source,view-mark}.ts`; `src/core/daemon/{write-desk,write-batch,server,protocol,daemon}.ts`; `src/core/store/{state-born,write-markers,store}.ts`; `src/core/code/store/states.ts`; `src/core/state/{file-class,header-part,slow}.ts`; `plugins/claude-code/hooks/hooks.json`.
- Earlier findings: `session-start-cost.md` (005-101); `../../011-core/research/unlisted-after-start.md` (011-385).
