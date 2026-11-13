# Wave 16 integration: rows 020-43/44 and 020-45/46 (#196, #198)

Worker c98adc00, shape finish. Base: `216c34fa5` (main 0.1.462 plus row 020-43/44, `tasks/020-43-44/notes.md`). Brought in row 020-45/46 with `git cherry-pick -x ca51db505..12dbe972a` (`tasks/020-45-46/notes.md`). Brief: the coordinator's (31e1d860) integration brief; the rows' brief is `tasks/wave-16.md`.

## What the integration did

- **Conflicts** (four, all "both rows add"):
  - `types.ts`: `TestFileEvidence` keeps `notStarted` (020-43) and `overBudget` (020-46).
  - `collect.ts`: keeps 020-44's lanes (`SlotPool`, `FileProgress`, `runLanes`) and 020-45/46's `fitRuns` and `tellEstimates(…, told)`. The fit and the early stop run before the lanes start: `fitRuns` gives the runs, each with its `overBudget` files split off, before `runLanes`.
  - `runs.ts`: `runs[].notStarted` and `runs[].overBudget` side by side; `unfinished` (020-46) leaves `overBudget` files out of `notFinished`, so they are out of `notStarted` too.
  - `code-gate.ts`: `...estimateOptions(parsed, io)` (020-45) and `overran` (020-43).
  - `code-gate-text.ts`: `runLines` gives the started-and-stopped lines, the not-started count line (020-43), then the over-budget line (020-46), then the `prepare` lines.
- **The early stop inside the lanes** (in commit `1fef53833`, whose subject is 020-46's original): `runLanes` calls `stoppedEarly` for each planned run before that entry's `prepare`, as 020-46's collector loop did. An over-budget file goes to no `prepare` and no run, so it gets its not-run evidence (`overBudget: true`, `completed: false`, closure read) and never reads `notStarted`. Without this call those files had no evidence at all (`planned.files` already leaves them out). `collect-early.test.ts` now also checks that `notStarted` is absent on them and on the run.
- **The larger lane** (`d8be63d2e`, `6cf902a1c`, `f86f7fc1e`):
  - `runSeconds` (`estimate.ts`) is the larger runner estimate, not the sum. `estimateAll`, `fitBudget`'s rerun N and the 2x early-stop test follow it.
  - `estimateText` (now in `src/cli/code-gate-prerun.ts`; 020-45 moved it out of `code-gate-text.ts`) judges each runner's line by its own estimate against what is left, and drops "`N s with the runs before it`".
  - Tests: `estimate.test.ts` (Vitest 20 s beside node:test 7 s is 20 s; node:test 34 s beside Vitest 1 s is 34 s; an unknown runner at the median is the longer lane), `plan.test.ts` (`orderRuns().whole` 30 s, not 38 s), `code-gate-budget.test.ts` (two runners at 300 s and 500 s fit 590 s; only the 700 s line is over).
- **`commands.md`** (`a1bf6b55c`): the three identical copies take both rows' texts. See "Proposed spec text" for the matching D sections.

## Decisions the brief did not settle

1. **The node:test kind's estimate stays the sum of its entries' groups**, each at `runner.tierSize`. With one shared pool of `runner.tierSize`, entries at once take about as long as entries in turn at that width, so the per-kind estimate needs no change; only the combination across kinds becomes the larger one.
2. **Each runner's line is "over" by its own estimate.** Since every lane gets the whole of what is left, the per-runner line and the whole estimate agree: the whole estimate is over exactly when one runner's line is over.
3. **`WAYS_OUT` still ends "The run starts anyway."** With the early stop the run starts with fewer files; the sentence stays true, and the budget line after it says what does not start. Not changed.
4. **No new collector test of the early stop beside both runner kinds.** `EARLY_KNOWN` is 20 files, and the `lanes` fixture has 8. `collect-early.test.ts` (node:test only) and the plan/estimate unit tests cover the rule; the lanes run the same `stoppedEarly` per planned run whatever its kind.
5. The cherry-picked commits keep their subjects and "wiring outside ownership" notes; each carries `(cherry picked from commit …)`.

## Proposed spec text

### D18 (replaces D18.1 to D18.4; row 020-44 notes, with the integration's estimate)

> ### D18. Order across runners (row 020-19, #187; amended by row 020-44, #196)
>
> 1. The gate runs its runners at once, as the daemon's lanes run: first each node:test entry's `prepare` (D15.3), then every runner's run starts under the one deadline (D3.4). Vitest runs with its own workers. The node:test entries share one pool of `runner.tierSize` processes: a file takes a slot before its process starts and gives it back when the process exits, so while one entry's slow file runs, the free slots go to the files of the other entries. The gate never stops a running file to make room; only the deadline stops one. Before, the runners ran one after another, and a runner that held the budget left every later runner's files unrun (#196).
> 2. The runners keep their order by D17.1 estimate, the smaller first. A runner with an unknown estimate counts by its file count at the median known duration; with no store at all, the runner with fewer files comes first. Ties keep Vitest, then node:test entries in config order. It is the order the pre-run print lists them in, the order the `prepare` commands run in, and the order in which the node:test entries first ask the pool for processes; the pool gives them in the order asked.
> 3. Each runner's own files keep D17.2's order. Running at once changes no verdict and no rule: `QUALITY_POLICY_VERSION` stays.
> 4. The pre-run print lists the runners in that order.
> 5. Since the runners run at once, the whole run's estimate is the larger runner estimate (D17.1), not their sum, and each runner's estimate line is over the budget when its own estimate is over what is left.
> 6. A runner's `runs[].durationMs` is the time any of its runs ran, so node:test entries that run at once count once.

### D17.1 (amendment; row 020-45/46 notes, with "combined as the runners run" made exact)

Replace "When the estimate is over what is left of the budget, the line gives the ways out (…). The estimate is advice: the run always starts." with:

> When a runner's estimate is over what is left of the budget, its line gives the ways out (`--timeout`, path arguments, `--group`/`gate.groups`, `--parts`). Amended 2026-11-13 (rows 020-45, 020-46; #196, #198; the human: "Build all three", "Stop early"). The whole run's estimate is the larger runner estimate, as the runners run at once (D18.5); a runner with no stored duration counts at the median of every runner's stored durations (D18.2). When it is over what is left of the budget, one more stderr line gives it and one rerun command: the call's own arguments with `--timeout N`, N being the seconds spent before the estimate plus twice the estimate, rounded up to a whole minute (a summed estimate over 20 or more files is more than 2x wrong in about 2.5% of stored runs, `research/gate-budget.md` Q2). For example `squeal code: about 700 s in all, over the 590 s left of the budget. A rerun that fits: squeal code --base main --timeout 1440`. D7's `budget` gains `rerun: { seconds, command }`, and the text report names the command before the JSON line (`A rerun that fits the estimate: <command>`). When the estimate is at least twice what is left, from at least 20 files with a stored duration, the runs start with only the selected files that may load a changed function: those whose closure loads the path of a changed function or is unknown, `--test` files, and files only their declared `inputs` chose (D3.1). The others do not start and go to no `prepare`: each reads not completed, its closure read with no record, so the verdict is at least `incomplete` (D3.4), and no function's state reads it (D5); `budget.timedOut` stays `false` when only the early stop left files unrun. The stderr line says how many run and names the first three that do not, for example `squeal code: about 1400 s in all, at least twice the 590 s left of the budget, so the gate stops early: it runs the 2 test files that may load a changed function, and not the 4 that load none (test/c1.test.ts, test/c2.test.ts, test/c3.test.ts and 1 more; the report lists them all). A rerun that runs them all: squeal code --base main --timeout 2820`. D7's `runs[]` gains `overBudget`, their paths, apart from `notFinished` and `notStarted`, and the text report counts them per runner. Otherwise the run starts whole. The estimate does not change the verdict, the exit code, a gap or `QUALITY_POLICY_VERSION`.

### D3.4 (addition; row 020-43 notes)

> Added 2026-11-13 (row 020-43, #196): while the runs go, stderr names once each file still running past its estimate: its stored seconds, and never less than 10 s or a twentieth of the budget, whichever is more; with no stored seconds, that floor. For example `squeal code: node:test is still running n1/slow.test.ts after 10 s (no stored duration); 11 s of the 25 s budget used`. With `--json` it goes to stderr, as every line but the report does (D14.4). A file the early stop did not start (D17.1) is not a file that did not finish: it reads not completed, so it too makes the verdict at least `incomplete`.

### D7 (additions; rows 020-43 and 020-45/46 notes)

> `runs[]` gains `notStarted` (row 020-43): the files of `notFinished` that never started, because the budget ended first or their run stopped before them; absent when every unfinished file started. The text report keeps one line per file that started and was stopped, and gives one count line per runner for those that never started, for example `  2 node:test test files did not start in the 25 s budget; --json lists them`.

The list of later fields gains: `runs[].notStarted` (D3.4, D18), `runs[].overBudget` and `budget.rerun` (D17.1).

## Done-when to tests (integration)

| Done-when | Test |
| --- | --- |
| Lanes run at once; the fit and the early stop apply before they start | `test/code/gate/collect-lanes.test.ts` (020-44's starve shape, unchanged), `test/code/gate/collect-early.test.ts` (early stop through `runLanes`) |
| Skipped files read `overBudget`, out of `notFinished` and `notStarted` | `collect-early.test.ts` (`overBudget: true`, no `notStarted` on the file, `run.notFinished` empty, `run.notStarted` absent) |
| The estimate takes the larger lane | `test/code/gate/estimate.test.ts` (`estimateAll`), `test/code/gate/plan.test.ts` (`orderRuns().whole`), `test/cli/code-gate-budget.test.ts` (`estimateText`) |
| Both rows' text lines side by side | `test/cli/code-gate-text-started.test.ts` (020-43), `code-gate-budget.test.ts` (020-46's over-budget and rerun lines) |

## For whoever continues

- `runner-order.ts`'s private `cost` repeats `estimateAll`'s per-runner rule (020-45/46 notes); a quality scan can join them.
- Research open question 2 (how much the two lanes slow each other on a loaded host) is still not measured. The larger-lane estimate is a lower bound when Vitest and node:test compete for CPUs; the rerun's factor 2 covers some of that.
- `plugins/*/dist` is not rebuilt (brief: no build), so `test/harness/plugin.test.ts` ("bundles are committed exactly as the build produces them") fails until the release build.
- The spec, `status.md` and the board are the coordinator's: the texts above are proposals only.
