# Row 020-57 notes: the gate's early lines tell the truth about a setup-file change and a busy host (#212)

Worker cdd2fb40, wave 21, 2026-11-14. Shape: slice. Base: main at `70cb2d357`.

Three changes to what `squeal code --base` prints before its first run. No
rule changes: the verdicts, the exit codes and `QUALITY_POLICY_VERSION`
stay as they are.

1. A changed `setupFiles` entry no longer gets the false "will read
   incomplete (no-loader)" line. Each completed test file runs the setup
   file in its own process, so its record holds the file's functions.
2. A changed path that every test file of a project depends on (config,
   setup or global setup input) gets one line per runner. The line names
   the paths, marks each `setupFiles` entry, counts the files that the
   change selects, and gives the whole run's estimate against what is left
   of the budget.
3. When the host's one-minute load per CPU is above 1, each estimate is
   multiplied by it. The estimate line says so. The over-budget line, the
   rerun command and the early stop then use the scaled estimate. The
   report keeps the unscaled seconds beside the scaled ones.

## Commits

| Commit | What |
| --- | --- |
| `c80ffa5d8` | Load scaling: `estimate.ts` (`loadFactor`, `scaleEstimate`, `EstimateLoad`, `RunEstimate.load?`, `BudgetFit.load?`), `plan.ts` (`PlanContext.load?`, `orderRuns` scales), `runs.ts` (`runs[].estimate` keeps `load`), `report.ts` (doc). Tests `estimate.test.ts`, `plan.test.ts`. |
| `40f3b8af7` | `collect.ts`, by agreement (request e3d94336): the collector reads the load once, through `options.hostLoad ?? hostLoad`, and gives it to `orderRuns`. Two lines. Row 020-55 owns the file. |
| `6fde43200` | Test `collect-load.test.ts`: real node:test fixture `early` at a simulated load. |
| `b2a6be10e` | Setup files: new `setup-selection.ts`; `prerun.ts` (`SelectionSummary.wholeProjects?`, setup entries count as loaded); `src/cli/code-gate-prerun.ts` (the setup-selection line, the scaled estimate wording; `preRunOptions` now tells the estimate). Tests `setup-selection.test.ts`, `code-gate-setup.test.ts`, `code-gate-prerun-text.test.ts`. |
| `da19c4620` | Test fix: the version-sensitive rule read the no-loader line's runner hint ("a nodeTest entry") as a node:test caller. The test now matches that line by a pattern. |
| (this file) | Notes. |

## Type changes (all additive)

- `RunEstimate.load?: EstimateLoad` and new `EstimateLoad { perCpu, unscaled }` (`estimate.ts`). The gate report's `runs[].estimate` is `Omit<RunEstimate, "runner">`, so `runs[].estimate.load` is **new in the gate report (D7)**. It is present only when the load scaled the estimate.
- `BudgetFit.load?: EstimateLoad` (`estimate.ts`). The fit is not in the report.
- `RunOrder.whole.load?` and `PlanContext.load?: HostLoad` (`plan.ts`).
- `SelectionSummary.wholeProjects?: readonly WholeProject[]` and new `WholeProject` (`setup-selection.ts`).
- `preRunOptions` now returns `estimated` as well; `estimateOptions` returns only `rerun`, and its `io` is `Pick<CliIo, "env">`. `src/cli/code-gate.ts` spreads both and did not change. Its comment "D17.1: the estimate on stderr" beside `estimateOptions` is now stale (that file is not mine).
- The gate report is not a `RunReport`, so `src/core/daemon/report-merge.ts` needs no rule.

## Proposed spec text

**D3.4, add at the end** (after the row 020-54 text):

> Added 2026-11-14 (row 020-57, #212; the human, 2026-11-14: "A: Fix the messages"): the gate also reads the host's load once before the first run, through the same measure (`hostLoad`), and only to scale the estimate (D17.1). That reading does not decide a rerun: a rerun still reads the load when the run that failed ends.

**D14.4, add at the end** (after the row 020-34 text):

> Amended 2026-11-14 (row 020-57, #212): a `setupFiles` entry of a project with a selected file that runs or is read is not a path that no runner can load. Each such file runs the entry in its own process before its tests, so its record holds the entry's functions (D5), and the gate prints no line for it. The gate reads the entries from each project's resolved config (`environment().resolvedConfig`, Vitest's canonical config) in one helper. A config or global setup file runs in the runner's own process, so no record holds it, and its line stays. Not covered yet: a file that only a setup file imports still gets the line. When a changed path is in a project's environment files (`RunnerEnvironment.files`: its config, setup and global setup files and their imports), D3.1 selects every test file of that project. Then the estimate's lines (D17.1) start with one line per runner: the paths, each `setupFiles` entry marked, the count of selected files, and the whole run's estimate against what is left of the budget, for example `squeal code: every test file of Vitest project "server" depends on vitest.setup.ts (setupFiles), so all 1248 of them are selected; the whole run takes about 2300 s at the host's load, over the 1790 s left of the budget`. For a runner's single unnamed project the line reads "every Vitest test file". When the stores or the parts give some of the files, the line adds ", N to run here". With no stored duration, the line ends "the whole run's time is unknown: no stored duration". No line is printed when no file is to run. Verdict, exit code and `QUALITY_POLICY_VERSION` do not change.

**D17.1, add at the end** (after the rows 020-45 and 020-46 text):

> Amended 2026-11-14 (row 020-57, #212; research `research/issue-212-setup.md` Q1, recommendation A): the stored durations assume a free host. The gate reads the host's one-minute load and CPU count once before the first run, with the daemon's own measure (`hostLoad`). When the load per CPU, rounded to two decimals, is over 1, each runner's estimate and the whole run's are multiplied by it and rounded up. The over-budget line, the rerun's `--timeout` and the early stop then use the scaled estimate. At or below 1 per CPU, or with no load reading (Windows), nothing changes. Each scaled runner line says so, for example `Vitest: 1 test file to run here, up to 23 at once: about 84 s from its stored duration, scaled by the host's load (42 s times 2, its one-minute load per CPU), over the 59 s left of the budget.`, and the whole-run line reads `about 84 s in all at the host's load, over …`. D7's `runs[].estimate` gains `load: { perCpu, unscaled }` when the estimate was scaled: `seconds` is the scaled estimate, `unscaled` is the stored durations' own. Not measured: whether load per CPU predicts the slowdown (the research's open question 2; #212 ran at least 4.6 times slower at a load of 140 to 175 on 24 CPUs). The estimate does not change the verdict, the exit code, a gap or `QUALITY_POLICY_VERSION`.

**D7, the list of later fields:** add `runs[].estimate.load` (D17.1, row 020-57).

## Decisions the spec did not settle

1. **The load hand-off crosses `collect.ts`** (row 020-55's file). Asked the parent (request e3d94336). Answer: A, a two-line edit in its own commit. The parent asked to read the load once per gate run, through `options.hostLoad`. The read is just before `orderRuns`, after the stored lookup and before the selection line, so before any run.
2. **How the gate knows a setup file.** Asked the parent (request 98bfddb4). Answer: A, read `setupFiles` from `environment().resolvedConfig` in one named helper (`setupFilesOf`). Any other shape gives no entries, so the no-loader line prints as before. The parent files the follow-up B row.
3. **Scale "above 1".** The factor is the load per CPU rounded to two decimals, used only when it is over 1. The research measured the reporter's run at least 4.6 times slower at a load of 140 to 175 on 24 CPUs (5.83 to 7.29 per CPU). A plain load-per-CPU factor would have turned #212's 500 s estimate into about 2,920 to 3,650 s (inferred, not run). That is over the 1,800 s budget, so the over-budget line and the rerun command would have printed. The early stop needs at least twice what is left (about 3,580 s), so it would have printed only near the top of that load range. The CPU count is `availableParallelism()`, as for the daemon and the rerun. Under `taskset` it counts the visible CPUs (research open question 4).
4. **The setup-selection line goes with the estimate, not with the selection lines.** The brief wants the count and the estimate against the budget on one line. The budget fit exists only at the estimate. So `preRunOptions` keeps the summary from `selected` and prints the line at `estimated`, before the runners' estimate lines. `estimateOptions` keeps only the rerun command. This keeps `src/cli/code-gate.ts` unchanged.
5. **What the line covers.** Every changed path in a project's `RunnerEnvironment.files`, so a config or global setup edit gets the line too. Such an edit also selects the project whole. A path that every test file imports through its own closure does not get the line: finding it needs every closure before the run.
6. **One line per runner**, not one per path: the paths are listed (three named, then "and N more"), with `setupFiles` entries first and marked.
7. **`runs.ts`** (not in the brief's list) copies `load` into `runs[].estimate`. The parent asked for the unscaled number in the report and for `runs[].estimate.load` in D7 (request e3d94336). `withoutRunner` picked fields one by one, so it needed one more.
8. **Which files count as loaders of a setup entry:** only the project's selected files that the scope runs (`Picked.run`), not left-out ones (D14.2). A left-out file does not run, so no record holds the entry, and the line stays when the scope runs no file of the project.

## Follow-up row text (B, filed by the parent)

> **020-xx the gate reads a project's setup closure from the runner** — Row 020-57 reads `setupFiles` entries from Vitest's resolved config, so a changed file that only a setup file imports (its closure) still prints "will read incomplete (no-loader)" before the run, although every completed file's record measures it. Add an optional adapter member, for example `setupFiles?(): Promise<readonly { project; files }[]>`, giving each project's `setupFiles` entries and their import closure (Vitest: `projectInputs(vitest, project).setup.files`, project files only, relative). It needs the runner-host member plumbing that `globalSetups` has (`src/core/types/runner.ts`, `src/core/runner-host/{protocol,host,proxy}.ts`, `src/runners/vitest/adapter.ts`). It could also sit on the adapter's `traits` object, which `RunnerAdapter` has carried since 0.1.473. Then `setup-selection.ts` `projectInputs` uses it in place of `setupFilesOf`, and `setupFilesOf` goes. Done when: an edited helper that only the setup file imports gets no no-loader line, and a config or global setup file keeps its line.

## Done-when mapped to tests

| Done-when | Test |
| --- | --- |
| A setup-file change prints no no-loader line | `test/cli/code-gate-setup.test.ts` "prints no no-loader line for a setupFiles entry…" (real Vitest: no line has `no-loader`; `resetEnv` reads `pass`; exit 0). Unit: `test/code/gate/setup-selection.test.ts` "counts a setupFiles entry as loaded…". |
| …and does print the setup-selection line | Same CLI test: the exact line between the selection and the estimate, before any setup or test ran (marker). Wording: `test/cli/code-gate-prerun-text.test.ts`. |
| The no-loader line stays where it is true | `code-gate-setup.test.ts` "keeps the true no-loader line for a global setup…" (exit 3, `incomplete`); unit tests for a config, a global setup, a setup file's own import, a project the scope runs no file of, and a runner with no environment. |
| At twice the CPU count the estimate doubles | `test/code/gate/plan.test.ts` "at twice the CPU count, doubles each estimate…"; `test/code/gate/collect-load.test.ts` (real node:test: 2x the free host's estimate, `load: { perCpu: 2, unscaled }`); `code-gate-setup.test.ts` "on a busy host" (42 s → 84 s, report `runs[].estimate.load`). |
| …and the over-budget line, rerun command and early stop follow it | `plan.test.ts` "the rerun and the early stop follow the scaled estimate" (fits on a free host; at load 2 it stops early, rerun 1260 s); `collect-load.test.ts` (early stop runs the 2 loaders, rerun ≥ 4x the free estimate); `code-gate-setup.test.ts` (the over line and the rerun line at the host's load; no rerun at the CPU count). |
| Below the CPU count nothing changes | `plan.test.ts` "at or below the CPU count, or with the load unknown, changes nothing" (QUIET, AT, null equal to no load); `estimate.test.ts` `loadFactor`; `code-gate-setup.test.ts` at AT (42 s, no `load`, no rerun). |
| Verdicts and exit codes unchanged | `code-gate-setup.test.ts`: pass/0 at AT and at OVER; setup edit pass/0; global setup edit incomplete/3. `collect-load.test.ts`: the early stop's own rule (function `pass`, verdict `incomplete`), as `collect-early.test.ts` has it. No `QUALITY_POLICY_VERSION` change. |

## Checks run

- `pnpm run lint`: clean (`Checked 3393 files … No fixes applied.`).
- `pnpm run typecheck`: clean.
- Squeal affected tests, through `squeal status --wait` on the changed sources (revision 22, `da19c4620`). The new and named test files pass: `setup-selection`, `collect-load`, `plan`, `estimate`, `collect-prerun`, `code-gate-setup`, `code-gate-prerun-text`, `version-sensitive`. Final verdict at revision 24 (the code of `da19c4620`): 359 affected test files, each with a current result, after 535.6 s; 4 known failures, all bundle drift (below); every other affected file passes, `code-gate-prerun`, `code-gate-estimate`, `code-gate-budget`, `collect-early`, `collect-retry`, `code-gate-retry` and `code-gate-failed-outside` among them.
- Expected failures, not fixed: the four bundle-drift checks (`test/harness/plugin.test.ts`, `test/harness/opencode/package.test.ts`, `test/harness/pi/package.test.ts`, `test/harness/codex/packaging/runtime.test.ts`: "cli/squeal.mjs differs from the build"). The wave forbids `pnpm run build` in a worker tree; the integration rebuilds `plugins/claude-code/dist` and the other bundles.

## Checks not run

- No full suite and no `squeal run --all` (wave rules; CI runs the full suite).
- No `pnpm run build` (wave rule).
- `test/e2e/**` (excluded from Squeal): none touches the gate's pre-run lines.
- No measurement under real load, by the rule against making load. Whether load per CPU predicts the slowdown stays open (research open question 2).

## For the next worker

- Seam map: `collect.ts` gives `orderRuns` the load → `orderRuns` (`plan.ts`) scales `estimates` and `whole` → `fitRuns` fits `whole` (over-budget, rerun, early) → `steps.ts` `tellEstimates` passes `order.estimates` to the CLI and the report (`runs.ts` `withoutRunner`). The selection side: `collect.ts` `tellSelection` → `prerun.ts` `summarize` → `setup-selection.ts` (`projectInputs` calls `environment()` once per pick with a file in scope; `loadedSetupFiles`; `wholeProjects`) → CLI `preRunOptions.selected` keeps `wholeProjects` for `estimated`.
- `environment()` is now called once more per gate run per runner with a selected file (the stored lookup calls it too). It reads the setup and global setup closures; it runs nothing.
- Row 020-55 also edits `collect.ts`. This row's change there is two lines next to `orderRuns`.
