# 011-115: where a minute goes between a Python edit and its result in toolkit-dev

Brief: `edit-latency-brief.md`. Researcher, 2026-10-22. Evidence: a copy of the live store `toolkit-dev/.git/squeal/store.sqlite` taken at 13:32Z (worktree `c5357edc`, daemon 0.1.263), copies of the squeal and cezar stores, the live `runs/` logs read in place, and experiments E1 to E3 and E5 to E9 on a `/tmp` clone of toolkit-dev at `7f939fb9` under a scratch 0.1.263 daemon (installed plugin `dist`, `HOME`, `XDG_*` and `TMPDIR` under `/tmp`, `capacity.hostSlots` 4, its own permit pool). Times are UTC. Probes, extracts and status logs: `probes/edit-latency/`.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Timeline | Edit 1: FAIL 135.7 s after its revision, which is 46.4 s before the tier started and 89.2 s of run. Revert 1, edit 2 and revert 2: the outcome changed in 35 to 57 ms (store lookup), but `publish.test.ts` stayed pending. After revert 2 it was current again after 121.3 s, made of two quiet waits (15.3 s and 18.8 s), a run cancelled after 12.2 s and a 75.0 s run. | store, verified by experiment |
| 2 | What the edit invalidates | One check, Vitest `publish.test.ts`, through observed runtime inputs (`cli.py` read, `estimate_pricing/` listed). Correct: the test compares `cli.py` with its generated copy and fails on drift. No pytest check, which is wrong: `cli.py` runs in a `python -m estimate_pricing` subprocess that pytest's observation does not see. | store, source, verified by experiment |
| 3 | Ordering | The pytest checks never queued. The Vitest file is catch-up work (a path a run read), so it is a backlog tier. It waits for a host permit and for 20 s of quiet after each cancel. Vim's swap file re-keyed it four more times, and each re-key cancelled the run. Squeal runs this tool's pytest files in 37 ms, 260 ms and 3.5 s (one tier 1.8 s), against 2.46 s for plain pytest. | store, verified by experiment, inferred (permit) |
| 4 | Notice delay | 151 ms from write to revision (live, revert 2); 158 to 191 ms in the clone. The watcher is not the delay. | store, verified by experiment |
| 5 | Scope | General: the catch-up class for files that a run read, editor swap files in listed directories, checkpoints held open, pytest subprocess imports. Specific to toolkit-dev: the test's 75 to 90 s cost. | inferred from the mechanisms below |
| 6 | Recommendation | Five candidate rows, ranked below. | |

## 1. Timeline (live, worktree `c5357edc`)

Vim writes `.cli.py.swp` beside the file when it opens it and removes it on quit. Each open or quit was a revision. Notes in the Stage column carry tags.

| Event | Revision, time | What followed | Stage that took the time |
|---|---|---|---|
| Vim opens | 64, 13:19:47.653 | Swap file changes the listing of `estimate_pricing/`; `publish.test.ts` re-keyed and queued as catch-up | |
| **Edit 1** (`:wq`) | 66, 13:20:03.401 | No tier until 13:20:49.839 (62.2 s after rev 64, 46.4 s after rev 66). Run `baf47226`, 89.2 s; 13 tests PASS -> FAIL at 13:22:19.059 ("Drift detected in ... cli.py") | 46.4 s permit wait (inferred, section 3); 89.2 s run, almost all the test's own cost (section 2) |
| | | Re-run of the new failure `2202a931` 13:22:19.100, cancelled 13:22:49.760 | |
| Vim opens | 67, 13:22:48.574 | Cancels that re-run (supersession) | |
| **Revert 1** | 69, 13:22:50.767 | 13 tests FAIL -> PASS at 13:22:50.824 (+57 ms). File still not current: `run --all` at 13:23:01.306 lists it (checkpoint `a6b8463a`, 1 file); run `245cf8c4` 13:23:07.806, cancelled 13:24:02.878 | 55.1 s run discarded |
| Vim opens | 70, 13:24:01.531 | Cancel; quiet until about 13:24:21.5 | |
| **Edit 2** | 73, 13:24:17.145 | PASS -> FAIL at 13:24:17.187 (+42 ms, stored key `fa6792`). Checkpoint `7c616b78` lists it again; run `e942c4ae` 13:24:21.698, cancelled 13:25:01.700 | 40.0 s run discarded |
| Vim opens | 74, 13:25:00.510 | Cancel; quiet | |
| **Revert 2** | 76, 13:25:05.387 (written 13:25:05.236) | FAIL -> PASS at 13:25:05.422 (+35 ms). File still pending: run `db1ae35f` 13:25:20.638 (15.3 s quiet), cancelled 13:25:32.827 | 15.3 s quiet + 12.2 s run discarded |
| Vim opens and quits | 77, 13:25:31.523; 78, 13:25:32.681 | Cancel; `quiet:` meta row: until 13:25:51.640. Run `a55e8896` 13:25:51.646 to 13:27:06.655, PASS at key `45c3f6`; both checkpoints complete 13:27:06.660 | 18.8 s quiet + 75.0 s run |

Accounted: edit 1, 135.7 s of 135.7 s; revert 2 until current, 121.3 s of 121.3 s. In this window the Vitest lane ran `publish.test.ts` for 302 s, and the cancels threw away 138 s of it.

The fast reverts and edits are real lookups. Verified by experiment (E3, clone): a `cli.py` edit and its revert without a swap file are each current within 2 s, with nothing queued. Not determined: why the live file had no current result 4 to 11 s after the lookups at revisions 69 and 73, so that each `run --all` listed it. The `rekeyed-moves` row keeps its moves open from revision 67 to 78. The clone did not reproduce it: E5, E6, E7 and E8, with a swap file present during a run, during a queued wait, during the failure's re-run and beside a `run --all`, all ended current with nothing queued. A daemon log of key decisions would decide it, and the live daemon writes its log to `/dev/null`.

## 2. What the edit invalidates

- **Vitest `publish.test.ts`** (read in source code, toolkit-dev `tools/generator/src/index.ts` and `src/lib/plugin-tools.ts`). `runPublish` checks for drift: `walkFiles` reads every file under each `plugin-tools/<tool>/` and compares it with the copy under `plugins/*/tools/`. The stored closure (1,101 paths) holds `cli.py` and the listing `plugin-tools/estimate-pricing/estimate_pricing/`. Correct: the run at revision 66 failed 13 tests on that drift, which is the result the edit should give. The swap file re-key is correct by Squeal's rules too, because `walkFiles` lists the directory and git does not ignore `.cli.py.swp` (`git check-ignore`: no match).
- **The test's cost** (verified by experiment, clone, plain `npx vitest run tests/publish.test.ts`, no Squeal): 2.25 s at load 22.5. After `uv sync` in each tool, so that `plugin-tools/*/.venv` exists as in the live checkout, it took 79.2 s at load 19.8. `walkFiles` reads the gitignored environments too. Under Squeal the file takes 72 to 101 s in the main checkout (store, 11:03 to 13:27) and 13 to 22 s in the Cezar worktrees, which have no tool environments.
- **pytest: nothing, and that is a miss** (verified by experiment, E9). `test_pricing_proposals.py::test_cli_*` and `test_pricing_end_to_end.py` run `[sys.executable, "-m", "estimate_pricing", ...]` (read in source code). Their closures and `pytest.observed.pytest` hold `rules.py`, `graph.py` and `propose.py`, never `cli.py` or `__main__.py`. Spec 007 D6 wraps `__import__` only inside the pytest process. With `raise SystemExit(3)` added to `cli.py`, `squeal status` on both files said "no known failures; 2 test files, each with a current result" (revision 18). Plain pytest failed 3 tests.
- node:test: no closure holds the path (store).

## 3. Ordering

- **Class** (read in source code, `src/core/scheduler/edit-cut.ts`; spec C4 step 4). An edit's work is namesakes and direct importers. "A path a run read" is catch-up, so the only check of this edit ran as a backlog tier.
- **Permit** (inferred). In the clone, whose pool is private, a tier started 0.22 to 0.25 s after the revision (E1, E5). Live, it started 46.4 s after the edit, and 1.4 s after the cezar worktree `511d644c` ended its 268 s `e2e` run (13:16:20.299 to 13:20:48.405, `packages/web/e2e/touch-targets.e2e.ts`). A 200-file checkpoint tier of squeal worktree `ea937e11` ran 13:18:38 to 13:22:58. C10 Capacity: a backlog tier waits as a waiter until a holder returns permits. Pool marks keep no history, so the holder is not proven. Load at 13:32Z: 17.3, 14.6, 15.2 on 24 CPUs.
- **Quiet** (verified by experiment, E1 and E2). After a supersession cancel, the next tier started 20.0 s and 20.0 s later (`quietUntil` in `status --json`), as `BACKLOG_QUIET_MS` (`src/core/scheduler/quiet.ts`) says. The live `quiet:` row matches the 13:25:51.646 start.
- **Cancel and restart** (verified by experiment, E1 and E5). A swap file alone re-keyed the file, a tier started 0.25 s later, and a later revision cancelled it after the runner's grace of about 1.3 s.
- **Open checkpoint** (verified by experiment, E8). `run --all` while the file ran on a swap-file key, then the swap file removed. The file was current at revision 17, nothing was queued or running, and status still said "a checkpoint in progress ... 0 of 1 test file done" for at least 19 s, until the daemon stopped. Live, both checkpoints completed only when the file ran at 13:27:06.660.
- **pytest timing** (store): `test_pricing_rules.py` 37 to 52 ms, `test_pricing_proposals.py` 260 to 272 ms, `test_pricing_end_to_end.py` 3.5 s (run 4.2 s). A 5-file pytest tier ran in 1.8 s at 12:06:24, one second after a `rules.py` edit. Plain `pytest -q plugin-tools/estimate-pricing`: 48 tests in 2.46 s (clone, load 17.9). When pytest owns the edit, Squeal is as fast as plain pytest.

## 4. Notice delay

`cli.py` written 13:25:05.236 (mtime), revision 76 at 13:25:05.387: 151 ms (store). Clone: 158 to 191 ms (E1, E2). This matches the 100 ms debounce (C2). "Noticed late" was the gap before a result, not before a revision.

## 5. Scope

| Cause | Where it hits | Tag |
|---|---|---|
| A test that walks `.venv` costs 79 s | toolkit-dev only; fix it there (`walkFiles` skips gitignored entries) | verified by experiment |
| A file reached only by a run's read is catch-up, so a permit wait and quiet apply | any repository with `observe.runtimeInputs` | read in source code |
| Editor swap files re-key, and cancel, every test that lists their directory | any repository edited in vim or emacs where tests list source directories | verified by experiment |
| A checkpoint stays open after its file goes current through a lookup | any repository | verified by experiment |
| pytest misses imports in subprocesses | any Python CLI tested through `python -m` or a console script | verified by experiment |

## 6. Recommendation: candidate rows, ranked by seconds lost here

1. **Readers of the edited path are an edit's work** (011 C4 step 4). A test file whose stored closure holds a changed source only as an observed read or listing joins the edit's work, under the same `runner.tierSize` shortest cut as direct importers. Here it saves 46.4 s of 135.7 s, plus each later 20 s quiet, because the quiet holds only backlog tiers. Regression: with every pool permit held by another daemon, an edit of a file one test reads at run time starts that test's tier without a permit.
2. **Editor swap files do not cancel** (011 C4 step 5, C2). A revision whose only changes are untracked editor scratch names (vim `.<name>.sw[a-p]` and `4913`, emacs `.#<name>`) re-keys as now, but cancels no tier in flight and starts no quiet. The completion barrier still discards a result whose listing differs at the end. Here it would have kept 138 s of discarded runs and about 57 s of quiet. Regression: create and remove `D/.x.swp` while a tier of a file that lists `D` runs; the tier completes and stores.
3. **A checkpoint counts a file current through a lookup as done** (011 C4 Explicit checkpoints). Live, `a6b8463a` stayed in progress from 13:23:01.306 to 13:27:06.660; how much of that was this defect is not determined (section 1). Regression: E8's sequence as a scheduler test.
4. **pytest observes imports in subprocesses** (007 D4, D6). The Python children a test starts record their import edges as `squeal_pytest` does, under the parent test file. Here it would re-run the two CLI test files in about 4 s and report the false PASS of E9. The edges must count as direct importers (row 1), or the result waits in catch-up. Regression: a fixture test runs `subprocess.run([sys.executable, "-m", "pkg"])`; an edit of `pkg/cli.py` re-keys and runs it.
5. **toolkit-dev, not Squeal**: `walkFiles` should skip ignored entries. That takes the run from 79 s to about 2 s and needs no Squeal change. File it as a toolkit-dev issue.

## Open questions

- Why the live file had no current result after the lookups at revisions 69 and 73 (section 1). This needs a daemon log of re-key decisions or a live reproduction. The clone did not reproduce it.
- Which holder kept the permit for 46 s (section 3). Pool marks keep no history.

## Sources

- Live store copy (read with `node:sqlite`): tables `revisions`, `runs`, `checkpoints`, `transitions`, `results`, `test_files`, `meta` (`quiet:`, `reruns:`, `rekeyed-moves:`, `pytest.observed.pytest`). Extract: `probes/edit-latency/evidence/live-store-extract.txt`.
- Live run logs: `toolkit-dev/.git/squeal/runs/<run id>/vitest.log`, read in place.
- toolkit-dev at `7f939fb9`: `tools/generator/src/lib/plugin-tools.ts` (`walkFiles`), `src/index.ts` (drift check), `plugin-tools/estimate-pricing/tests/*.py`, `.gitignore` lines 91 and 92.
- Squeal at `squeal--v0.1.263` (identical in `src/core` to HEAD `69ea6829`): `src/core/scheduler/edit-cut.ts`, `quiet.ts`, `src/runners/pytest/adapter-observed.ts`, `src/runners/observe/recorder.cjs`, `src/core/watcher/debounce.ts`; spec 011 C2, C4, C10; spec 007 D4 and D6.
- Experiments: `probes/edit-latency/` (`edit-seq.sh`, `poll.sh`, `sq.sh`, `q.mjs`, `closure.mjs`; status changes `evidence/e*-status-changes.ndjson`; loads `evidence/loads-and-sequences.txt`). E3, E7 and E9 ran inline; their commands and outputs are summarised in the README.
