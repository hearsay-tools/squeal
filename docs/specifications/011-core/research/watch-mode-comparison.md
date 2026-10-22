# 011-119: edit to result, Squeal against the runners' own watch modes

Brief: `watch-mode-comparison-brief.md`. Researcher, 2026-10-22, 14:27Z to 16:50Z; the coordinator stopped new measurements at the three-hour budget. Squeal 0.1.265 from the committed `plugins/claude-code/dist` of a squeal clone at `da73c4984`. Vitest 5.0.3 (squeal), 4.1.10 (cezar `efce81346`), 4.1.11 (toolkit-dev `7f939fb9`, after `uv sync` in each tool). pytest 9.1.1, pytest-testmon 2.2.0 and coverage 7.16.2 in `estimate-pricing`'s environment. Each tool had its own `git clone` under `/tmp`, with offline installs (testmon was the one network install, into the pytest clone only). `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME` and `TMPDIR` were under `/tmp`. Squeal had its own permit pool with `capacity.hostSlots` 4. Vitest ran with `--maxWorkers=4` on the scenario's candidate files; pytest ran in one process. In each repetition the tools took turns on the same edit, and the first tool alternated. Load is the host's one-minute load on 24 CPUs at the write (other coordinators' work). Method, edits, expected results, scripts and raw data: `probes/watch-mode-comparison/` (README, `evidence/`).

**Terms.** *First* is the time from the write to the first affected test file's result. *All* is the time to the last one, over the test files of Vitest's `related` walk for the edited module (or the edited test file). A Squeal result counts when the store holds it at a key computed at or after the edit's revision. A new failure counts at its `PASS -> FAIL` transition, which is when Squeal tells it; its confirming re-run (task 001-171) is given apart. A Vitest result counts at its reporter's module end. A pytest result counts at the command's exit, with the command started at the write. Every figure is a median, with the range in brackets.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Latency | Where Vitest's graph holds the edit, watch mode is 0.3 to 2.9 s faster to the first result, and up to 38.7 s faster to all of them (squeal: 1.2 s against 39.9 s). On reverts Squeal is faster: 0.1 to 0.3 s from its store, against watch-mode medians of 0.4 to 2.4 s (toolkit TS: 81.3 s). Where the edit is outside the graph, watch mode gives no result at all. | verified by experiment |
| 2 | Correctness | `vitest --watch` gave 15 false passes in 15 out-of-graph edits (toolkit `cli.py`, `cli.py` with a swap file, `rules.py`). testmon gave 3 false passes in 3 breaking `cli.py` edits. Squeal was right in all 100 steps. Plain pytest was right in every pytest outcome, but it cannot see the Vitest drift test. Squeal ran 41 harness files per squeal source edit and 1 to 2 cezar files per edit that no outcome needed; watch mode ran none. | verified by experiment |
| 3 | Squeal's stages | Watcher 0.13 to 0.26 s; first tier 0.2 to 2.6 s after the write; then catch-up for everything the edit reaches only transitively, by a read or by a declared input. That route costs: the tier's end (34 to 43 s on squeal), the 20 s quiet (20.2 to 20.5 s, 7 of 20 toolkit edits), a cancelled swap-file tier (14 s thrown away, 5 of 5), and the permit wait (the holder's remainder plus 1.3 to 1.5 s). Watch mode has none of these stages. | verified by experiment, read in source code |
| 4 | Contention | With all 4 permits held for 60 s: the edit tier was unchanged (1.0 to 1.6 s). The catch-up started 1.3 to 1.5 s after the hold ended, and all results came at 133.6 to 142.9 s, against 79.8 s without the hold (n = 3). | verified by experiment |
| 5 | Recommendation | Keep the watcher, the store and the observed reads, and hand nothing to `vitest --watch`. Cut the catch-up route for what an edit reaches: release 011-116 and widen it to transitive importers, and release 011-117 and 007-55. 011-118 is not determined here. | from 1 to 4 |

## 1 and 2. Latency and correctness

n = 5 per row. A result is right when it matches the plain targeted run (README). Load is the range at the writes.

| Repo, scenario, step | Squeal: first; all | `vitest --watch`: first; all | pytest plain; `--testmon` | Load | Wrong results |
|---|---|---|---|---|---|
| squeal `s-body` edit | 1.8 (1.5 to 2.2); 39.9 (35.8 to 45.5) | 0.8 (0.8 to 1.0); 1.2 (1.2 to 1.5) | not applicable, because the repo has no pytest | 23 to 34 | none |
| squeal `s-body` revert | 0.3 (0.3 to 0.3) | 0.7 (0.7 to 1.0); 1.1 (1.0 to 1.6) | n/a | 24 to 33 | none |
| squeal `s-break` edit (2 tests fail) | 1.7 (1.4 to 1.8); 39.0 (35.5 to 46.8), confirmed 35.5 to 46.8 | 0.8 (0.7 to 0.8); 1.2 (1.1 to 1.2) | n/a | 20 to 36 | none |
| squeal `s-break` revert | 0.3 (0.3 to 0.3) | 0.9 (0.7 to 1.1); 1.4 (1.1 to 1.5) | n/a | 19 to 35 | none |
| squeal `s-test` edit | 1.2 (1.1 to 1.6) | 0.9 (0.7 to 1.2) | n/a | 19 to 35 | none |
| squeal `s-test` revert | 0.3 (0.3 to 0.3) | 0.8 (0.7 to 1.0) | n/a | 20 to 35 | none |
| cezar `c-body` edit | 2.7 (2.6 to 3.1); 5.4 (5.1 to 6.4) | 0.4 (0.4 to 0.5); 2.2 (2.0 to 2.6) | n/a | 19 to 29 | none |
| cezar `c-body` revert | 0.3 (0.2 to 0.3) | 0.4 (0.4 to 0.6); 2.2 (2.1 to 2.7) | n/a | 20 to 28 | none |
| cezar `c-break` edit (1 test fails) | 3.4 (2.3 to 3.7); 6.1 (5.0 to 6.7), confirmed 5.4 to 7.3 | 0.5 (0.3 to 0.5); 2.2 (1.7 to 2.6) | n/a | 21 to 26 | none |
| cezar `c-break` revert | 0.3 (0.3 to 0.3) | 0.4 (0.4 to 0.5); 2.4 (2.0 to 2.6) | n/a | 21 to 28 | none |
| cezar `c-test` edit | 2.9 (2.7 to 3.0) | 0.4 (0.3 to 0.4) | n/a | 20 to 27 | none |
| cezar `c-test` revert | 0.3 (0.2 to 0.3) | 0.4 (0.4 to 0.4) | n/a | 19 to 27 | none |
| toolkit `t-cli` edit (`publish.test.ts` fails 13 tests on drift) | 81.5 (72.4 to 92.4), confirmed 147.9 to 182.9 | no rerun | 2.7 (2.5 to 3.9), 48 pass; 0.3 (0.2 to 0.5), "no tests ran" | 11 to 37 | watch: 5 false passes |
| toolkit `t-cli` revert | 0.2 (0.2 to 0.3) | no rerun (the old pass stands, right by chance) | 2.9 (2.5 to 3.8); 0.3 (0.3 to 0.5) | 12 to 37 | none |
| toolkit `t-cli-swp` edit (vim; repetitions 2 to 6) | 100.3 (94.3 to 121.5), confirmed 167.8 to 238.6 | no rerun | not determined, because the pytest side is `t-cli`'s edit and a swap file is no Python module | 15 to 44 | watch: 5 false passes |
| toolkit `t-cli-swp` revert | 0.3 (0.3 to 0.3) | no rerun | not determined, as above | 12 to 36 | none |
| toolkit `t-rules` edit (`publish.test.ts` fails on drift) | 80.1 (77.2 to 97.3), confirmed 153.3 to 198.9; its 2 pytest files in 0.8 to 1.2 s | no rerun | 2.7 (2.2 to 2.9); 0.4 (0.4 to 0.6), 11 selected | 10 to 35 | watch: 5 false passes |
| toolkit `t-rules` revert | 0.3 (0.2 to 0.3) | no rerun | 2.7 (2.3 to 3.0); 0.5 (0.4 to 0.6) | 10 to 35 | none |
| toolkit `t-ts` edit | 1.2 (0.9 to 1.3); 79.8 (78.1 to 85.3) | 0.5 (0.4 to 0.7); 81.4 (75.9 to 86.3) | n/a | 11 to 26 | none |
| toolkit `t-ts` revert | 0.3 (0.1 to 0.3) | 0.4 (0.4 to 0.6); 81.3 (75.7 to 86.3) | n/a | 10 to 23 | none |
| toolkit `cli.py` breaks the CLI (n = 3) | not determined here, because measurements stopped; 011-115 E9 measured Squeal's pytest miss | not applicable, because the failing tests are pytest's | 0.6 to 0.7, 3 fail; 0.3 to 0.4, "no tests ran" | not recorded | testmon: 3 false passes |

- **Watch mode is blind outside the graph** (verified by experiment; read in source code, Vitest 4.1.11 `VitestWatcher.handleFileChanged`). A changed file reruns tests only when it matches `forceRerunTriggers` or `watchTriggerPatterns`, is a setup file, or is a module in a project's Vite module graph. `cli.py` and `rules.py` are none of these, so `publish.test.ts`, which reads them through `walkFiles`, never reran. The pass from before the edit stayed on screen. `watchTriggerPatterns` maps a changed path to test files, but each repository must write it by hand. Whether Vite's watcher, rooted at `tools/generator`, sees `plugin-tools/` at all was not tested (inferred: no).
- **testmon does not see subprocesses** (verified by experiment). For `cli.py` it selected nothing, both for a comment and for a breaking edit. `test_pricing_*` run `python -m estimate_pricing`, which coverage in the pytest process does not trace. This is the same miss as Squeal's (007-55), and testmon has no observed-read fallback.
- **Files run that no outcome needed** (verified by experiment, store). Squeal ran 41 harness files with every squeal source edit, because `squeal.config.json` declares `src/**/*.ts` as their input. In cezar it ran `contract-import-boundaries.test.ts` and the node:test file `change-surface-readers.test.cjs` with each edit (declared inputs), and `pid-file.testkit.test.ts` with each test edit. Every new failure ran a second time to confirm: about 80 s per toolkit failure. Watch mode ran only the related files.

## 3. Squeal's stages (store runs and transitions; `status --json` every second)

| Stage | Measured | Watch mode |
|---|---|---|
| Watcher: write to revision | 0.13 to 0.26 s, every repo | Vitest's own: rerun scheduled after a 100 ms debounce (`WATCHER_DEBOUNCE`) |
| Revision to the first tier | 0.1 to 0.5 s (squeal, toolkit); 1.2 to 2.4 s (cezar, 5 projects) | none: the rerun starts at once |
| Edit tier run | 0.6 to 1.4 s for 1 to 4 files | about the same |
| Catch-up tier's end | squeal: transitive importers `pi-status`, `primer-slow-policy` (both under 1 s) share a 41-file tier with the declared-input harness files and wait for its end: 34 to 43 s. cezar: `windows.test.ts` (a direct importer) runs in a second tier: +2.5 to 3.3 s | none: every related file is in one run, and the reporter shows each as it ends |
| Quiet (`BACKLOG_QUIET_MS`, 20 s) | swap file: 20.3 to 20.5 s, 5 of 5. `t-rules`: 20.2 s in 2 of 5, when the write came 17 to 19 s after a cancel; the edit's own revision restarts the quiet for its reader | none |
| Cancel | the swap file's tier started 0.3 s after vim's swap creation, ran 14 s and was cancelled 1.4 to 1.7 s after the write: 14 s thrown away, 5 of 5 | none: `scheduleRerun` waits for the run in flight and then reruns (read in source code) |
| Permit | 0 s on a free pool; with every permit held, the hold's remainder plus 1.3 to 1.5 s | none |
| Run | `publish.test.ts` 72 to 101 s (it walks the `.venv` trees); the same under watch mode | same |
| New-failure re-run | does not delay the FAIL; the file is pending again until 35 to 47 s (squeal) or 148 to 239 s (toolkit) | none |
| Store lookup on a revert | 0.1 to 0.3 s, no run | none: reruns (toolkit 76 to 86 s) |

The toolkit `t-cli` edit had no quiet and no permit wait: the tier started 0.2 to 0.4 s after the write, so its 81.5 s is the test's own cost. The extra 18.8 s (median) of `t-cli-swp` over `t-cli` is the 20.3 s quiet, within the test's run-to-run spread (72 to 101 s). Not determined: how the cezar time from revision to first tier divides between `affected`, closure and selection, because the scratch daemon kept no log of its runner calls.

## 4. Contention

`holder.ts` took all 4 permits of the scratch pool through Squeal's own pool code, 1 s before each write of a `t-ts` edit, and held them for 60 s.

| `t-ts` edit, n = 3 | first (edit tier, no permit) | all (`publish.test.ts`, catch-up) | catch-up start after the hold ended |
|---|---|---|---|
| permits held 60 s | 1.6, 1.6, 1.0 s | 142.9, 142.5, 133.6 s | 1.3, 1.5, 1.5 s |
| free pool (section 1) | 1.2 (0.9 to 1.3) s | 79.8 (78.1 to 85.3) s | not applicable |

While it waited, `status --json` showed the file `queued` with `behind: null`, and did not name the permit as the cause. Repetitions 12 and 13 come from the store's revisions 69 and 71. The poller's 2 s look-back caught the previous revert at first, and the probe README records this.

## 5. Recommendation

1. **Hand nothing to `vitest --watch`.** It would trade 0.3 to 2.9 s on the first result for 15 of 15 false passes on toolkit-dev's runtime reads, and for reruns on every revert (toolkit TS reverts: 81.3 s against 0.3 s). Its watcher would gain nothing: Squeal's reaches a revision in 0.13 to 0.26 s. Vitest's `related` walk is already Squeal's `affected` (013 V3). Correctness cost of keeping things as they are: none.
2. **Cut catch-up for what an edit reaches; release 011-116 and widen it.** Every slow case except the test's own run came from the catch-up route: tier end (+34 to 43 s on squeal), quiet (+20 s), permit (+53 to 63 s under a 60 s hold). An edit's transitive importers and readers should run as edit work, under the tier-sharing rule (`joinSpan`), not in a 120 s backlog tier beside declared-input files. Expected effect: the squeal `s-body` "all" drops from 39.9 s toward Vitest's 1.2 s (inferred from the files' durations), and the permit and quiet stages leave the edit's path. Cost: more files in the first group when an edit reaches many transitively. 011-25 capped direct importers for that reason, so the same `runner.tierSize` cap applies, and the rest stays catch-up. Correctness cost: none, since the same files run.
3. **Release 011-117 (swap files).** Measured cost per vim write: 14 s of run thrown away and 20.3 s of quiet, +18.8 s median against the same edit without a swap file. Correctness cost: none, since the completion barrier still discards a result whose listing moved.
4. **Release 007-55 (subprocess imports), and do not use testmon in its place.** testmon gave 3 false passes in 3 breaking `cli.py` edits. Plain pytest found the 3 failures in 0.6 to 0.7 s, so the cost of running these files is small.
5. **011-118** (a checkpoint counting a looked-up file as done): not determined, because no scenario used `run --all`.
6. **Smaller, for later rows:** name the permit wait in status (section 4). Weigh the new-failure re-run of long files: it keeps a toolkit file pending for one more run (about 65 to 120 s) and holds its lane.

## Open questions

- Where cezar's 1.2 to 2.4 s from revision to first tier goes. A daemon log of runner-part call times would decide it.
- Whether Squeal's first-group tiers could store each file as its module ends (C4 tier sharing, "the other way, not taken"). This was not measured.
- Deviations from a live tree. Baselines were `lookup-only`, with the scenario's files primed by `squeal retry`. cezar's `e2e` project was excluded. Each store held only these runs' observed reads, so live re-keys can be wider. Repetition 1 of `t-cli-swp` repeated `t-cli`'s content and was replaced by repetition 6. One `squeal status` early in the setup ran from this worktree by mistake and read its live store. It read only, started no daemon and wrote nothing (inferred: plain `status` reads the store directly). `sq.sh` refuses to run outside a clone since then.

## Sources

- Experiments: `probes/watch-mode-comparison/` (`measure.sh`, `measure-hold.sh`, `edit.sh`, `sq-wait.mjs`, `vt-wait.mjs`, `stamp-reporter.mjs`, `holder.ts`, `cli-break.sh`, `analyze.mjs`). The rows of section 1 come from `node analyze.mjs evidence/results.ndjson`. Evidence: `evidence/results*.ndjson`, `store-extract-*.ndjson.gz` (revisions, runs, transitions), `poll-*.ndjson.gz`, `vt-*.ndjson.gz`, `cli-break.txt`, `sequence.txt`.
- Vitest 4.1.11, `tools/generator/node_modules/vitest/dist/chunks/cli-api.CnMVyzaz.js`: `VitestWatcher.onFileChange`, `handleFileChanged`, `getTestFilesFromWatcherTrigger`, `Vitest.scheduleRerun` (`WATCHER_DEBOUNCE = 100`, waits for `runningPromise`); `chunks/reporters.d.DtoKVV2s.d.ts` (`forceRerunTriggers`, `watchTriggerPatterns`).
- Squeal at `da73c4984`: `src/core/scheduler/quiet.ts` (`BACKLOG_QUIET_MS = 20_000`), `backlog.ts` (`BACKLOG_TIER_BUDGET_MS = 120_000`), `edit-cut.ts`, `rerun.ts` (001-171), `src/core/capacity/pool.ts`; spec 011 C2, C4, C10; 013 V3; 007 Non-goals (testmon) and `007-pytest-runner/research/python-module-graph.md` Q6.
- `research/edit-latency.md` (011-115) for the live timeline and E9.
