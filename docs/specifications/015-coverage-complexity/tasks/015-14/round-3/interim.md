# 015-14 Round 3, interim reading: 3.4 hours of 0.1.366 activity

Worker d3937b73, 2026-10-27, from `tasks/wave-23.md` W2, on the coordinator's request after its 11:40 UTC snapshot. A bounded interim reading, not the working-day count: it has no verdict on coverage as a default. `notes.md` and `lessons.md` are unchanged. Scripts are in `data/interim-bin/`, outputs in `data/interim-*`.

## Answer

- **One session got coverage lines, and all 10 were useful by Round 2's rules.** Worker cd415cf8 (row 002-29, Claude Code, 0.1.366 hooks) got 5 FAIL lines at 11:26:47Z. 27 s later it wrote a test that runs the flagged functions in the test's own thread. The 5 PASS lines at 11:27:29Z confirm that fix. This is one session: a sample of 1, not a rate.
- **Five sessions edited source files that coverage measures, and four of them got no coverage line.** They are all Claude Code workers on 0.1.366 hooks. The four got no code-change header at all: coverage stayed silent, which is not noise. No Codex session edited a measured `src/` file itself.
- **Every record with a recorded daemon came from 0.1.366.** 3,026 coverage records were stored from 08:23:46Z to 11:51:52Z, all manifests, none full. 1,550 came from runs of daemons that a store reading recorded as 0.1.366. 1,476 came from daemons no reading recorded: four worktrees removed before 11:40Z, and one earlier daemon. All their runs started after the host restart and before 0.1.367 reached any plugin cache. 0 came from 0.1.367.
- **Drop notes exist; the probe that found none read the wrong key.** `round-3/bin/store.mjs` reads meta keys `notes:%`. The notes are under `notes.<worktree id>` (`src/core/types/store.ts`, prefix `notes.`), so its `dropNotes` was empty whatever the store held. That includes the first stage's readings and the coordinator's 11:40:22Z snapshot. Read with the right key, six worktrees hold 16 `coverage:no-record` notes from the window. Their latest totals: 79 test files with no record (75 `no-result`, 4 `closed`). The four removed worktrees' notes are gone.
- **No 0.1.367 sample exists.** 0.1.367 reached the Claude Code cache at 11:40:33Z, and was not in the Codex cache at 11:44Z. In the window, 3 Haiku helper sessions in the main checkout used 0.1.367 hooks (5 deliveries, no code line). No worktree session used them, and no 0.1.367 daemon stored a record.

## Window and population

- **Window:** 2026-10-27T08:23:46Z (the first session whose 0.1.366 daemon kept running) to 11:46:36Z for the transcripts: 3 h 22 min 50 s, 3.38 h. Store readings: 11:51:31Z to 11:53:19Z.
- **Left out:** this worker's own session and its worktree's daemon (0.1.366, then 0.1.367 from 11:42:15Z; it stored 0 records in the window).
- **Version rules (Round 1):**
  - A Claude Code delivery takes the newest cache entry at its process's latest start.
  - A Codex delivery takes the newest Squeal version its rollout named at or before it. Round 2 took the first one; this reading takes the latest, so a session that moved to 0.1.366 counts as 0.1.366 from then on.
- **Daemon version of a run:** proven when a store reading recorded a daemon of that worktree that started at or before the run and was still heartbeating then. The readings are 08:53Z (`store-baseline-2.json`), the coordinator's 11:40:22Z snapshot, and 11:44:30Z and 11:51:31Z (this reading).

| Plugin cache | 0.1.366 born | 0.1.367 born |
| --- | --- | --- |
| Claude Code | 07:37:52Z | 11:40:33Z (install record 11:40:33.840Z, commit `6709eb4d7`) |
| Codex | 07:50:50Z (versions directory 07:52:51Z) | not present at 11:44Z |

## Sessions (this repository, the window)

`data/interim-sessions.json`, from `bin/window.py`.

| Where | Harness, model | Hook version | Sessions | Deliveries | Sessions that edited measured `src/` | Coverage lines | Complexity lines |
| --- | --- | --- | --- | --- | --- | --- | --- |
| worktrees | Claude Code, Opus | 0.1.366 | 8 | 69 | 5 | 10 (1 session) | 2 (same session) |
| worktrees | Codex, gpt-6 and gpt-6.1 | 0.1.366 | 11 | 58 | 0 | 0 | 0 |
| main checkout | Claude Code, Haiku helpers | 0.1.366 | 81 | 81 | 0 | 0 | 0 |
| main checkout | Claude Code, Haiku helpers | 0.1.367 | 3 | 5 | 0 | 0 | 0 |

- **A source edit** is a write in the window to a path of the session's own checkout, taken from the written path only:
  - Edit, Write or MultiEdit;
  - an `apply_patch` header;
  - the file of `sed -i`;
  - `p = '<path>'` in a command with `open(p, 'w')`;
  - a redirect or `tee` target.

  A cherry-pick is not an edit.
- **Measured `src/`** is `src/` outside `coverage.exclude`.
- **The five sessions:** workers 19fa731c (9 measured files), cd415cf8 (7), dee1b657 (7), 2cb095fe (5) and 57d984a6 (2). 57d984a6 and dee1b657 were still working at the window's end.
- **Edits outside measured `src/`:** worker 1b2ca269 edited 3 test files only, and coordinator 5df9d46d edited 1 test file and cherry-picked `src/` changes.
- **Other repositories** have coverage off: cezar had 54 Claude Code sessions and 12 Codex sessions, toolkit-dev 1. The 8 complexity lines in cezar's Codex sessions are not judged here.

## Coverage lines and their verdicts

`data/interim-judged.json`, from `bin/lines.py`, `bin/cases.py` and `bin/tally.py`. These are Round 2's scripts with the window as an argument, and with `Code:` lines counted as summaries (015-84). The verdicts follow Round 2's rules (`part-b.md`, "How a line was judged").

| Session | Line | Squeal text (shortened) | Cause | Verdict |
| --- | --- | --- | --- | --- |
| cd415cf8 | 11:26:47 FAIL CRAP | `fields (src/harness/codex/adapter/index.ts:98): 72, over 30 (complexity 8; no test runs it in the test's own thread; 6 test files load this file)` | own | useful, acted on |
| cd415cf8 | 11:26:47 FAIL CRAP | `runAdapterHook (src/harness/codex/adapter/index.ts:52): 306, over 30` | own | useful, acted on |
| cd415cf8 | 11:26:47 FAIL CRAP | `usesSquealAt (src/harness/codex/adapter/repository.ts:24): 132, over 30` | own | useful, acted on |
| cd415cf8 | 11:26:47 FAIL untested | `debug (src/harness/codex/adapter/index.ts:143): no test runs it in the test's own thread; 6 test files load this file` | own | useful, acted on |
| cd415cf8 | 11:26:47 FAIL untested | `diagnose (src/harness/codex/adapter/index.ts:133)` | own | useful, acted on |
| cd415cf8 | 11:27:29 PASS untested | `debug ...: test/harness/codex/adapter/in-process.test.ts runs it in its own thread` | own | useful, confirms the fix |
| cd415cf8 | 11:27:29 PASS untested | `diagnose ...` (the same) | own | useful, confirms the fix |
| cd415cf8 | 11:27:29 PASS untested | `diagnosticText (src/harness/codex/adapter/index.ts:128)` (the same) | own | useful, confirms the fix (its FAIL was among the "11 more code changes" not listed) |
| cd415cf8 | 11:27:29 PASS untested | `fields`: the same | own | useful, confirms the fix |
| cd415cf8 | 11:27:29 PASS CRAP | `fields`: `8, at or under 30` | own | useful, confirms the fix |

- **The case.** The 11:26:47Z delivery listed 5 of "16 code changes". The agent wrote `test/harness/codex/adapter/in-process.test.ts` at 11:27:14Z and committed it at 11:27:57Z. The agent's one sentence for this case is the commit subject: "test(002-29): adapter dispatch and repository test in the test's thread". At 11:28:09Z its `squeal code --changed` read `runAdapterHook` CRAP 17.7 and `usesSquealAt` CRAP 11.1 as passing. So all five FAIL lines were acted on, including the two whose PASS was not delivered as a line. No agent text before 11:26:47Z planned an in-process test.
- **The rule order matters.** Round 2's automatic "transient" rule would call each FAIL that a PASS reversed within 180 s noise, but that rule needs "no action". `bin/tally.py` therefore puts the cases found by reading first, as Round 2 did with its `RELAYED` and `CHOSE` cases.
- **Complexity lines.** The same session got 2 lines, on its own edit: FAIL `parseManifest ... is 21, over 20` at 11:15:51Z and PASS `... is 13` at 11:16:32Z. Round 2's tally marks own-edit complexity lines unclear. Read, the agent acted on it: "Squeal flags `parseManifest` at complexity 21 (limit 20)."
- **Against Round 2.** Round 2 had 178 coverage lines in 22.1 h, to 20 of 105 worktree sessions: 5 useful, 109 noise, 64 unclear. This window has 10 lines in 3.38 h, to 1 of 19 worktree sessions: 10 useful. One session cannot confirm a change in the rate. It shows one case of the 015-80 wording ("in the test's own thread") leading straight to a test.

## Repeated summaries, told-over lines and loader accounts

| Check | This repository's worktree sessions | Main checkout |
| --- | --- | --- |
| Told-over lines (`Code: ... that this session was told about`, 015-84) | 0 | 0 |
| Registration summaries (`Complexity: N functions over 20; ...`) | 11: 6 first, 5 repeats (Codex sessions 8b2a8995, a1964cc6 and 3dc8d717, each registering again) | 84, each the first in its helper session |
| `Complexity: counting has not started.` and `Complexity counted: ...` | 32, each the first in its session | 0 |
| Deliveries naming one file with two loader accounts (015-81) | 0 of 2 file mentions with a loader account | none |

By Round 2's rule the 5 repeated registration summaries are noise and the first ones unclear. cezar's Codex sessions got 3 told-over lines, 1 of them a repeat. cezar has coverage off, so it has complexity only.

## Records by worktree and daemon version

`data/interim-records-versions.json` (`bin/records_versions.mjs`), read at 11:51:52Z. A record's producer is the result at its key recorded last at or before the record.

| Worktree (task, harness) | Records | Bytes | Runs | Daemon version |
| --- | --- | --- | --- | --- |
| 2cb095fe (worker 005-88 W1, Claude Code; removed) | 753 | 1,713,338 | 175 | not recorded; 0.1.366 by cache births |
| cd415cf8 (worker 002-29 W1, Claude Code; removed) | 549 | 1,108,905 | 133 | not recorded; 0.1.366 by cache births |
| 5df9d46d (coordinator, Codex) | 460 | 1,082,448 | 20 | 0.1.366, recorded |
| 8b2a8995 (this wave's coordinator, Codex) | 386 | 941,782 | 4 | 0.1.366, recorded |
| a1964cc6 (coordinator, Codex) | 367 | 860,110 | 9 | 0.1.366, recorded |
| 57d984a6 (worker 002-31, Claude Code) | 159 | 244,728 | 47 | 0.1.366, recorded |
| 19fa731c (worker 002-30 W2, Claude Code; removed) | 155 | 156,771 | 38 | not recorded; 0.1.366 by cache births |
| dee1b657 (worker 002-34, Claude Code) | 87 | 108,159 | 26 | 0.1.366, recorded |
| 1b2ca269 (worker 002-35, Claude Code) | 78 | 99,126 | 32 | 0.1.366, recorded |
| 3dc8d717 (coordinator, Codex) | 13 and 13 | 39,055 and 34,525 | 4 and 3 | an earlier daemon not recorded, then 0.1.366 recorded |
| 2584c37c (reviewer of `cand/0.1.367`, Codex; removed) | 6 | 10,341 | 3 | not recorded; 0.1.366 by cache births |
| **All** | **3,026** | **6,399,288** | | **1,550 recorded 0.1.366; 1,476 not recorded; 0 from 0.1.367 or older** |

"0.1.366 by cache births" is a bound, not a proof. Every daemon running after the host restart (08:22:29Z) started then or later. Both caches held 0.1.366 from 07:52Z, and 0.1.367 reached a cache only at 11:40:33Z. All these runs started before that. A daemon run from a worktree's own build is not excluded by the bound. The removed workers' sessions ran 0.1.366 hooks, which start the daemon from their own plugin directory. Records by hour: 13 at 09:00Z, 1,214 at 10:00Z, 1,799 from 11:00Z to 11:51Z.

## Completed results without a record (015-79)

**Saved notes** (`bin/notes.mjs`, `data/interim-drop-notes.json`, 11:54:57Z). Each note gives its daemon's total since the daemon started. The topic keeps 3 notes per worktree. The table gives each worktree's latest note.

| Worktree | Daemon | Latest note (UTC) | Test files with no record | Cause | Completed test file slots in the window |
| --- | --- | --- | --- | --- | --- |
| 57d984a6 | 0.1.366 since 11:35:27Z | 11:49:58 | 32 | no-result | 287 |
| 1b2ca269 | 0.1.366 since 11:35:52Z | 11:48:42 | 16 | no-result | 134 |
| 5df9d46d | 0.1.366 since 10:48:42Z | 11:42:44 | 15 | no-result | 613 (some before this daemon) |
| dee1b657 | 0.1.366 since 11:35:40Z | 11:51:18 | 8 | no-result | 162 |
| 8b2a8995 | 0.1.366 since 11:10:13Z | 11:49:56 | 4 | no-result | 474 (some before this daemon) |
| 3dc8d717 | not recorded (before 09:52:22Z) | 09:44:14 | 4 | closed (the writer closed first) | 30 |
| 2cb095fe, cd415cf8, 19fa731c, 2584c37c | removed | notes deleted with the worktree | unknown | | 1,165, 571, 163, 7 |

`no-result` means "its run's result was not found at its key". The 015-79 note says so.

**Results still without a record** (`bin/runs_norecord.mjs`, `data/interim-runs-norecord.json`, 11:53:19Z). This counts every run started in the window that ended more than 120 s before the reading, and needs no notes. Of 3,046 test files those runs gave a result, 33 (1.1%) have no record at that result's key:

| Worktree | No record | Of |
| --- | --- | --- |
| cd415cf8 | 10 | 559 |
| 1b2ca269 | 8 | 82 |
| 57d984a6 | 6 | 156 |
| 3dc8d717 | 4 | 30 |
| 2cb095fe | 3 | 756 |
| dee1b657 | 1 | 88 |
| 2584c37c | 1 | 7 |

Every other worktree had none.

- **Notes and results differ.** The notes count more drops than results without a record remain: 57d984a6 has 32 against 6. So most dropped payloads were for results later replaced by a result that has a record. Why so many `no-result` drops come in the 11:35Z workers (11% to 12% of their slots) was not read.
- **A record lags its result.** At 11:52:08Z the coordinator's worktree had 54 current test files from its own daemon without a record. At 11:52:40Z it had 17, and at 11:53:19Z its settled runs had none. A count taken during activity must leave the last runs out.

**Current test files without a record per live worktree** (`norecord.mjs`, `data/interim-norecord-live.json`): 20 to 23 in each of 8 worktrees, from another worktree's runs, newest at 00:53:59Z, 01:34:30Z or 10:19:57Z. The coordinator 8b2a8995 has 10 (7 from another worktree's runs, 3 from its older runs) once its in-flight records settle. The 10:19:57Z ones come from worker 2cb095fe's run at revision 29, which ended `completed`. That worktree's notes are gone.

## Skipped-loader states (015-78)

`data/interim-unknown.json` (`round-3/bin/unknown.mjs`), `uncovered` functions in files `unknown, skipped`:

| Worktree (daemon) | Functions `pass` | Functions `unknown` | Share `pass` |
| --- | --- | --- | --- |
| 8b2a8995 (0.1.366) | 3,792 | 620 | 86% |
| a1964cc6, 5df9d46d, 1b2ca269, dee1b657 (0.1.366) | 1,453 each | 298 each | 83% |
| 57d984a6 (0.1.366) | 566 | 240 | 70% |
| 3dc8d717 (0.1.366) | 619 | 187 | 77% |
| 474cc4f5 (0.1.361), 94d5527a (0.1.361), e66c41c5 (0.1.359), 10635869 (0.1.357) | 0 | 3,929 to 4,684 | 0% |

At the 07:41Z baseline, the coordinator's worktree read 4,272 `pass` and 677 `unknown`. The main checkout (0.1.367 from 11:42:59Z), b808ae2c and 3173c561 read every file `pending, imports`.

## Store growth

From 08:53:46Z (`store-baseline-2.json`) to 11:51:31Z (`data/interim-store.json`), 2.963 h:

| Measure | 08:53:46Z | 11:51:31Z | Change |
| --- | --- | --- | --- |
| `code.sqlite` bytes | 3,373,985,792 | 3,406,319,616 | +32,333,824 (10.9 MB an hour) |
| Coverage records | 106,503 | 109,516 | +3,013 (3,020 manifests stored since 08:23:46Z, 0 full) |
| Record bytes | 3,063,363,622 | 3,069,733,979 | +6,370,357 |
| Shared parts | 7,711 (3,595,815 bytes) | 9,592 (4,521,267 bytes) | +1,881 (+925,452 bytes) |
| Coverage summaries | 1,140 (2,820,508 bytes) | 2,496 (5,120,519 bytes) | +1,356 (+2,300,011 bytes) |
| `store.sqlite` bytes | 1,237,385,216 | 1,274,572,800 | +37,187,584 |

- **Coverage payload:** records plus new parts came to 7.30 MB for 3,020 records. That is 2.42 KB per record, against 35.3 KB for a full record at the baseline.
- **The file grew 4.4 times as much.** The rest is code states (about 148,000 new rows) and summaries.
- **Not a rate to compare.** Round 2 grew 1.46 GB in 20.4 h with full records and more activity. Bytes per completed test file slot give a fairer comparison: 32.3 MB over 3,980 slots is 8.1 KB a slot. No run started between 08:23:46Z and 08:53:46Z. The slots were counted at about 11:55Z, a few minutes after the bytes, so the figure is approximate.

## What the final count still needs

1. **A working day of source-edit sessions.** This window has 5 sessions that edited measured `src/`, 1 with coverage lines and 0 Codex ones. Round 2 had 20 sessions with lines. A Round 2-length window from 08:23:46Z ends no sooner than 2026-10-28T06:30Z (22.1 h). It is comparable only with enough source edits.
2. **A store reading before each worktree removal**, with `data/interim-bin/notes.mjs` and `runs_norecord.mjs`. Four worktrees' notes (1,906 slots) are already gone.
3. **The note key fixed** in `round-3/bin/store.mjs` (`notes.%`, not `notes:%`). Then the first stage's statements read again: `notes.md` "no worktree holds a `coverage:no-record` note" (07:41Z and 08:53Z), and the coordinator's 11:40 check ("no retained drop note"). At 11:40:22Z, 3dc8d717 and 5df9d46d already held such notes. The 07:41Z and 08:53Z notes cannot be read again: each topic keeps 3 notes. These files are outside this reading's ownership.
4. **Daemon starts recorded while they run** (the `worktrees` table or `/proc`, every hour or before each removal). 1,476 of 3,026 records have only the cache-birth bound.
5. **A 0.1.367 population.** Codex had not taken 0.1.367 by 11:44Z. Claude Code sessions started from 11:40:33Z take it. Split every count by 0.1.366, 0.1.367 and older.
6. **The cause of the `no-result` drops** in the 11:35Z workers, if the coordinator wants it; this reading only counts them.

## Rules kept

- **Read only.** Stores opened with `node:sqlite` `readOnly: true` and `PRAGMA query_only = 1`, at `nice 19`. Transcripts were read for SQUEAL lines, tool paths and the one case's text. Cezar handoff files were read for their first line only. `/proc` was read for command lines only.
- **Nothing changed.** No CPU run, no session started, no config, plugin or store change.
- **Scratch:** `/var/tmp/dogfood-015-14/w-d3937b73/interim/` (extracts with transcript text stay there).
- **Not rebased.** The branch was not rebased on `origin/main`. Its 12 `src` and `test` changes would have made this worktree's daemon run tests and write records into the store being measured. The new files do not touch any existing file.

## Scripts (`data/interim-bin/`)

| Script | What it does |
| --- | --- |
| `lines.py`, `cases.py`, `tally.py` | Round 2's line, cause and verdict scripts. The window and out directory are arguments, the cache births are read, and each Codex delivery takes the latest version its rollout names. `Code:` lines count as summaries, and this window's cases found by reading are recorded |
| `window.py` | Sessions by version, source edits, repeated summaries, loader accounts |
| `records_versions.mjs` | Records since a mark, by producing run, worktree and proven daemon version |
| `runs_norecord.mjs` | Test files of settled runs since a mark with no record at their result's key |
| `notes.mjs` | Saved `coverage:no-record` notes under the right key, matched to recorded daemons |

How to run them again, from `/var/tmp/dogfood-015-14/w-d3937b73/interim/out`:
1. `part-b/bin/extract_cc.py` over the Claude Code transcripts changed since 08:23:46Z (this worker's left out), and `extract_codex.py` over the Codex rollouts of 2026-10-27.
2. `lines.py`, `cases.py`, `tally.py` and `window.py` with the window.
3. `round-3/bin/store.mjs` and `unknown.mjs`; `norecord.mjs` per live worktree.
4. The three `.mjs` probes above, with the store readings as arguments.
