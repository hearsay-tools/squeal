# 015 The code squeals: dogfooding lessons

## Round 2 (015-14)

Task 015-14 Part B, 2026-10-26, worker 327524f0. The passive working day with coverage on: every real agent session in this repository from 2026-10-25T18:10Z (the last switch-on in `tasks/015-14/window.md`) to 2026-10-26T16:16Z (this task's spawn), and the other repositories from 0.1.341 (12:07Z), when coverage became on by default. Plus two measurements in clones of 0.1.349: CPU per edit with coverage off and on (D10), and two runs of 40 test files at the same content (open question 5). The brief is `tasks/wave-15.md` W3 with `tasks/wave-3.md` Part B. The method, the sources, the tables per session and per worktree and the scripts are in `tasks/015-14/part-b.md` and `tasks/015-14/part-b/`. Every judged line is in `part-b/judged.tsv`. Each SQUEAL line quoted here is copied from a transcript.

### Verdict

Coverage lines were mostly noise in this window, and the noise has three causes that rules can remove. Nearly half of the code that coverage could judge stays `unknown` or `pending`.

- **Lines.** 178 CRAP and `untested` lines reached 20 sessions here: 106 `FAIL`, 49 `PASS`, 7 `STILL FAIL`, 16 `RESOLVED`. Verdicts: 5 useful, 64 unclear, 109 noise. All 5 useful lines came before 0.1.341.
- **Where the noise came from.** 53 lines named code that only another process or a worker thread runs, or that no test is meant to load (fixtures, probes, e2e helpers, the provider, the lint provider's thread). 46 were a helper's `FAIL` reversed within 180 s by the session's next write, the test file that loads it, and the `PASS` that reversed it. 9 came from a pull. 1 came from another actor.
- **Where the lines pointed.** 144 of the 178 named files under `test/`, 12 under `research/probes/`, 22 under `src/`. This repository's `coverage.exclude: ["test/**"]` (from about 16:00Z, after the window) removes the 144. Every other project has an empty exclude. Of the 22 `src/` lines, 3 were useful, 10 named code that a child or a thread runs, 5 came from a pull, and 4 were transient.
- **Acted on.** Two cases. Coordinator 605ca21e relayed three `untested` `FAIL`s in `src/core/daemon/` to 011, which became rows 011-228 and 011-229; their tests shipped in 0.1.331 and 0.1.333. Coordinator 52e58f23 got `FAIL CRAP` for a validity-harness helper, started research 015-58, and the human decided `coverage.exclude` and the new wording. No agent wrote a test in the same session because of a line.
- **Unknown and pending.** In the median worktree with closures, 342.5 files read `unknown` because a test that loads them skipped, and they hold 4,081 functions: 2.8 times the 1,463 functions in judged files. Most skips are timing tests that skip themselves above `MAX_LOAD_FOR_TIMING`, a one-minute load of 8. Every load read in this task was over 8, so on this host the load decides what coverage can judge.
- **D10.** Pending: the A/B pairs run beside the host's load, and this line is filled when they end.
- **Open question 5.** Yes: two runs of 40 test files at the same content gave the same records, bit for bit: 0 of 75,359 function hit bits and 0 of 685,143 lines differed, at load 9 to 15. The four load-gated timing tests in the sample skipped in both runs.
- **Store.** `code.sqlite` went from 0.72 GB to 2.18 GB in 20.4 hours. Coverage records are 1.92 GB of it: 68,495 records of 28 KiB each, one per result key, kept 7 days.
- **Coverage notes.** No session saw "coverage is off until the daemon restarts": 0.1.349 reached the plugin cache after the window. The failure that note replaces did reach agents: 12 deliveries in 4 cezar sessions told about 3,600 checks `UNKNOWN`, and one worktree turned coverage off by hand.

### D10: CPU per edit, coverage off and on

Pending: the A/B pairs run beside the host's load (`part-b.md`).

### Open question 5: coverage at the same content

Yes: coverage adds no noise of its own. Two runs of 40 test files at the same content gave the same records, bit for bit.

| Compared, run a against run b | Count | Differ |
| --- | --- | --- |
| Test files (281 tests passed, 14 skipped, in each run) | 40 | 0 outcomes |
| Sources (test file and source) | 9,220 | 0 |
| Executable lines | 685,143 | 0 covered lines |
| Functions | 75,359 (18,064 run) | 0 hit bits |

- **Sample.** 40 test files drawn at random from this repository at 0.1.349: 14 whose names say timing (`wait`, `slow`, `turn`, `retry`, `chain` and the like) and 26 others. 13 of the 40 use timers or the clock. The research had 30 files and 0 changes in 75,628 function states; this sample has 75,359 functions and 0 changes.
- **Load.** Run a went from 11.2 to 14.8, run b from 14.8 to 9.3, about 57 s each. The window's load was mostly 25 to 60, but the brief holds every run while the load is over 24, so no run was made there.
- **What the runs could not test.** `test/code/crap/chain-load.test.ts` skips its 4 timing tests above a load of 8 (`MAX_LOAD_FOR_TIMING`), and it skipped them in both runs. Six test files hold that limit. On this host the load was over 8 at every reading, so these tests make their sources `unknown` (row C1) rather than flaky.
- **Recommendation.** Close open question 5 with this count. Keep records as they are: no rule that waits for two runs to agree is needed. The noise in the window came from what the lines say and when they come (rows C3 to C6), not from records that change between runs.

The method and the full result are in `part-b.md`, "Open question 5".

### Deliveries

Coverage lines (CRAP and `untested`) in this repository, by version. A Claude Code line's version is the newest in the plugin cache at its process's latest start; a Codex line's is the one in its skill path, a lower bound (0bcb0e92's two lines read as 0.1.334 but use 0.1.341's wording).

| Version | Sessions | FAIL | PASS | STILL FAIL | RESOLVED | Useful | Unclear | Noise |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0.1.318 | 1 | 2 | 0 | 0 | 0 | 2 | 0 | 0 |
| 0.1.319 | 1 | 2 | 2 | 0 | 0 | 0 | 0 | 4 |
| 0.1.321 | 2 | 2 | 1 | 0 | 0 | 0 | 0 | 3 |
| 0.1.323 | 1 | 3 | 0 | 0 | 0 | 3 | 0 | 0 |
| 0.1.326 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 2 |
| 0.1.327 | 4 | 21 | 6 | 4 | 9 | 0 | 13 | 27 |
| 0.1.332 | 1 | 8 | 5 | 1 | 0 | 0 | 6 | 8 |
| 0.1.333 | 3 | 7 | 5 | 0 | 0 | 0 | 8 | 4 |
| 0.1.334 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 2 |
| 0.1.335 | 1 | 0 | 0 | 2 | 0 | 0 | 0 | 2 |
| 0.1.342 | 3 | 30 | 28 | 0 | 2 | 0 | 33 | 27 |
| 0.1.343 | 1 | 7 | 0 | 0 | 5 | 0 | 0 | 12 |
| 0.1.345 | 3 | 7 | 1 | 0 | 0 | 0 | 2 | 6 |
| 0.1.346 | 2 | 13 | 1 | 0 | 0 | 0 | 2 | 12 |
| All | 20 | 106 | 49 | 7 | 16 | 5 | 64 | 109 |

Before 0.1.341: 84 lines, 5 useful, 27 unclear, 52 noise. From 0.1.341: 94 lines, 0 useful, 37 unclear, 57 noise. The 20 sessions are 20 of the 105 worker, coordinator, researcher and reviewer sessions here; 840 Haiku helpers got the registration line only. The table per session is in `part-b.md`.

The same window's complexity lines, for scale: 8 `FAIL`, 10 `PASS`, 24 `STILL FAIL`. Summaries: 867 registrations, 98 counting and 97 counted lines, and 182 told-over lines in 21 sessions, 161 of them repeats (up to 28 in one session). The table by version is in `part-b.md`.

The cases, one each:

| Case | Line | What followed |
| --- | --- | --- |
| Relayed, useful (605ca21e, 0.1.323) | `FAIL uncovered: withSlowInstance.drop.<catch> (occurrence 2) (src/core/daemon/slow-instance.ts:41): no in-process test that Squeal runs reaches it (CC 1)` | "Squeal's coverage check reports that no test reaches one error-handling branch in `src/core/daemon/slow-instance.ts:41`." Rows 011-228 and 011-229 |
| Researched, useful (52e58f23, 0.1.318) | `FAIL CRAP: relist (test/keys/validity/harness/assemble.ts:150) is 42, over 30 (CC 6); no in-process test that Squeal runs reaches it` | "Squeal may have shown me a false CRAP failure." Research 015-58 |
| Worker thread, noise (2e373245, 0.1.346) | `FAIL CRAP: EslintSession.lint (src/core/lint/provider/session.ts:207): 182, over 30 (complexity 13; no test runs it in its own process)` | Nothing. The lint provider runs in a worker thread (`src/core/lint/provider/thread.ts`), which the provider does not measure, so "no test runs it" is false |
| Child process, noise (0bcb0e92, Codex) | `FAIL untested: filesDirectory (src/core/code/coverage/provider.mjs:40): no test runs it in its own process; 38 test files load this file (complexity 3, CRAP 12).` | Nothing. A pull brought it; Vitest loads the provider in its own process |
| Transient, noise (b528f9fc, 0.1.319) | `FAIL uncovered: askedEnds.<map> (src/cli/status-wait-ask.ts:191): no in-process test that Squeal runs reaches it (CC 1)` | 31 s later: `PASS uncovered: askedEnds.<map> (src/cli/status-wait-ask.ts:191): test/cli/status-wait-ask.test.ts runs it in process` |
| Helper before its test, unclear (8f337351, 0.1.342) | `FAIL untested: FakeProvider.close (test/lint/pass/helpers.ts:90): no test file loads this file (complexity 1, CRAP 2)` | Nothing; the test files came minutes later. Most of the 64 unclear lines are this |
| Probe, noise (0768386d, 0.1.343) | `FAIL untested: add (research/probes/issue-102/math.js:1): no test file loads this file (complexity 1, CRAP 2)` | Nothing. A researcher's probe |

`untested` `FAIL`s that led to a test: the 3 relayed functions of 605ca21e (011-228, 011-229). No other.

### Unknown states

From each worktree's coverage summary at the window's end and the `uncovered` states (`crap` has the same file conditions). A file names one cause, the first of `unkeyed`, `skipped`, `no-record`, `unread`. The main checkout and one new worktree have no closures yet, so their 2,104 files wait as `pending, imports`.

| | Files | Judged | Unknown, skipped | Unknown, no record | Pending, run | Functions | In judged files | Unresolved spans | In skipped files | In no-record files |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All 20 worktrees | 23,549 | 4,405 | 5,819 | 3,726 | 7,494 | 242,854 | 35,106 | 2,843 | 63,995 | 44,491 |
| Median of the 18 with closures | 1,306.5 | 186 | 342.5 | 138.5 | 382.5 | 12,979 | 1,463 | 66.5 | 4,081 | 2,221 |

By cause: skipped 5,819 files, no record 3,726, unkeyed 0, unread 0; unresolved spans 2,843 functions in judged files. The table per worktree is in `part-b.md`.

- **Skips hide the most.** In 52e58f23, 6 test files with 13 skipped tests hide 4,413 functions; 1,514 are judged. Five of the six skip a timing test with `ctx.skip` while the load is over `MAX_LOAD_FOR_TIMING`, which is 8 in each. The load here was over 8 at every reading in this task (9.3 to 89), so these tests skip on nearly every run, and each skip makes every file its test file loads `unknown` (D9).
- **No record, cause not known.** 0 to 76 test files per worktree (196 in all) have a current result that passed, in a completed run, and no record. Each one makes its whole closure `unknown`. None imports `node:inspector`. One reproduced in this worker's own daemon on 0.1.349 (`test/scheduler/backlog-slots-overhead.test.ts`). D8 names no cause that fits.
- **Unresolved spans (R6).** 2,590 of the 2,825 read in detail are one-line functions stored as `[1, 0, 0]`: one line, none covered, no test file. That is R6's `ran: null` for a single-line function the join misses. 235 span two lines or more with nothing covered. The two R6 causes cannot be told apart without the generated positions, which the record drops.

### Coverage notes and the provider failure

0.1.349 (015-70) reached the cache at 16:16:09Z, after the window, so no delivery or status output in the window holds "coverage is off until the daemon restarts". Count per session: 0 in every session read.

The failure that 015-70 turns into that note did reach agents, in cezar, from 0.1.341 (coverage on by default) until 0.1.347 carried 013-08's fix: 12 deliveries in 4 sessions said `vitest: unhandled error outside any test file: Error: Failed to load custom CoverageProviderModule from …/dist/coverage/provider.mjs`, each telling whole test files `PASS -> UNKNOWN`.

| Session | Harness | Versions | Deliveries | Checks told `UNKNOWN` | What the agent did |
| --- | --- | --- | --- | --- | --- |
| c8bb31ae | Codex | 0.1.341 | 2 | 38 | Nothing recorded |
| cd4cfd98 | Claude Code | 0.1.342 to 0.1.346 | 5 | 2,903 | Checked the provider file, re-ran by hand; later filed #106 |
| ce407fcb | Claude Code | 0.1.346 | 1 | 82 | Ran its scans by hand |
| ed1670e6 | Claude Code | 0.1.346 | 4 | 578 | Left `"coverage": { "enabled": false }` uncommitted in its `squeal.config.json` |

cezar's 9 coverage lines in the window were all for `scripts/test-sandbox.mjs` (cd4cfd98), and all false: the file runs only in a child. The same delivery says both "no test runs it in its own process" (`readOwner`) and "no test file loads this file" (`createTestSandbox`) for one file. Issue #106 holds this case. mega had no coverage line.

### Store

| Reading (UTC) | `code.sqlite` | `store.sqlite` |
| --- | --- | --- |
| 2026-10-25 19:54 (nearest to the window's start) | 721,387,520 bytes | 817,397,760 bytes |
| 2026-10-26 16:17 | 2,177,171,456 bytes | 1,087,782,912 bytes |

`code.sqlite` grew by 1.46 GB in 20.4 hours, about 71 MB an hour. At the end the coverage table held 68,495 records, 1,921,968,844 bytes, 28.1 KiB each. 52,947 of them (1.49 GB) were stored inside the window, up to 4,653 records (129 MB) in one hour. 15,139 records (415 MB) from before the window were still held. A record is stored per result key, and a test file's key changes with each edit of a file it loads, so a day of edits stores a record per test file per re-run. D10 says about 9 KiB of store per test file result; 015-11 measured 26.7 KiB, and the window's records average 28.1 KiB. Per day that is about 1.5 GB here. Records go when the main store drops their result key, after 7 days, so at this rate the coverage table would hold about 10 GB (inferred, not observed).

### Residue from the 015-12, R6 and R7 notes

| Residue | Evidence in the window |
| --- | --- |
| 015-12: no `STILL FAIL` for `crap` or `uncovered` | Closed by 015-40. 7 coverage `STILL FAIL` lines reached agents, all after the session's own edit |
| 015-12: `complexity.blocking`, `--told` and the told-over line count complexity only | Closed by 015-40. 54 of the 182 told-over lines count CRAP or `untested` functions, but still start with "Complexity:": `Complexity: 2 functions untested that this session was told about; … squeal code --told lists them.` Blocking is off here, so not exercised |
| 015-12: no summary for a `crap.threshold` change | Closed by 015-40. No threshold changed in the window |
| 015-12: per-pass cost of about 20 ms | Not measured apart; it is inside D10's CPU per edit above |
| 015-12: skipped tests make sources `unknown` | 5,819 files and 63,995 functions across 20 worktrees; median 4,081 functions per worktree, 2.8 times the judged ones |
| 015-12: records from another worktree do not nudge; the closure may be another worktree's | Not seen in a line. Not measurable from transcripts |
| R6: a class with one arrow field reads `unknown`; generated functions on one span read `unknown` | Inside the 235 multi-line unresolved spans; not separable from the record |
| R6: `ran: null` for single-line functions the join misses | 2,590 functions across 20 worktrees, median 55 per worktree |
| R7: provenance per file, a pending own edit left untold after a pull | 0 of 7 coverage `STILL FAIL` lines came from a git body. 9 coverage `FAIL` or `PASS` lines came from a pull (015-19 keeps them on purpose); no agent used one. A quiet miss leaves no line, so it cannot be counted from transcripts |

### Proposed rows

The coordinator assigns the numbers. None of these is fixed here.

| Row | Problem, with the evidence | Done when |
| --- | --- | --- |
| C1, a skipped test hides its whole closure | 5,819 files and 63,995 functions read `unknown, skipped` across 20 worktrees; median 4,081 functions per worktree against 1,463 judged. Most skips are timing tests skipped above `MAX_LOAD_FOR_TIMING`. Options, a product decision: (a) extend D9's early pass to these files: a function the records in hand prove (CRAP at or under the threshold, or run) reads `pass` even with no earlier judgement, and the rest stay `unknown`, so no false `fail` is possible; (b) do not let a timing test's load-gated skip count as a skip for coverage; (c) leave as is. My default is (a). D9 amendment | A step test: a source loaded by a passing test file and by a test file with one skipped test reads `pass` for the functions the passing file's record runs, and `unknown` for the rest |
| C2, a passing completed result with no record | 196 test files across 20 worktrees, each making its closure `unknown`. Each checked one passed in a run that ended `completed`, which D8 says stores a record. One reproduces on 0.1.349 in this worker's worktree (`test/scheduler/backlog-slots-overhead.test.ts`, run `62afa686`). D8 names no cause that fits. First step: log, per completed file, why the writer stored no record | The cause is named and either fixed or added to D8's list; a writer test for it |
| C3, code a worker thread runs reads `untested`, and the wording says something false | 5 `FAIL CRAP` lines for the lint provider (2e373245), which runs in a worker thread. The wording "no test runs it in its own process" reads as "no test runs it". 015-58 and 015-65 word the child case; a thread is not a child. Options: (a) say "no test runs it in the test's own thread, so code a worker thread or child process runs is not measured"; (b) collect worker-thread coverage | A wording test for the thread case, or a provider test that records a worker thread's functions |
| C4, the same file reads as loaded and not loaded in one delivery | cezar cd4cfd98: `readOwner` "no test runs it in its own process" and `createTestSandbox` "no test file loads this file", one file, one delivery. Here, 605ca21e's `startCoverage` (provider.mjs) has no loader count while 0bcb0e92's `filesDirectory` in the same file says "38 test files load this file" | A delivery test: two functions of one file in one delivery get the same loader wording |
| C5, a helper's `FAIL` before its test file lands | 46 of 109 noise lines: a helper written, `FAIL`, then the test file within 180 s and `PASS`. 64 more unclear lines are the same with a longer gap. The `test/**` exclude removes them here; every other project's exclude is empty, so they get them all. Options: (a) default `coverage.exclude` to the project's test globs; (b) hold an `untested` `FAIL` for a new file until the next revision; (c) leave as is | With (a): a fresh project's policy has its test globs in the exclude; a helper under `test/` gets no line |
| C6, a pull's coverage `FAIL` is told | 9 lines from a pull, no agent used one; 015-19 keeps them on purpose, as for complexity (Round 1's B5). Same product choice: tell coverage lines from a pull, or not | The human's choice is recorded in D6 or D9 |
| C7, the told-over line repeats and says "Complexity:" for coverage counts | 182 told-over lines in 21 sessions, 161 repeats, up to 28 in one session; 54 count coverage functions under "Complexity:". Proposal: tell it once per change of its numbers; start it "Code:" | A delivery test: the same numbers twice give one line; a CRAP count does not start "Complexity:" |
| C8, the coverage store grows by a record per re-run | 1.46 GB in 20.4 hours, 28 KiB per record, kept 7 days. Options: (a) store each source's part of a record once, by its content, so a re-run after an edit to one source adds one part, not one per source loaded; (b) keep only the records still current in some worktree, plus the newest per test file; (c) a shorter retention for records than for results | With (a): a store test, two records of one test file that differ in one source store the other sources once |

cezar's false lines for `scripts/test-sandbox.mjs` are issue #106, not a new row. The provider failure 015-70 names is fixed and noted.

### For the next worker

- Count again after `coverage.exclude: ["test/**"]` has been on for a day: 144 of this window's 178 lines are gone by construction, so the next round sees `src/` lines alone.
- The D10 pairs take about 45 minutes each beside this host's load. Start them first, and copy `part-b/bin/ab.py`, which sets a scratch `HOME` and the XDG directories per arm.
- `tasks/015-14/part-b/judged.tsv` holds every line with its verdict; the scratch data stays under `/tmp/dogfood-015-14/w-327524f0/` while the host keeps it.

## Round 1, live sessions (015-10)

Task 015-10 Part C, 2026-10-24, worker 4ddd4e37. Twelve real `claude -p` sessions on Sonnet, six in a clone of this repository and six in a clone of cezar, with the released Squeal 0.1.284 and complexity on. The brief is `tasks/wave-1.md`, "015-10 Part C". The setup, the scripts and what went wrong in the runs are in `tasks/015-10/part-c.md`. Every SQUEAL line quoted here is copied from a session's stream. Every count was checked against `squeal code` in the clone after the session.

### Verdict

When the agent's own edit makes the change, complexity tells it the right thing at the right time.

- **Counts.** The sessions got 19 complexity lines: 11 `STILL FAIL`, 5 `PASS`, 2 `FAIL` and 1 too-big line. Each count equalled `squeal code`.
- **Delivery time.** 11 of the 13 deliveries came 0.5 to 2.3 s after the edit's tool call ended (median 0.8 s). The other two waited for the agent's next tool call: 8.5 s and 21.4 s.
- **Agent behaviour.** Agents read the lines and used them sensibly. Three agents acted on a line: sq1 brought `stopCommand` from 21 to 20, sq3 tried to fix `retryCommand`, and cz1 offered the user a split. No agent treated a complexity line as a test failure. No agent stopped its task for one.

Four defects make a line wrong, or lose it:

- **P1. A pull inside a session reads as the agent's edit.** In sq6 a `git merge --ff-only` gave four `STILL FAIL … after the edit` lines for functions the session never touched. This reproduces the case in `tasks/015-10/window.md`.
- **P2. A change made while no daemon ran reads as the next session's change.** In sq2 a `git reset --hard` made between sessions came in as `FAIL complexity: stopCommand … is 21, over 20`. The session never touched `stopCommand`. Its registration also said 80 functions over 20 when 81 were.
- **P5. A delivery can be lost.** In cz6 the agent took `statusFor` from 20 to 21. The PostToolBatch hook that should have said `FAIL` hit its 2 s timeout, and the session ended before another hook ran, so the agent never heard of it. In cezar, the hooks that carried a code line took 0.68 to 1.17 s (median 1.05 s), against a median of 0.57 s for other hooks. Every session's view holds a row for every function, about 16,250 in cezar, and ended sessions keep theirs.
- **P4. `squeal code` gives a stale count with no mark.** Twice, `squeal code` run right after an edit printed the count from before the edit. Both agents noticed and lost a step.

One gap in the design shows too (P3). After a `FAIL`, an agent that tries a fix but stays over hears nothing. sq3 ended with "I haven't confirmed the function is back under 20", and `retryCommand` was still 22.

What these sessions say on the open questions:

- **Open question 1 (`?.`, `??` and defaults).** Keep counting them. 5 of the 19 lines, and the lost cz6 `FAIL`, exist only because of `?.` and defaults: four for `stopCommand` (21; 18 without them) and one for `recordFocusedTier.<map>` (25; 20 without). `squeal code` counts `??` inside `logical`, so the counts without all three kinds can be lower still. None of the five read as noise because of these kinds, and no agent questioned a count. The noise came from who made the change (P1, P2), not from what was counted.
- **Open question 2 (`STILL FAIL`, the first edit to a standing failure).** Keep it, with P1 fixed. The 11 lines: 2 useful (sq1 acted on one; cz1 told the user), 2 redundant but harmless (sq5 and cz5r were already refactoring that function), 3 noise (sq4, a rename that changed no count), and 4 from a pull (sq6, P1). Once P1 is fixed, 7 remain, with 2 useful and 3 noise. One rule would cut the 3 noise lines but also cut sq1's useful line: skip a `STILL FAIL` when the count did not move. sq1's count did not move either (21 to 21), so that rule is not worth it.
- **Open question 4 (churn in a refactor made in several edits).** No churn. Five sessions brought a function over 20 down: sq2 and cz2 in one edit, sq1 in two rounds, sq5 and cz5r in three rounds of two Edit calls each. No function crossed and came back. Each step that stayed over was quiet: sq5 at 22, cz5r at 23, sq3 at 22. Every one of the five `PASS` lines came with the session's last edit to that file; no edit followed any of them. A rule that holds a crossing until it lasts across two edits would have withheld all five. Keep immediate delivery.

### Setup

| Item | Value |
| --- | --- |
| Isolation | The OS user `squeal-e2e`, case root `/home/squeal-e2e/runs/d1510`; credentials by name only (`tasks/015-10/part-c.md`) |
| Squeal | 0.1.284 from `git archive squeal--v0.1.284`, at user scope in the case's Claude Code |
| Harness and model | Claude Code 2.1.300, `claude -p --model sonnet` (`claude-sonnet-5-5`), bypass permissions |
| squeal clone | `d5018817a` (origin/main), complexity on with `docs/**` excluded: 1,204 files counted, 81 functions over 20 (60 in `src`), 4 files in parse errors with no function in them |
| cezar clone | `03c905a00`, complexity on with the default include and exclude: 944 files counted, 267 functions over 20, 1 function in a parse error, 1 file too big (`packages/cezar/src/workflows/run.ts`, 560 KiB) |
| Sessions | 06:46Z to 07:16Z. Planned: kinds 1 to 4 of the brief in each repository. Added: `sq5` and `cz5r`, refactors told to go in steps, because `sq2` and `cz2` refactored in one edit each; `sq6`, a session that fast-forwards first, for `window.md`'s pulled `STILL FAIL`; `cz6`, a second try at kind 3, because `cz3` stayed under 20 |
| Load gate | Until 07:05Z a session started only at a one-minute load of 24 or below. Then the human dropped the gate ("complexity is cheap"), and sessions started at once with the load recorded |

Twelve sessions are clean. Two runs are left out: `cz4` and `cz5`. By my error they shared the cezar clone, and `cz5`'s reset removed `cz4`'s edits. I stopped both and ran them again as `cz4r` and `cz5r` (`part-c.md`).

### The sessions

Times are seconds from the session's start. "Edit to line" is from the end of the tool call that wrote the file to the hook that carried the line. The registration line (`Complexity: N functions over 20; squeal code lists them.`) opened every session and is shown only where it was wrong.

**sq1 (squeal, kind 1).** Task: `squeal stop` names the daemon's pid. Load 22.9 at the start; 79 s; the daemon used 21 s of CPU.

| t | SQUEAL line | Edit to line | Agent's next action | Right? |
| --- | --- | --- | --- | --- |
| 29.5 | `STILL FAIL complexity: stopCommand (src/cli/stop.ts:45) is 21 after the edit; it was already over 20 before it (ESLint rule)` | 21.4 s. The PostToolBatch 0.4 s after the edit carried nothing; the next one came after the agent's 18 s Vitest call | It fixed the stop tests. At 63 s it moved the pid suffix into a `pidOf` helper | Yes: 21 before the edit and after it |
| 74.3 | `PASS complexity: stopCommand (src/cli/stop.ts:45) is 20, at or under 20` | 0.5 s | Its final message: "Squeal shows `stopCommand` at complexity 20, within the limit." | Yes |

**sq2 (squeal, kind 2).** Task: refactor `runCommand` (27) to 20 or under. Load 23.2; 56 s.

| t | SQUEAL line | Edit to line | Agent's next action | Right? |
| --- | --- | --- | --- | --- |
| 0.5 | `Complexity: 80 functions over 20; squeal code lists them.` | — | — | No: 81 were over. The reset to the base ran while no daemon ran, and the new daemon registered the session before it had counted the reset (P2) |
| 25.8 | `FAIL complexity: stopCommand (src/cli/stop.ts:45) is 21, over 20 (ESLint rule)` | — (from the reset) | Its final message: "That was already over before my change and isn't part of this task, so I left it." | The count yes; the change was not the session's (P2) |
| 25.8 | `PASS complexity: runCommand (src/cli/run.ts:72) is 20, at or under 20` | 8.5 s. The PostToolBatch 0.5 s after the edit carried nothing; the daemon had started with the session and was catching up (inferred) | "`runCommand` is at 20. Now the tests and lint." | Yes. Its own `squeal code`, 5 s after the edit, had printed the old CC 27; it ran `sleep 5` and asked again (P4) |

**sq3 (squeal, kind 3).** Task: `squeal retry` ends with a `Queued N of M` summary. Load 23.9; 52 s.

| t | SQUEAL line | Edit to line | Agent's next action | Right? |
| --- | --- | --- | --- | --- |
| 27.7 | `FAIL complexity: retryCommand (src/cli/retry.ts:69) is 23, over 20 (ESLint rule)` | 0.7 s | It read the tests, then moved the summary into a `summaryLine` helper: 23 to 22. Nothing followed. Its final message: "Squeal had flagged `retryCommand` at 23 (limit 20), so I moved the summary into a `summaryLine` helper … I haven't confirmed the function is back under 20." | Yes: 20 before, 23, then 22, still over. The quiet after the fix is D5's rule (P3) |

**sq4 (squeal, kind 4).** Task: rename the helper `worktreeRoot` to `resolveWorktreeRoot` in 7 files. Load 22.9; 26 s.

| t | SQUEAL line | Edit to line | Agent's next action | Right? |
| --- | --- | --- | --- | --- |
| 10.7 | `STILL FAIL complexity: removeCommand (src/cli/remove.ts:44) is 28 after the edit; …`, the same for `runCommand` (27) and `stopCommand` (21) | 0.6 s | It went on to the tests. Its final message: "Squeal reported complexity warnings on `removeCommand`, `runCommand` and `stopCommand`. They were already over the limit of 20 before this change, and the rename didn't affect them." | Counts yes. Noise: the rename changed no count |

**sq5 (squeal, added).** Task: bring `removeCommand` (28) to 20 or under, one helper per edit, tests after each. Load 22.3; 71 s.

| t | SQUEAL line | Edit to line | Agent's next action | Right? |
| --- | --- | --- | --- | --- |
| 10.6 | `STILL FAIL complexity: removeCommand (src/cli/remove.ts:44) is 25 after the edit; …` | 0.7 s | It ran the tests and went on to the next helper | Yes; redundant, since the task was this refactor |
| — | nothing at 22, after the second round | — | Its own `squeal code` showed CC 22 | Yes: still over, quiet by D5 |
| 49.0 | `PASS complexity: removeCommand (src/cli/remove.ts:44) is 19, at or under 20` | 0.6 s | Final checks; "now at CC 19, down from 28" | Yes |

**sq6 (squeal, added).** Task: fast-forward the branch `work` from `ab376e7fd` to `dogfood`, then make `--reason` accept any letter case. Load 22.0; 24 s.

| t | SQUEAL line | Edit to line | Agent's next action | Right? |
| --- | --- | --- | --- | --- |
| 5.7 | `STILL FAIL complexity: namedLine (src/cli/status-wait-lines.ts:215) is 32 after the edit; …`, the same for `waitForNamed.<withStatusStore>` (48), `recordFocusedTier.<map>` (25) and `report` (32) | 2.3 s after the merge | It edited `parse` in `retry.ts`. It never mentioned the four lines | Counts yes: both sides counted, 30 to 32, 28 to 48, 25 to 25, 31 to 32, each body moved. "After the edit" no: the session never edited them (P1) |

**cz1 (cezar, kind 1).** Task: `parseUnifiedDiff` reads `copy from` and `copy to`. Load 20.7; 42 s.

| t | SQUEAL line | Edit to line | Agent's next action | Right? |
| --- | --- | --- | --- | --- |
| 25.4 | `STILL FAIL complexity: parseUnifiedDiff (packages/web/src/lib/unified-diff.ts:55) is 23 after the edit; it was already over 20 before it (ESLint rule)` | 1.2 s | It ran `tsc`. Its final message: "It was already over before this edit, and my two new branches added to it. I left that alone because you only asked for the copy support. Say so if you want the header handling split into a helper." | Yes: 21 to 23 |

**cz2 (cezar, kind 2).** Task: refactor `resolveNpmInvocation` (27) to 20 or under. Load 21.9; 23 s.

| t | SQUEAL line | Edit to line | Agent's next action | Right? |
| --- | --- | --- | --- | --- |
| 17.5 | `PASS complexity: resolveNpmInvocation (packages/cezar/src/application-update/npm-process.ts:58) is 13, at or under 20` | 1.1 s | Its final message: "The `squeal code` output I printed was from before Squeal re-measured the edit. Squeal's later message reported 13" (P4) | Yes: 13; the five new helpers are 6 to 8 |

**cz3 (cezar, kind 3).** Task: read `resets at noon` and `resets at midnight`. Load 22.9; 24 s. No complexity line, which was right. The agent put the new branch in the caller: `parseUsageLimit` went from 15 to 19 and `parseClockReset` from 19 to 18. Nothing crossed.

**cz4r (cezar, kind 4).** Task: map `.jpeg` to `image/jpeg` in `mediaTypeFor`, in the 560 KiB `run.ts`. Load 18.8; 257 s, most of it waiting for a test result.

| t | SQUEAL line | Edit to line | Agent's next action | Right? |
| --- | --- | --- | --- | --- |
| 8.7 | `packages/cezar/src/workflows/run.ts is 560 KiB, over the 512 KiB limit; its functions are not counted.` | 2.3 s from the `run.ts` edit; 1.0 s from the batch's last edit | It waited for its test with `squeal status --wait` | Yes; told once. The contaminated first run gave the same line at 9.0 s |

**cz5r (cezar, added).** Task: bring `discoverInstallation` (31) to 20 or under, one helper per edit, tests after each. Load 14.5; 36 s.

| t | SQUEAL line | Edit to line | Agent's next action | Right? |
| --- | --- | --- | --- | --- |
| 9.6 | `STILL FAIL complexity: discoverInstallation (packages/cezar/src/application-update/discovery.ts:25) is 29 after the edit; …` | 0.8 s | It ran the tests and made the next extraction | Yes; redundant |
| — | nothing at 23, after the second round | — | — | Yes: still over, quiet |
| 28.3 | `PASS complexity: discoverInstallation (packages/cezar/src/application-update/discovery.ts:43) is 20, at or under 20` | 0.7 s | Final checks; "down from a complexity of 31 to 20" | Yes. The line moved from 25 to 43 because a helper was added above it; the function kept its state |

**cz6 (cezar, kind 3, second try).** Task: the preview's status says `cannot connect` from the third attempt. Load 21.7; 71 s.

| t | SQUEAL line | Edit to line | Agent's next action | Right? |
| --- | --- | --- | --- | --- |
| — | nothing. `statusFor` went from 20 to 21; the code store recorded the crossing (`pass-to-fail`, revision 26) 2 s after the edit | — | It finished, with no word on complexity | No: a missed `FAIL`. The PostToolBatch at 65.5 s was cancelled at its 2 s timeout (2.14 s). The session's view still holds `statusFor` as `pass` (P5) |

### Cost and load

- **Counting CPU.** I timed the released counter (`git archive squeal--v0.1.284 src`) on both sides of every file the sessions changed. Each count was timed after a warm-up count of the same file. At load 16.8, over 32 files, it took 3.3 ms of CPU at the median and 7.5 ms at p95; at load 86, over 36 files, 7.1 ms and 13.5 ms. One count of every included file took 2.1 s of CPU in squeal (1,204 files) and 3.7 s in cezar (944 files), at load 29 to 32. That is inside goal 8 (5 ms, 20 ms and 5 s). The pass logs no timing of its own, so these are the counter's times, not the pass's.
- **Delivery cost.** A PostToolBatch hook that carried a code line took 0.63 s at the median in squeal (max 0.94 s, n 8) and 1.05 s in cezar (0.68 to 1.17 s, n 5). Other PostToolBatch hooks took 0.37 s and 0.57 s. Each registration seeds the view with every function: 11,727 rows in squeal and 16,246 in cezar. Rows of ended sessions stay: after the round the code stores held 70,484 and 129,979 view rows (P5).
- **The daemons' CPU** per session was 12 to 52 s. Nearly all of it was test runs and the listing of about 1,000 test files at each daemon start. The first start used 40 s and 47 s of CPU in 45 s; complexity is a few seconds of that.
- **Load.** At the starts: 20.7 to 23.9 under the gate, 14.5 to 22.0 after it. During the sessions the 30 s samples and the end readings ranged from 15.7 to 57.2; cz6 ended at 57. At the end of the round, after the last session, the host went to 96 from other work.

### Other observations

- **Parse errors.** squeal: three barrel files with `export type * from` (TypeScript 5.0) do not parse in the shipped grammar: `src/core/code/store/index.ts`, `src/core/code/pass/index.ts` and `src/core/types/index.ts`. They hold no function, so nothing is lost, but `squeal code` lists them as "does not parse". The fourth, `test/fixtures/node-test/edge/test/syntax.test.ts`, is broken on purpose. cezar has no `export type *`. Its one parse error is a raw NUL byte inside a string literal (`split('<NUL>')`, `packages/cezar/src/git-worktree.ts:351`), which leaves 1 function not judged (P6).
- **The first-count status line** reads `Complexity: 0 functions over 20; counting, 800 of 1204 files; squeal code lists them.` The "0 functions over 20" is not yet true; D6 gives `Complexity: counting, 340 of 600 files.`
- **Delivery titles.** A delivery of `STILL FAIL` lines alone is titled `SQUEAL · 3 complexity changes at revision 12`, though nothing changed state. A delivery with test failures and a `STILL FAIL` is titled `8 checks changed (8 tests)`, which leaves the code line out.
- **How Sonnet edits.** Most edits were Bash heredocs (`python3 - <<'E' … open(p,'w')`) or `sed -i`, not the Edit tool, unless the prompt named the Edit tool. The PreToolUse hook for Bash carries no SQUEAL text, so a Bash edit's line comes with the next PostToolBatch. In 2 of 13 deliveries that PostToolBatch came before the pass had stored the revision (0.4 s and 0.5 s after the edit), and the line waited for the agent's next tool call (21.4 s and 8.5 s).
- **Agents ran `squeal code` themselves** in 4 of 12 sessions, all four of them refactors (sq2, sq5, cz2, cz5r). No agent ran `squeal code --changed`.
- **Not complexity, seen on the way.** A daemon exits 3 s after its last session ends. In cz4r, Squeal had no result for `pasted-attachments.test.ts` after two waits (60 s and 120 s), and the agent ran `npm test` itself. A cezar test run by the daemon left a QA server and its lease watcher running after the daemon stopped (started 06:56Z, both stopped at the cleanup); this is the e2e-server leak already filed as cezarion #1448.

### Proposed rows

The numbers continue after 015-18; the coordinator assigns the final ones. None of these is fixed here.

| Row | Problem, with the evidence | Done when |
| --- | --- | --- |
| P1, 015-19 a pull is not the agent's edit | sq6: `git merge --ff-only` brought 4 `STILL FAIL … after the edit` lines (`namedLine`, `waitForNamed.<withStatusStore>`, `recordFocusedTier.<map>`, `report`). The session never edited them. These are the 4 functions `window.md` saw after a rebase. D6's rule takes any moved body as the agent's edit. Proposal: D6's first-edit rule skips a function whose new body matches its body at the new `HEAD`, when `HEAD` moved in the same revision (a pull, merge, rebase or checkout). A `FAIL` or `PASS` from such a revision is still delivered, as a test result would be. D6 amendment | A pass test: a revision that moves `HEAD` and changes a failing function's body to the committed one marks no edit, and the consumer gets no `STILL FAIL`. An edit in the working tree after it still gets one |
| P2, 015-20 a change made with no daemon is told as the session's | sq2: a `git reset --hard` made while no daemon ran (a daemon exits 3 s after its last session) was delivered as `FAIL complexity: stopCommand … is 21, over 20` 25.8 s into the next session. The registration said 80 over when 81 were. The SessionStart hook seeds the view from the store before the new daemon has counted the catch-up revision. Proposal: a registration made while the daemon's code pass has not reached the latest revision is seeded again, by count only, once the pass reaches it, as D6's summary re-seeds after a policy change. D6 amendment | An integration test: stop the daemon, change a function from 20 to 21, start a session (its hook starts the daemon), edit another file. The session gets no `FAIL` line for that function, and its registration count matches `squeal code` |
| P3, 015-21 a failed fix attempt is quiet | sq3: after `FAIL … retryCommand … is 23` the agent cut it to 22 and heard nothing. It ended with "I haven't confirmed the function is back under 20". D5 makes fail to fail quiet, and D7 keeps code out of Stop. Options, a product decision: (a) a function told `FAIL` in this session whose body moves again and stays over is told once more, as `STILL FAIL`; (b) the Stop hook, which cannot reach the model without blocking, names nothing, but the next delivery after such an edit says it once; (c) leave as is, since the agent could run `squeal code`. My default is (a) | With (a): a delivery test, `FAIL` at 23 then an edit to 22, gets one `STILL FAIL … is 22` line; a third edit to 21 is quiet |
| P4, 015-22 `squeal code` marks a count that is behind the file | sq2: 5 s after its edit, the agent's `squeal code src/cli/run.ts` printed `runCommand  CC 27 … over since revision 0` (the old count); it slept 5 s and asked again. cz2: "The `squeal code` output I printed was from before Squeal re-measured the edit". Proposal: `squeal code <path>` compares each file's bytes with its counted blob. When they differ, it waits up to 750 ms for the pass, as `squeal status <path>` waits for its own pass. If the count is still behind, the file says `pending: changed since revision N, not counted yet` | A CLI test: edit a counted file with no daemon pass; `squeal code <path>` prints the file as pending, not the old counts |
| P5, 015-23 a code delivery lost to the hook timeout; views of every function | cz6: `statusFor` went from 20 to 21 (stored `pass-to-fail`, revision 26), but the PostToolBatch hook was cancelled at 2.14 s and the session ended with its view still `pass`. In cezar a PostToolBatch with a code line took 1.05 s at the median, and one without took 0.57 s. Each session seeds about 16,250 view rows in cezar, and the rows of ended sessions stay (129,979 after 8 sessions). Proposal: seed and keep view rows only for functions over the threshold, since a missing row reads as `pass`; drop a consumer's code views at SessionEnd or with C7's departed consumers; and measure the hook's code step against its share of the 2 s budget | A delivery test on a store with 20,000 functions: a PostToolBatch with one code transition stays under 0.3 s on this host at ordinary load. A store test: after SessionEnd, the consumer has no view rows. A registration writes one view row per failing function |
| P6, 015-24 two parse errors that need not be | `export type * from` (TypeScript 5.0) does not parse in the shipped grammar, so 3 barrel files in squeal are listed as "does not parse" with 0 functions lost. A raw NUL byte in a string literal (cezar `git-worktree.ts:351`) leaves 1 function not judged. Proposal: update `tree-sitter-tsx` if a release parses `export type *`, and move `COUNTER_VERSION`; replace each NUL with a space before parsing, so offsets stay the same | A counter fixture with `export type * from "./x.js"` and a string holding a NUL: both parse, and the function after the NUL is counted |

Two smaller points belong in whichever row touches the wording next, not in rows of their own: the first-count status line should not say "0 functions over 20" while counting, and a delivery title should not count `STILL FAIL` lines as changes, or leave code lines out of the count.

### For the next worker

- Part B (the passive working day) still runs on the real sessions. These sessions add the questions above to its tables. P1 and P2 should be counted there as well: how many `STILL FAIL` lines followed a pull, and how many `FAIL` or `PASS` lines came from a catch-up.
- After a reset or checkout between sessions, start a daemon and wait for `squeal status --wait` before the next session starts. Without that, the next session's registration is stale (P2). Never run two sessions in one clone.
- The raw streams, the transcripts and copies of both code stores stay under `/home/squeal-e2e/runs/d1510/` (`claude/projects/`, `evidence/`) and `/tmp/dogfood-015-10/w-4ddd4e37/logs/` while the host keeps them. The clones were removed after `squeal stop` in each.

## Round 1 (015-10)

Task 015-10 Part B, 2026-10-24, worker 6ee42e2a. The passive working day: every real agent session in this repository and in cezar while complexity was on, from the switch-on to this task's dispatch. The brief is `tasks/wave-1.md`, "015-10", Part B and its additions. The sources, the methods, every line with its verdict, the table per worktree and the scripts are in `tasks/015-10/part-b.md` and `tasks/015-10/part-b/bin/`. Each SQUEAL line quoted here is copied from a transcript. Function counts come from the code stores and from the released counters.

### Verdict

Keep complexity. When the agent's own edit makes the change, the lines are right and agents use them. Most noise came from changes the agent did not make, and 0.1.292 removed most of it.

- **Lines.** 80 complexity lines reached agents, registration and other-side lines left out: 37 `STILL FAIL`, 11 `PASS`, 2 `FAIL`, 2 `RESOLVED`, 9 too-big lines and 19 summaries. Verdicts: 9 useful, 6 redundant, 28 unclear, 37 noise.
- **Where the noise came from.** 24 of the 37 noise lines came from a pull, rebase, switch or merge in the session (Part C's P1). 9 were too-big lines for a file no session edited (B3). 2 came from a change the session did not make, and 2 repeated a summary (B4). No line was noise because of what the counter counts.
- **Acted on.** Five agents changed code because of complexity output: 22 to 11, 21 to 2, 29 to 20, 22 to 18, and 20 to 19. Two more weighed a line and chose; one of them filed the issue that a later task used to take `SessionActivityCard` from 87 to 3. No agent treated a complexity line as a test failure. No agent stopped its task for one.
- **0.1.292 worked.** `STILL FAIL` after a pull: 17 of 30 lines before 0.1.292, 1 of 7 after. PostToolBatch hooks cancelled at the 2 s timeout in cezar: 216 of 671 tool batches (32%) before 0.1.292, 0 of 180 after. 5 of the 16 stored cezar transitions never reached the agent, all of them before 0.1.292.
- **Identity and churn.** No function over 20 lost its identity in 115 commits. One crossing came back within two edits, and it came back because the agent acted on it.

Four defects and one product choice remain. Each is a proposed row below.

- **B1. A merge that stops on a conflict reads as the agent's edit.** `HEAD` has not moved, so 015-19 does not apply. The only `STILL FAIL` from a pull after 0.1.292 is this case. The same revision told 3 `PASS` and 1 `RESOLVED` for code the session never touched.
- **B2. A new worktree's registration says `0 functions over 20`.** 53 of 55 worker worktrees registered their first session with it, in every version from 0.1.284 to 0.1.294. 1 of the 53 was corrected later.
- **B3. A too-big line comes with no edit.** 9 of 9 came with a first count, a recount or a resumed process, for cezar's `run.ts`, which no session edited.
- **B4. A recount summary is told twice.** 2 of the 9 sessions that got the new counter's summary got it twice.
- **B5 (a product choice). `FAIL`, `PASS` and `RESOLVED` from a pull.** 015-19 keeps them on purpose. 8 such lines reached agents, and no agent used one.

The questions:

- **status.md question 1, "Can the code squeal as well?"** Yes, for complexity. On a working day, 9 lines were useful and 5 code changes came from complexity output. No line was read as a test failure. Two things made it noisy: pulls inside sessions and lost hooks. 0.1.292 fixed most of both; B1 to B4 are the rest.
- **status.md question 2, "Is the gain worth the CPU per run?"** For complexity, yes. The released counter took 1.9 ms of CPU at the median and 6.4 ms at p95 per changed file here (185 files), inside goal 8. In cezar it took 5.6 to 6.9 ms and 25 to 34 ms (66 files). That is over goal 8's numbers, but cezar's changed files are three times as large (median 20 KiB, against 6 KiB here), and goal 8 is set on this repository's files. The coverage half of the question is wave 2's.
- **Open question 1 (`?.`, `??` and defaults).** Keep counting them, as the human decided on 2026-10-24. 1 of the 2 `FAIL` lines and 6 of the 37 `STILL FAIL` lines exist only because of `?.` and defaults. The one `FAIL` led to a fix. None of the 7 was noise because of these kinds.
- **Open question 2 (`STILL FAIL`).** Keep it, and fix B1. 17 of the 37 lines came from the agent's own edit. 3 of the 17 led to a fix, 2 informed a choice, and 9 were ignored with no harm. 18 came from a pull, 17 of them before 0.1.292.
- **Open question 4 (churn).** Keep immediate delivery. 1 crossing came back within two edits, because the agent acted on its `FAIL`. A two-edit hold would have delayed the `FAIL` that caused the fix.

### Sources and windows

| Item | Value |
| --- | --- |
| Windows | This repository from 03:55Z. cezar's main checkout from 06:26Z and its worktrees from 07:31Z, counted apart. All end at 16:49Z, this task's dispatch |
| Transcripts | Claude Code under `~/.claude/projects/-home-agent-projects-squeal*` and `-home-agent-projects-cezar*`; Codex under `~/.codex/sessions/2026/10/24/` |
| Stores | Each repository's `<git-common-dir>/squeal/code.sqlite`, opened read only |
| Versions | Claude Code hook paths read `${CLAUDE_PLUGIN_ROOT}`, so a line's version is the newest in the plugin cache at its process's latest start (a SessionStart hook or an `instructions` attachment). Checked: no line's wording disagrees with its version. Codex: the skill path, a lower bound, since the Codex launcher runs the newest installed version. No Codex transition line falls near 0.1.292 |
| Counters | 0.1.283 (`git archive squeal--v0.1.283`) for the CPU; 0.1.294 for identity and question 1 |
| Not judged | Registration lines (B2), the 21 other-side lines of 015-27, and the 516 Haiku helper sessions in the two main checkouts, which got the registration line only |

| Group | Claude Code | Codex |
| --- | --- | --- |
| This repository, worktrees | 50 worker and coordinator sessions | 18 reviewer sessions |
| This repository, main checkout | 416 Haiku helpers | 0 |
| cezar main checkout, 06:26 to 07:31Z | 19 Haiku helpers | 1 (it got the first count) |
| cezar worktrees, 06:26 to 07:31Z | 2 | 0 |
| cezar main checkout, from 07:31Z | 81 Haiku helpers | 3 |
| cezar worktrees, from 07:31Z | 13 | 8 |

The cezar sample is thin, and cezar has a complexity gate of its own: its `check-code-quality` skill fails a function over 20 before a pull request and asks for an "inherited-refactor" issue.

### The table per repository

Sessions are counted in each period they had a tool call in. "Other side" is 015-27's lines: complexity on a test delivery, then tests on a code delivery. These are not judged.

**This repository.**

| Period | Sessions (Claude Code + Codex) | With a line | `FAIL` | `PASS` | `STILL FAIL` | `RESOLVED` | Too big | Summary | Other side | Useful | Redundant | Unclear | Noise |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Before 0.1.292 | 31 + 8 | 12 | 2 | 2 | 16 | 0 | 0 | 4 | 0 | 5 | 0 | 9 | 10 |
| 0.1.292 and later | 21 + 10 | 8 | 0 | 1 | 6 | 0 | 0 | 4 | 12 + 2 | 2 | 0 | 9 | 0 |

**cezar.**

| Period | Sessions (Claude Code + Codex) | With a line | `FAIL` | `PASS` | `STILL FAIL` | `RESOLVED` | Too big | Summary | Other side | Useful | Redundant | Unclear | Noise |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Main checkout, 06:26 to 07:31Z | 0 + 1 | 1 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 0 | 0 | 1 | 1 |
| Worktrees, 06:26 to 07:31Z | 2 + 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| From 07:31Z, before 0.1.292 | 8 + 8 | 9 | 0 | 4 | 14 | 1 | 2 | 3 | 0 | 2 | 6 | 3 | 13 |
| 0.1.292 and later | 10 + 3 | 7 | 0 | 4 | 1 | 1 | 6 | 7 | 1 + 6 | 0 | 0 | 6 | 13 |

**By version.** No session on 0.1.294 got a complexity line; it reached the cache at 16:14Z.

| Repository | Version | `FAIL` | `PASS` | `STILL FAIL` | `RESOLVED` | Too big | Summary | Useful | Redundant | Unclear | Noise |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| This repository | 0.1.279 (one Codex session; a lower bound) | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 0 |
| This repository | 0.1.284 | 0 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 2 | 0 |
| This repository | 0.1.286 | 1 | 2 | 9 | 0 | 0 | 1 | 5 | 0 | 3 | 5 |
| This repository | 0.1.287 | 1 | 0 | 4 | 0 | 0 | 0 | 0 | 0 | 1 | 4 |
| This repository | 0.1.288 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| This repository | 0.1.289 | 0 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 1 | 1 |
| This repository | 0.1.292 | 0 | 0 | 4 | 0 | 0 | 4 | 0 | 0 | 8 | 0 |
| This repository | 0.1.293 | 0 | 1 | 2 | 0 | 0 | 0 | 2 | 0 | 1 | 0 |
| cezar | 0.1.286 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 0 | 1 | 1 |
| cezar | 0.1.287 | 0 | 1 | 5 | 0 | 0 | 0 | 0 | 2 | 0 | 4 |
| cezar | 0.1.288 | 0 | 2 | 4 | 1 | 0 | 0 | 1 | 3 | 0 | 3 |
| cezar | 0.1.289 | 0 | 1 | 5 | 0 | 2 | 3 | 1 | 1 | 3 | 6 |
| cezar | 0.1.292 | 0 | 3 | 1 | 1 | 6 | 7 | 0 | 0 | 6 | 12 |
| cezar | 0.1.293 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |

How I judged a line. **Useful**: the agent acted on it or used it to choose, or it confirmed the agent's fix. **Redundant**: true, but the agent already knew it, from its task or from cezar's own check. **Unclear**: true and about the agent's own edit, but the agent did not react. Summaries are unclear unless repeated. **Noise**: it named a change the agent did not make, or repeated a line already told.

### Open question 1: `?.`, `??` and defaults

The store keeps decision points by kind. `??` is stored inside `logical`, so the counts below without `?.` and defaults are upper bounds of what is left, and the shares are lower bounds.

- **`FAIL`.** 1 of 2 lines exists only because of `?.`: `planCodeDelta` is 22 with 3 optional chains, 19 without them. The agent split it, to 11. The other `FAIL`, `readPnpmLockfile` at 58, came from a rebase and stays over either way.
- **`STILL FAIL`.** 6 of 37 lines exist only because of `?.` and defaults: `recordFocusedTier.<map>` 25 (20 without; a pull), `vitestCase` 21 (19; a pull), `vitestCase` 22 twice (20), `TierYields.#decide` 21 (20) and `LockFilePool.acquire` 22 (19). The 2 from a pull were noise because of the pull. The 4 from own edits were unclear, as most own-edit lines were.
- **The trees at the window's end**, test files left out: here 17 of 82 functions over 20 (21%) are over only because of `?.` and defaults, and 34 (41%) when `??` is estimated from the text. In cezar, 45 of 261 (17%) and 83 (32%).

### Open question 2: `STILL FAIL`

| Cause of the line | Before 0.1.292 | 0.1.292 and later |
| --- | --- | --- |
| A pull, rebase, switch or merge in the session | 17 | 1 (B1) |
| A change the session did not make | 2 | 0 |
| The agent's own edit | 11 | 6 |

The 17 lines from the agent's own edit:

- 3 led to a fix: `stalePnpmLockfile` 21 to 2, `SkillsCatalog` 29 to 20, `TierYields.#decide` 22 to 18.
- 2 informed a choice. 09eb6544 left `createDelivery.deliver.<transaction>` (44) alone as "not mine to split". 0829604a filed cezar issue #1608 for `SessionActivityCard` (87), as cezar's own check asks.
- 1 was redundant: Codex 87018a36 split `PendingAsk` 28 to 19, but cezar's own quality check had already asked for it.
- 2 were unclear. 32fe48c6 was told `#decide` during a mutation check, and again in a new process. 709075cc moved a ternary out of `vitestCase` (22 to 21) 6 s after its line and said nothing about it.
- 9 were ignored. Each was true: the function was over before, and the agent's task was elsewhere.

Under 0.1.292 and later, 6 of the 7 lines came from the agent's own edit, and all 6 carried the quiet hint. One of them led to a fix (`#decide`).

The 2 from a change the session did not make: 9354f23b got `waitForNamed.<withStatusStore>` (44) for a file it had not written, with no cause visible in its transcript. A Codex session in cezar's main checkout got `describeWaitParity.<describe>` (25) when other actors changed the shared checkout, which is D6's stated limit.

### Open question 4: churn

- **Within a session.** 1 crossing came back within two edits. 09eb6544 took `planCodeDelta` from 17 to 22 (`FAIL`), then to 21 (quiet), then to 11 (`PASS`). It came back because the agent acted on the `FAIL`. No other function crossed and came back.
- **Across commits.** `stalePnpmLockfile` went from 13 to 24 to 2 in two consecutive commits of 78026511, which landed together.

### P1 and P2

| Count | Before 0.1.292 | 0.1.292 and later |
| --- | --- | --- |
| `STILL FAIL` lines after a pull (P1) | 17 of 30 | 1 of 7, the conflicted merge (B1) |
| `FAIL`, `PASS` or `RESOLVED` lines from a pull | 3: 1 `FAIL`, 2 `PASS` | 5: 4 `PASS`, 1 `RESOLVED`; 4 of the 5 from the conflicted merge |
| `FAIL` or `PASS` lines from a catch-up (P2) | 0 | 0 |

No agent used a line that came from a pull. The 2 pulled `STILL FAIL` lines that were redundant, not noise, named the function the agent's task was about. The coordinator recorded 5 pulled lines as dogfood cases.

### For 015-26: edits while a function stays over

- 7 `STILL FAIL` lines carried the quiet hint, all under 0.1.292 and later.
- **0 of the 7 functions** got a third or later body edit while still over after the hint.
- 2 got one more body edit, and in both the agent was working on that function for its task. 709075cc moved a ternary out of `vitestCase` (22 to 21). 3dd9fc58 renamed a variable in `selectTier` (81).

The count does not support a subscription row. Part C's three-round refactors (sq5, cz5r) ran before the hint, on 0.1.284.

### Acted on

| Worker (row) | Version | Function | CC | What Squeal said | The agent's sentence |
| --- | --- | --- | --- | --- | --- |
| 09eb6544 (015-20) | 0.1.286 | `planCodeDelta`, `src/core/delivery/code-delta.ts` | 17, 22, 11 | `FAIL complexity: planCodeDelta (src/core/delivery/code-delta.ts:115) is 22, over 20 (ESLint rule)` | "Squeal flags my own edit: `planCodeDelta` is now 22. Splitting the per-state step into its own function." |
| 78026511 (011-165 to 011-167) | 0.1.286 | `stalePnpmLockfile`, `src/core/keys/pnpm-install.ts` | 21, 2 | `STILL FAIL complexity: stalePnpmLockfile (src/core/keys/pnpm-install.ts:92) is 21 after the edit; it was already over 20 before it (ESLint rule)` | "Squeal also reports `stalePnpmLockfile` at complexity 21, over the limit of 20, so I will split it." |
| e71c2637 (cezar, skills grouping) | 0.1.289 | `SkillsCatalog`, `packages/web/src/routes/skills.tsx` | 38 at the task's base, 29, 20 | `STILL FAIL complexity: SkillsCatalog (packages/web/src/routes/skills.tsx:90) is 29 after the edit; …` | "All 47 route tests pass, and no function in my files is over the complexity limit now." Its `PASS` was lost to 4 cancelled hooks |
| d16e9716 (011-184) | 0.1.293 | `TierYields.#decide`, `src/core/scheduler/yields.ts` | 22, 18 | `STILL FAIL complexity: TierYields.#decide (src/core/scheduler/yields.ts:182) is 22 after the edit; …`, with the quiet hint | "`#decide` was already over Squeal's complexity threshold of 20 before my change and is 22 now." |
| f9416aba (015-31) | 0.1.292 | `judge` | 18, 20, 19 | No line: 20 is at the threshold, so nothing crossed. The agent read it from its own `squeal code` call | "`judge` is now CC 20, exactly at the threshold; it was 18." |

Not counted as caused by Squeal: Codex 87018a36's `PendingAsk` (28 to 19), which cezar's own check drove; ae23d48c's `SessionActivityCard` (87 to 3), the task made from issue #1608; and `reduceThread` (203 to 6) and `NewTaskRoute` (88 to 13), which were the tasks themselves.

### Identity

I walked every window commit with the 0.1.294 counter: 99 here and 16 in cezar.

- Body-hash moves matched: 55 here and 66 in cezar. None of the moved functions was over 20.
- Removals with no match: 61 here (39 anonymous) and 72 in cezar (53 anonymous). None was over 20, except cezar's `reduceThread.upsertConversation`. It moved and changed (27 to 2) in one edit, which D2 accepts as removed plus new. The agent got `RESOLVED` for it.
- **Identity losses over the threshold: 0.** Anonymous names that changed over the threshold: 0.

### Cost and lost hooks

- **Counting CPU.** The pass logs no timing of its own, so I timed the released 0.1.283 counter on both sides of every file the window changed, after a warm-up count of each.

| Repository | Files | Median file size | CPU per file, median | CPU per file, p95 | CPU per commit, median | CPU per commit, p95 | Load |
| --- | --- | --- | --- | --- | --- | --- | --- |
| This repository | 185 | 6.3 KiB | 1.9 ms | 6.4 ms | 7.1 ms | 23.7 ms | 4.4 to 5.2 |
| cezar | 66 | 19.7 KiB | 5.6 to 6.2 ms | 25 to 34 ms | 53 ms | 150 ms | 4.4 to 5.2 |
| cezar, again | 66 | 19.7 KiB | 6.9 ms | 28.5 ms | — | — | 10.8 |

- **Lost hooks.** A PostToolBatch hook cancelled at its 2 s timeout loses its delivery (Part C's P5).

| Repository | Before 0.1.292 | 0.1.292 and later |
| --- | --- | --- |
| cezar | 216 of 671 tool batches (32%); 207 of 604 (34%) from 07:31Z to 12:04Z | 0 of 180 |
| This repository | 31 of 3,419 (0.9%) | 0 of 1,708 |

In cezar's worktrees with a session, the store holds 16 transitions from the window. 10 were told, 1 was folded into a recount summary, and 5 never reached the agent, all before 0.1.292: `PendingAsk` in 0829604a and in f475e065, `NewTaskRoute` in f475e065, `SkillsCatalog` in e71c2637 and `SessionActivityCard` in ae23d48c. Here, 5 of 8 transitions were told, and the other 3 (first seen) were folded into a first-count summary.

- **Store size.** The code store here is 341 MB. 55 removed worktrees still hold 651,460 of its 780,283 `states` rows, 66,562 `files` rows and 153,056 view rows. 13 departed consumers from before 0.1.292 hold about 11,700 view rows each. cezar's store is 142 MB, with 146,672 `states` rows for 9 removed worktrees. Released daemons never call `prune.ts`; 015-11 adds its first caller (in review as 0.1.295). No new row.

### Other observations

- **Other-side lines.** 21 reached agents, all under 0.1.292 and later: 13 on complexity and 8 on tests. No agent ran `squeal code --told`. 3dd9fc58 got `Complexity: 2 functions over 20 that this session was told about; …` 7 times in 19 minutes, which is the rule as written.
- **The registration line** (B2): 90 registration lines in worker worktrees, 53 of them `Complexity: 0 functions over 20; squeal code lists them.` while this repository had 82 such functions and cezar about 265. f9416aba registered with 0 at 14:42Z; its `squeal status` said 82 at 15:02Z. The other 37 registration lines, mostly from later processes in the same worktrees, gave a count above 0.
- **cezar's own gate** made 1 `STILL FAIL` redundant (`PendingAsk`), and made 1 useful: the agent filed the issue cezar's check asks for (`SessionActivityCard`).
- **Recounts.** The counter's version moved during the day. The summary `Complexity counted again by a new counter: N functions over 20; squeal code lists them.` reached cezar sessions at 12:03Z to 13:42Z and this repository at 13:54Z. No agent acted on one.

### Proposed rows

The numbers continue after 015-33; the coordinator assigns the final ones. None of these is fixed here.

| Row | Problem, with the evidence | Done when |
| --- | --- | --- |
| B1, 015-34 a merge stopped by a conflict is not the agent's edit | f475e065, 13:51Z, 0.1.292: `git merge origin/main` stopped on a conflict. The revision told `PASS` for `SessionActivityCard`, `SkillsCatalog` and `reduceThread`, `RESOLVED` for `reduceThread.upsertConversation`, and `STILL FAIL complexity: ThreadView (packages/web/src/routes/task-thread/task-thread.tsx:178) is 78 after the edit; …`, all for code the session never touched. `HEAD` had not moved, so 015-19's rule did not apply. Proposal: while `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD` or `REBASE_HEAD` exists, a file equal to its blob at that commit marks no edit, as 015-19 does for a moved `HEAD`. D6 amendment | A pass test: a merge that stops on a conflict and brings a failing function's committed body marks no edit, and the consumer gets no `STILL FAIL`. An edit to that function after it still gets one |
| B2, 015-35 a new worktree registers with 0 functions over 20 | 53 of 90 registration lines in worker worktrees said `Complexity: 0 functions over 20; squeal code lists them.`, in 53 of 55 worktrees' first sessions and every version from 0.1.284 to 0.1.294. This repository had 82 such functions and cezar about 265. 1 of the 53 got a `Complexity counted:` line later. f9416aba registered 0 at 14:42Z, and its `squeal status` said 82 at 15:02Z. Part C saw the same wording while counting. The cause is inferred: the registration reads a worktree that has no counts yet. Proposal: until a worktree's first count ends, its registration says `Complexity: counting has not started.` (or D6's `counting, N of M files`); the first count's end then tells each session registered before it one `Complexity counted: N functions over 20` line | An integration test: a new worktree with complexity on and a session registered before its first count. The session gets no `0 functions` line, and gets one `Complexity counted:` line with the right number after the count |
| B3, 015-36 a too-big line with no edit | 9 of 9 too-big lines, all `packages/cezar/src/workflows/run.ts is 560 KiB, over the 512 KiB limit; its functions are not counted.`, came with a first count (1), a counter recount (6) or a resumed process (2: d0a78289 at 13:40Z, f475e065 at 13:50Z). No session and no window commit edited `run.ts`. Part C's cz4r got it once, for its own edit, which is right. Proposal: tell a too-big line only for an edit to that file after the session registered; a resumed session keeps what it was told | Delivery tests: a recount and a resumed session tell no too-big line for a file not edited; an edit to that file tells one |
| B4, 015-37 a recount summary told twice | 2 of the 9 sessions that got `Complexity counted again by a new counter: …` got it twice: f475e065 at 12:11:22Z and 12:11:42Z, both at revision 4, and Codex 1c9c2ead at 12:03:48Z and 12:03:49Z. The cause is not verified. Proposal: the transaction that tells the summary compares and sets the consumer's seed, so a second hook finds it told | A delivery test: two hooks deliver at once after a recount, and exactly one carries the summary |
| B5, 015-38 transitions from a pull (a product choice) | 8 `FAIL`, `PASS` or `RESOLVED` lines came from a pull, rebase, switch or merge: `FAIL complexity: readPnpmLockfile (src/core/keys/pnpm-lockfile.ts:87) is 58, over 20` after a rebase, and 7 `PASS` or `RESOLVED` for functions the session never touched. No agent used one. 015-19 keeps them on purpose, "as a test result would be". Options: (a) a `PASS` or `RESOLVED` from a pull, for a function the session was not told about, is taken in by count and not told, while a `FAIL` from a pull is still told; (b) all three are taken in by count; (c) leave as is. My default is (a) | With (a): a delivery test where a pull takes a counted failing function under 20 tells nothing, and a pull that brings a new function over 20 tells `FAIL` |

Seen and not made rows: P5's lost deliveries look fixed by 0.1.292 (above); the code store's retention waits for 015-11's prune caller; a shared main checkout reads other actors' changes as the session's, as D6 states; 9354f23b's one line has no visible cause.

### For the next worker

- Count again after B1 to B4 land and after 015-11's prune caller is released. This window has no line from 0.1.294.
- Read a Claude Code session's version from its process starts, not from its first start: cezar resumes restart the process, and one session crossed four versions. An `environment` attachment is not a start; it comes with every change of directory.
- The raw data stays under `/tmp/dogfood-015-10/w-6ee42e2a/out/` while the host keeps it. `tasks/015-10/part-b.md` lists the files and holds every line with its verdict.
