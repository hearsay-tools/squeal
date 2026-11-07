# Wait timeouts: why `squeal status --wait 60000 <file>...` reaches its limit when the host is busy

Researcher task 33e995c3, 2026-11-07. Follows finding 4 of `load-slowdown.md`. Data: agent transcripts from 2026-10-29 23:00Z to 2026-11-07 08:20Z (Claude top-level sessions and Codex sessions, as `probes/load-slowdown/squeal-waits.py` reads them), with each wait's full printed output. Also the five project stores, copied with `-wal` and `-shm` at 2026-11-07 09:56Z and read with `node:sqlite` read-only, and sar `-u` samples. Source read at `d81f5c14e` (origin/main). The Squeal versions in use in the window ran from 0.1.378 to 0.1.412. This session's daemon was stopped, and its worktree is outside the window. No test, build or load was started. The scripts are in `probes/wait-timeouts/`.

**Verdict.** When the host is busy, the named test files mostly wait in line. They do not wait in a slow run of their own. Above 16 busy vCPUs, a named wait lasts 19.4 s longer on average than at 0–6 busy. 52% of those extra seconds pass with no test running in that worktree at all, and 41% pass while other tests run ahead of the named files. Only 7% pass while the named files' own run is in progress. The largest single path is the wait's own promotion. Squeal moves the named files into a "batch" tier, and that tier asks for a pool permit that the CPU gate refuses while the host is busy. An edit tier never asks for a permit. Edit rate does not explain the load effect: at equal edit rates, the timeout share still rises from 5–17% at 0–6 busy to 43–62% at 20–24 busy.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | What the timed-out waits said | 607 waits printed "the deadline passed". Primary state: queued behind another tier 25%, own tier still running 22%, promoted with no tier ahead 13%, revision not listed 12%, daemon not serving 9%, catch-up quiet 8%, other 11%. At 16 busy and above, 25% of them also reported a stale daemon heartbeat | verified by experiment |
| 2 | Code path and its design bound per class | See the table under Q2. Three paths have no upper bound: the permit wait of a promoted batch, a tier ahead that does not yield (it runs to its end), and listing behind the run in flight (666 s per runner call) | read in source code |
| 3 | Where the seconds went | 382 timed-out waits rebuilt from run rows: no run in the worktree 51%, only other runs 32%, a run that holds a named file 16%. The first run that holds a named file started a median 56 s after the wait began | verified by experiment |
| 4 | Load or more edits | Load. Standardising to one edit-rate mix changes the timeout share per band by at most 1.3 points. At 16 busy and above, the extra wait is 52% no run, 41% other tiers ahead and 7% slower own runs | verified by experiment (shares); inferred (cause) |
| 5 | Changes, ranked | (1) promoted named files run without the pool permit and lead their lane: 0.26 to 0.6 h/day; (2) a busy-core ceiling for background tiers: 0.24 to 0.45 h/day; (3) promote the test files a named source selects: 0.1 to 0.5 h/day; (4) list a revision beside the run in flight: 0.09 to 0.28 h/day | inferred from verified counts |

## Method

- **Named wait:** a `squeal status ... --wait 60000` command with at least one path, with a sar sample at its midpoint: 1,893 waits (cezar 1,038, squeal 854, toolkit-dev 1). `load-slowdown.md` counted 1,155 from the first 120 characters of each command. This file parses the full command. Bands use the same busy-vCPU edges.
- **Timed out:** the output holds Squeal's own sentence "the deadline passed after" (`no-verdict-lines.ts`, `timeoutText`). That gives 607 waits (squeal 355, cezar 252). 186 more commands took 59.5 s or longer without that sentence: their output was redirected (84), chained with other commands (35) or answered at the limit. They are not classified.
- **Class:** each named file's state words in the first deadline sentence (`classify.py` docstring). The primary class of a wait is the state that holds the most named files.
- **Timeline:** worktree id = sha256 of the root path (`worktreeIdOfRealPath`, `src/core/fs/git-layout.ts`). The store's run rows of that worktree split each wait's first 60 s, at 0.1 s steps, into three states: a run that holds a named test file is running; only other runs are running; no run is running (`timeline.mjs`). The split needs named test files and the worktree's runs in the store: 382 timed-out waits and 1,252 named waits of all kinds. Revision rows survive for only 2 of them (the store prunes them), so the timelines use runs only.
- **Edit rate:** revisions per minute between the previous `status --wait` header of the same worktree (1 to 30 min older) and this wait's header (n 770). Also the agents' edit tool calls in the worktree in the 5 minutes before the wait (all 1,893; this is a lower bound, because Codex agents often edit through the shell).

## Findings

**Q1. What the timed-out waits reported.** `verified by experiment` (`classify.py`, `class-rates.py`).

| Busy vCPUs | 0–6 | 6–12 | 12–16 | 16–20 | 20–24 |
|---|---|---|---|---|---|
| named waits | 152 | 339 | 540 | 560 | 302 |
| median wall | 5.8 s | 14.1 s | 28.2 s | 61.0 s | 61.6 s |
| timed out | 7% | 19% | 29% | 41% | 47% |
| per 100 waits: behind another tier | 1.3 | 2.7 | 7.4 | 12.0 | 11.6 |
| own tier running | 2.6 | 5.9 | 5.9 | 9.1 | 8.6 |
| promoted, no tier ahead | 0.0 | 0.3 | 3.7 | 5.9 | 7.6 |
| revision not listed | 0.0 | 2.1 | 3.9 | 3.9 | 7.3 |
| daemon not serving | 1.3 | 2.7 | 2.6 | 4.1 | 2.6 |
| catch-up quiet | 1.3 | 3.2 | 3.0 | 1.4 | 3.6 |
| other (ended, no holder, shared key, …) | 0.7 | 2.1 | 2.9 | 5.0 | 5.3 |

- Above 16 busy, 28 more waits in 100 time out than at 0–12 busy. Of that excess: behind another tier +9.6, promoted +6.3, own tier running +4.0, not listed +3.7, daemon +1.4. Catch-up quiet does not grow with load (−0.4).
- The tier ahead is small: median 8 files, and 41% have 20 or more. It started a median 20 s after the wait began (p25 −25 s, p75 +45 s), so the lane passed over the promoted named files. It almost never stated a reason not to yield (18 of 152).
- 163 waits named a source file. A source selects every test file that reads it, up to 1,030 here. 72% of those waits timed out, at every load (40% at 0–6 busy, 10 waits). They are 19% of the timed-out waits, and catch-up quiet is their main state. Waits that named only test files timed out 5% at 0–6 busy and 41% at 20–24 busy.
- 25% of the timed-out waits also printed "the daemon's heartbeat went N s stale while its socket showed it alive (a busy store or a stalled daemon)": 18% at 0–6 busy, 28% at 16–20 busy.

**Q2. Code paths and design bounds.** `read in source code` at `d81f5c14e`. Paths are relative to `src/`.

| Class | Path | Bound by design |
|---|---|---|
| promoted | The wait promotes only the test files it names by their own path (`cli/status-wait-paths.ts`, `ownNamedFiles`). They lead their lane as one batch tier (row 011-268, `core/scheduler/promoted-tier.ts`, `batchFiles`). `selectTier` (`core/scheduler/tiers.ts`) sets `backlog = batch !== null`, so the batch asks the pool (`capacity.take` with `poolKind` = `backlog`). `gatedPermits` (`core/capacity/cores.ts`) counts the host's busy cores. It grants only while cores < `hostSlots` (12) or grants < 6. On a refusal the selection returns `null`: no tier starts in that pass. After a batch tier, the backlog's turn goes first (`batchTurnDue`), and it also asks for a permit | No limit. A recheck every 2 s (`CAPACITY_RECHECK_MS`). Nothing printed beyond "queued, promoted" |
| behind | One tier per lane (`core/scheduler/slots.ts`, `busyLanes`). A running tier yields only when its estimated remainder is over 30 s (`YIELD_REMAINDER_MS`, `core/scheduler/yields.ts`). An edit tier takes no permit (`core/scheduler/capacity.ts`). So while a batch waits for a permit, an edit, turn or baseline tier can start in the lane | The tier ahead's run time, up to the 600 s run timeout. A slower host makes it longer (1.3 to 2 times, `load-slowdown.md`) |
| running, ended | The file's own tier. Results are counted when the tier's final checks end ("awaiting the tier's final checks") | Its run time, up to 600 s |
| not listed | `Scheduler` picks no tier while runner work is queued (`core/scheduler/scheduler.ts`, `return "runner-work"`). The listing of a new revision waits for the run in flight | 666 s per runner call (`core/scheduler/runner-work-bound.ts`, `runnerPartBoundMs`) |
| daemon | The wait's sync request waits for the daemon's start and for the scheduler lock (`core/daemon/daemon.ts`, `#requestSync`). A lapsed heartbeat is reported but does not end the wait | No overall bound found |
| catch-up quiet | The edit cut keeps a source's namesakes and its 4 shortest other direct importers (`core/scheduler/edit-cut.ts`, `editWork`). The other readers are catch-up. They wait 120 s after the last edit that queued a file of the lane (`CATCHUP_QUIET_MS`, `core/scheduler/quiet.ts`), or 20 s after a backlog cancel (`BACKLOG_QUIET_MS`). Each new edit restarts the wait. Promoted files are exempt, but readers selected by a named source are not promoted | 120 s after the last edit, with no cap on restarts |

**Q3. Where the seconds went.** `verified by experiment` (`timeline.mjs`, `summarize-timeline.py`, `sample.py`). Of the first 60 s of 382 timed-out waits: no run of the worktree 51%, only other runs 32%, a run that holds a named file 16%. The first such run started a median 56 s after the wait began (n 288). All the named files had a run end a median 110 s after the wait began (p75 214 s). 197 waits had no such run within 15 minutes. At 16 busy and above, "no run" seconds belong to these classes: promoted 31%, not listed 19%, running 16% (the run had not started yet), daemon 16%. "Other runs" seconds belong to: behind 32%, running 27%, not listed 20%. Per class: promoted waits had no run 89% of the time, behind waits ran other tiers 65% of the time, and running waits had their own run for 37% of the time.

A stratified sample of 24 waits (`sample.py`, seed 11), 4–5 per band, both projects. s = seconds from the start of the wait. "cp" = a run of a baseline checkpoint.

| # | Busy | Project, class | Seconds of 60: own run / other runs / no run | What happened |
|---|---|---|---|---|
| 1 | 6 | squeal, quiet | 0/0/60 | a 1-file tier ended at −4 s; a catch-up tier of 83 files ran at 115 s |
| 2 | 4 | cezar, behind | 0/60/0 | a 1-file baseline tier from −66 to 215 s; the named 4 ran 216–223 s |
| 3 | 3 | squeal, running | 0/60/0 | another tier ran −3 to 135 s; the named file ran at 217 s |
| 4 | 4 | cezar, daemon | 0/0/60 | no run until 82 s; answered at 109 s |
| 5 | 8 | cezar, running | 51/0/9 | a 9-file baseline tier with all 9 named ran 9–279 s |
| 6 | 11 | cezar, behind | 0/4/56 | four 1-file baseline tiers at 33 s; the named 3 ran 161–163 s |
| 7 | 12 | squeal, running | 11/0/49 | nothing until 49 s; the named 3 ran 49–72 s |
| 8 | 9 | cezar, daemon | 0/52/8 | a 44-file baseline tier until 52 s; the named file ran 131–168 s |
| 9 | 11 | squeal, ended | 0/60/0 | a 10-file tier −77 to 104 s; the named file did not run in 15 min |
| 10 | 15 | cezar, not listed | 0/0/60 | nothing until 77 s; the named 2 ran 82–95 s |
| 11 | 14 | squeal, running | 18/0/42 | nothing until 42 s; the named file ran 42–114 s |
| 12 | 14 | squeal, promoted | 0/0/60 | nothing until 61 s; the 5-file batch ran 61–70 s |
| 13 | 15 | squeal, quiet | 1/13/46 | small edit tiers only; no catch-up in 15 min |
| 14 | 15 | cezar, promoted | 0/30/30 | a 13-file baseline tier until 30 s, then nothing |
| 15 | 17 | squeal, behind | 0/60/0 | tiers of 15, 3, 9 and 7 files one after the other until 282 s |
| 16 | 18 | cezar, promoted | 0/0/60 | nothing until 75 s; the named 3 ran 75–85 s |
| 17 | 18 | cezar, running | 38/0/22 | own tiers 11–17 s and 18–42 s, then 52–63 s |
| 18 | 17 | squeal, promoted | 0/0/60 | no run for 291 s; answered at 293 s |
| 19 | 18 | squeal, ended | 50/0/10 | a 20-file tier with 3 named ran 10–65 s |
| 20 | 20 | cezar, promoted | 0/10/50 | two 1-file tiers; the named file ran 68–76 s |
| 21 | 20 | squeal, quiet | 0/0/60 | a 120-file catch-up tier at 102–294 s |
| 22 | 20 | squeal, promoted | 0/0/60 | nothing until 96 s; the named 2 ran 96–132 s |
| 23 | 20 | cezar, behind | 0/58/2 | five 4-file baseline tiers one after the other |
| 24 | 20 | squeal, behind | 0/60/0 | a 123-file tier −69 to 127 s, then a 20-file tier |

The promoted rows (12, 16, 18, 20, 22) match the permit refusal: a free worktree runs nothing for 60 to 291 s and then runs the batch in a few seconds. The store does not record refusals, so this match is `inferred`.

**Q4. Load or more edits.** `verified by experiment` (`edit-rate.py`, `band-split.py`).

- Busy hours have only slightly more edits. The median revision rate before a wait was 0.36 per minute at 0–6 busy and 0.55 to 0.65 at 12–24 busy. The mean edit calls in 5 minutes were 0.62 and 0.68.
- At an equal edit rate, the timeout share still rises with load. With no revision before the wait: 17% (n 12), 24%, 24%, 33%, 48% (n 44). At 0.5 to 2 revisions per minute: 7% (n 15), 30%, 38%, 31%, 62% (n 60). With no edit call in 5 minutes: 5% (n 109), 17%, 28%, 39%, 43% (n 211).
- Standardised to the pooled edit mix, the shares per band are 7.1, 19.8, 29.5, 41.1 and 46.3% (raw: 7.2, 18.9, 29.4, 41.4 and 46.7%). By the revision rate: 7.3, 23.8, 33.4, 31.8 and 51.1% (raw: 6.8, 22.9, 33.6, 31.9 and 52.4%). The edit mix explains at most 1.3 points of the band effect.
- **The split of the extra wait.** These are the mean seconds of all 1,252 named waits with store data, up to their end or 60 s. At 0–6 busy: 22.7 s, made of 6.5 s own run, 5.0 s other runs and 11.1 s no run. At 16 busy and above: 42.0 s, made of 7.9 s, 12.9 s and 21.2 s. The extra 19.4 s is 7% slower own runs, 41% other tiers ahead and 52% no run.
- `inferred`: load acts mainly through the queue, not through the named files' own run time. The queue paths that grow with load are the permit gate on the promoted batch and on the backlog's turn, tiers ahead that run 1.3 to 2 times slower and do not yield, the listing held behind those tiers, and daemon stalls. Cancels and quiet restarts would have grown with the edit rate, and they do not.

**cezar's change to lookup-only restart baselines.** On 2026-11-06 at 17:39Z, cezar set `baseline.onStart` to `lookup-only` (cezar `fc5c2c5e0`, PR #2808). A worktree takes the change only once its checkout has that commit, so "after" mixes old and new worktrees. `verified by experiment` (`cezar-baseline.py`, cezar named waits with store data):

| cezar named waits | n | timed out | seconds behind a restart baseline's run, per wait | waits with any time behind one | timed-out waits with time behind one |
|---|---|---|---|---|---|
| before 17:39Z | 709 | 26% | 4.8 s (13% of wait time) | 27% | 21% of 187 |
| after, to 08:20Z (14.7 h) | 71 | 11% | 2.5 s (6%) | 4% | 0 of 8 |

At 12 busy and above, the figures are 5.2 s and 25% before (n 502), and 3.1 s and 5% after (n 56). The share of waits that sat behind a restart baseline fell from about a quarter to about 1 in 20. That is large but not confirmed: the "after" window has 71 waits and 8 timeouts. The baselines were 13% of cezar's wait time before the change, so the change can remove at most that part. The other classes remain.

**Q5. Changes ranked by wait seconds removed.** `inferred` from the verified counts (`savings.py`, `chains.py`). In this window named 60 s waits took 2.18 h/day. Waits at 12 busy and above took 1.13 h/day more than at the 0–6 mean (14.8 s). 52% of timed-out waits (62% at 16–20 busy) were followed by another wait within 30 s, so a timed-out wait costs a median 65 s and a mean of 79 to 164 s per band. Low ends count only the first 60 s of the class's waits above the 0–12 rate. High ends count the class's blocking state with its follow-up waits.

1. **Let a named wait's promoted files start without a pool permit, at the edit tier's width, ahead of new edit and turn tiers in their lane.** This removes the "promoted" class (0.14–0.15 h/day in the first 60 s) and the part of "behind" where the tier ahead started after the wait (about 60% of 0.20–0.22 h/day). **0.26 to 0.6 h/day.** The cost is up to one tier of `runner.tierSize` per waiting agent beside the gate, the same as an edit tier.
2. **A busy-core ceiling of about 16 for backlog, baseline and turn tiers** (`load-slowdown.md` recommendation 1). If waits at 16–24 busy timed out at the 12–16 rate (29%), there would be 119 fewer timeouts in 8.4 days. **0.24 to 0.45 h/day.** It also cuts the "behind" tiers and the daemon stalls. Cezar baselines are in 6 of the 24 samples, but cezar's change to lookup-only has already removed most of that part (see above), so the low end is more likely.
3. **Promote the test files a named source selects, or limit the selection to the edit cut's files.** This targets waits that name a source file: 117 timeouts, 0.23 h/day in the first 60 s, mostly catch-up quiet. It does not depend on load. **0.1 to 0.5 h/day**, depending on how many of the readers are run.
4. **List a new revision without waiting for the run in flight.** This removes "not listed": 0.09 h/day above the low-load rate, 0.13 h/day in the state. **0.09 to 0.28 h/day.**

Change 1 and change 2 overlap on the "behind" seconds, so their savings do not add up.

## Recommendation for Squeal (proposals only)

Do change 1 first. It is the only change that targets the class that exists only under load, and it makes the wait's own request work against the gate that load closes. Then do change 2 (already proposed in `load-slowdown.md`). Also show the permit wait in the wait's output, for example "queued, promoted, waiting for a pool permit (host busy N of 12 slots)". Without that line, agents and this research cannot tell a permit wait from a stalled daemon.

## Open questions

- Not determined: the number of permit refusals per wait. The daemon does not log refusals, and the store does not record grants. A log line in `TierCapacity.take` on a refusal would settle it.
- Not determined: why 197 of 382 timed-out waits had no run of all their named files within 15 minutes. Possible reasons are lookups of results from other worktrees, re-keys by later edits, and daemon restarts. Run rows alone cannot tell them apart.
- Not determined: the cause of the stale heartbeats (store contention or a blocked event loop). The daemon does not record the lag.
- The class precedence is a choice: a wait with files in several states counts once, under the state with the most files. File-weighted shares are in `classify.py`'s output (behind 56%, quiet 26%, mostly from waits that name a source file).

## Sources

- Transcripts: `~/.claude/projects/*/*.jsonl`, `~/.claude/projects/*/*/subagents/*.jsonl` (edit calls only), `~/.codex/sessions/*/*/*/*.jsonl`, 2026-10-29 23:00Z to 2026-11-07 08:20Z.
- Stores: `<common>/squeal/store.sqlite` (+ `-wal`, `-shm`) of cezar, squeal, toolkit-dev, saas-bp-management-dashboard and mvp-unveiled-july26, copied 2026-11-07 09:56Z.
- sar: `/var/log/sysstat/sa29`–`sa07`, `sadf -d -U -- -u`, cut at 08:20Z.
- Source at `d81f5c14e`: `src/cli/status-wait-paths.ts` (`waitForNamed`, `ownNamedFiles`), `src/cli/no-verdict-lines.ts`, `src/core/scheduler/tiers.ts` (`selectTier`), `src/core/scheduler/promoted-tier.ts` (`batchFiles`, `batchTurnDue`), `src/core/scheduler/capacity.ts` (`poolKind`, `CAPACITY_RECHECK_MS`, `WAIT_FOR_CAPACITY`), `src/core/capacity/cores.ts` (`gatedPermits`), `src/core/capacity/pool.ts` (`#gated`), `src/core/scheduler/scheduler.ts` (runner work), `src/core/scheduler/runner-work-bound.ts`, `src/core/scheduler/yields.ts`, `src/core/scheduler/quiet.ts`, `src/core/scheduler/edit-cut.ts`, `src/core/fs/git-layout.ts`.
- Earlier results: `load-slowdown.md` (finding 4), `probes/load-slowdown/`, `probes/host-load/README.md` (copy rules).
- Probes: `probes/wait-timeouts/` (README there).
