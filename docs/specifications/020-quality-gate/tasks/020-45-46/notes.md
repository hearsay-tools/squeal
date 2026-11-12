# Rows 020-45 and 020-46: over budget, one rerun command, and the early stop (#196, #198)

Brief: `tasks/wave-16.md`, "020-45 and 020-46". The human, 2026-11-13:
"Build all three" (budget rows) and "Stop early". Research:
`research/gate-budget.md` Q2 (E0 and E2), `research/issue-198.md`.
Worker fb85034a, base `w16/base` (`ca51db505`).

## What the gate does now

1. After the stored lookup and the selection print, the collector
   estimates the whole run (`estimateAll`): each runner's D17.1
   estimate, a runner with no stored duration at the median of every
   runner's stored durations (D18.2's rule), combined by `runSeconds`.
2. It fits that estimate to the whole seconds left of the budget
   (`fitBudget`, `fitOrder`):
   - fits, or unknown: nothing new;
   - over what is left: a rerun `--timeout` N = seconds spent before the
     estimate + 2 x the estimate, rounded up to a whole minute;
   - at least 2 x what is left, and at least 20 files to run with a
     stored duration: the early stop.
3. Early stop (`inLoaderOrder` with `early`, `splitEarly`): each runner's
   files in D17.2's loader order, filtered to those that may load a
   changed function. A file runs when its closure loads the path of a
   changed function, its closure is unknown, it is a `--test` file, or
   only its declared `inputs` chose it (row 020-35). The others are the
   run's `overBudget`.
4. Each `overBudget` file gets evidence with `completed: false`, its
   closure read with no run, no record, `overBudget: true`
   (`stoppedEarly`). It is not in `prepare`'s list, so a node:test entry
   whose files are all over budget runs no `prepare`.
5. stderr, after the runners' estimate lines (`budgetLine`):
   - over: `squeal code: about 700 s in all, over the 590 s left of the budget. A rerun that fits: squeal code --base main --timeout 1440`
   - early: `squeal code: about 1400 s in all, at least twice the 590 s left of the budget, so the gate stops early: it runs the 2 test files that may load a changed function, and not the 4 that load none (test/c1.test.ts, test/c2.test.ts, test/c3.test.ts and 1 more; the report lists them all). A rerun that runs them all: squeal code --base main --timeout 2820`
6. Report: JSON `budget.rerun: { seconds, command }` (absent when the run
   fits or its time is unknown) and `runs[].overBudget` (paths, sorted;
   absent when none; those files are not in `notFinished`). Text: one
   line per runner with over-budget files (count, first three, "--json
   lists them all"), and `A rerun that fits the estimate: <command>`
   before the `JSON report:` line.

Verdict: an over-budget file is not completed, so `verdictOf`'s
`unfinished` holds and the verdict is at least `incomplete` (D3.4). No
changed function's loaders include it (it loads none), so no function
state changes; if one somehow did, its gap would be `not-finished`, never
a pass. No new gap; `QUALITY_POLICY_VERSION` stays 4. `budget.timedOut`
stays `false` when only the early stop left files unrun.

## Decisions the spec did not settle (agreed with the coordinator 31e1d860, reply to request d0e2ffae)

- The rerun command is the call's own arguments, as given, with
  `--timeout N` in place of any given: `--base`, the paths, `--test`,
  `--group`, `--parts`, `--exceptions`, `--json`, in an order that parses
  the same (each list option ends at the next option; the test parses the
  words back). It is run as `statusCommand(env)` runs Squeal, like the
  report's JSON line. The brief's "and, where they fit, the path or
  `--group` arguments" is read as "keep the ones the call gave"; the gate
  does not propose narrower paths or groups (the ways-out text still
  names them).
- N = seconds spent before the estimate + `RERUN_FACTOR` (2) x the whole
  estimate, rounded up to a whole minute (research Q2, E0). It is the
  pre-run N in both stderr and the report; it does not shrink by the
  files kept during the run.
- "At least 2x the budget" is read against what is left when the estimate
  is told, as D17.1's over-line already is. The early stop also needs at
  least `EARLY_KNOWN` (20) files to run with a stored duration (research
  E2: one file's estimate is more than 2x wrong in 6.7% of runs, a sum
  over 20 or more in 2.5%). With no stored duration, never.
- "Load no changed function" is by closure against the paths of
  `changed.functions` (not `changed.paths`): a file that loads only a
  changed path with no changed function (a top-level edit, a file a
  config imports) does not run. `--test` files, inputs-only files and
  unknown closures always run.
- Field names: `TestFileEvidence.overBudget`, `GateRunReport.overBudget`
  (not `skipped`, which D11.3 uses for skipped tests, and not `stopped`,
  which research Q3 proposed for started-and-stopped files),
  `Evidence.rerun` / `GateReport.budget.rerun` with `GateRerun { seconds,
  command }`.

## Proposed D17.1 text (amendment)

Append to D17.1, replacing its "The estimate is advice: the run always
starts.":

> Amended 2026-11-13 (rows 020-45, 020-46; #196, #198; the human: "Build
> all three", "Stop early"). The whole run's estimate is each runner's
> estimate, a runner with no stored duration counted at the median of
> every runner's stored durations (D18.2), combined as the runners run
> (D18). When it is over what is left of the budget, one more stderr line
> gives it and one rerun command: the call's own arguments with `--timeout
> N`, N being the seconds spent before the estimate plus twice the
> estimate, rounded up to a whole minute (a summed estimate over 20 or
> more files is more than 2x wrong in about 2.5% of stored runs,
> `research/gate-budget.md` Q2). D7's `budget` gains `rerun: { seconds,
> command }`, and the text report names the command before the JSON line.
> When the estimate is at least twice what is left, from at least 20 files
> with a stored duration, the run starts with only the selected files that
> may load a changed function: those whose closure loads the path of a
> changed function or is unknown, `--test` files, and files only their
> declared `inputs` chose (D3.1). The others do not start: each reads not
> completed, its closure read with no record, so the verdict is at least
> `incomplete` (D3.4), and no function's state reads it (D5). The stderr
> line says how many run and names the first three that do not; D7's
> `runs[]` gains `overBudget`, their paths, apart from `notFinished`, and
> the text report counts them per runner. Otherwise the run starts whole.
> The estimate does not change the verdict, the exit code, a gap or
> `QUALITY_POLICY_VERSION`.

D7's list of later fields gains `budget.rerun` and `runs[].overBudget`
(D17.1).

## Proposed `commands.md` text (plugin references; not in this row's ownership)

`plugins/*/skills/squeal/references/commands.md` line 128 says "The
estimate is advice: the run starts anyway". Proposed replacement for that
sentence:

> When the whole estimate is over what is left, one more line names a
> rerun with a `--timeout` that fits it, for example `about 1400 s in
> all, over the 590 s left of the budget. A rerun that fits: squeal code
> --base origin/main --timeout 2820`; the report repeats it
> (`budget.rerun` in `--json`). When the estimate is at least twice what
> is left, from at least 20 stored durations, the gate stops early: it
> runs only the test files that may load a changed function and lists the
> others in `runs[].overBudget`. Those read not finished, so the verdict
> is `incomplete`, never a pass. The verdict does not read the estimate.

## Done-when to tests

| Done-when | Test |
| --- | --- |
| An over-budget run names a rerun command whose timeout fits the estimate | `test/code/gate/estimate.test.ts` (`fitBudget`), `test/code/gate/plan.test.ts` ("names a rerun ..."), `test/cli/code-gate-estimate.test.ts` (stderr line, text report and `--json` `budget.rerun`, N >= spent + 2 x 42 s and a whole minute), `test/cli/code-gate-budget.test.ts` (`rerunCommand` parses back as the call) |
| At 2x or more, non-loader files are skipped and named, loader files run | `test/code/gate/collect-early.test.ts` (fixture `early`, #198's shape in node:test: 2 loaders complete, 20 files read `overBudget`, function `pass`, verdict `incomplete`, `runs[].overBudget`, `notFinished` empty), `plan.test.ts`, `order.test.ts` (`splitEarly`), `code-gate-budget.test.ts` (stderr and text lines) |
| Under 2x nothing is skipped | `collect-early.test.ts` (one 700 s file, 600 s budget: all 22 complete, verdict `pass`, rerun named), `plan.test.ts`, `estimate.test.ts` |
| Verdict and exit unchanged otherwise | `collect-early.test.ts` (pass under 2x), `code-gate-estimate.test.ts` (exit 0, `Code gate: pass` over budget), `QUALITY_POLICY_VERSION` untouched |

The done-when line most likely to be false was "loader files run" at
the collector: a skipped file could have vanished from the evidence and
let the verdict pass. `collect-early.test.ts` reads the evaluated report.

## Seams and what the next worker or the integration must know

- Files outside this row's ownership, each touched in a commit whose
  subject says "wiring outside ownership" (agreed with the coordinator):
  `collect.ts` (fitRuns in place of inLoaderOrder; `stoppedEarly` in the
  run loop; `CollectOptions.rerun`; `estimated`'s third argument),
  `steps.ts` (`tellEstimates` takes the `BudgetTold`), `runs.ts`
  (`overBudget`, and out of `notFinished`), `evaluate.ts` (`budgetOf`),
  `code-gate.ts` (one line: `...estimateOptions(parsed, io)`),
  `code-gate-text.ts` (estimateText moved out; two report lines). Fields
  in `types.ts` and `report.ts` are one commit, fields only.
- Integration with 020-44 (lanes at once): `runSeconds` in `estimate.ts`
  is the one rule of how runner estimates combine; switch it to the
  larger lane (`Math.max`), and the early stop and the fitted N follow.
  `estimateText`'s cumulative "N s with the runs before it" and its
  per-line "over" check assume runners in turn; they need the same
  change. 020-43's `runs[].notStarted` must leave `overBudget` files
  out, as `notFinished` does.
- `runner-order.ts`'s private `cost` repeats `estimateAll`'s per-runner
  rule (own estimate, else the global median); a quality scan can make
  `runnerOrder` use it.
- `collectEvidence` and the CLI's `gate` stay at complexity 20 (the
  limit): the early-stop branches live in `plan.ts` (`fitRuns`,
  `stoppedEarly`) and the env lookup in `estimateOptions`.
- With `coverage.children`, a skipped file whose child process would
  load a changed function is not run; that function then reads
  `no-loader` (incomplete), never a pass. Not special-cased.
- Bundles: `plugins/claude-code/dist` is not rebuilt by this row, so
  `test/harness/plugin.test.ts` ("bundles are committed exactly as the
  build produces them") fails until integration rebuilds it.
