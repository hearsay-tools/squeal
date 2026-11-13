# Row 020-54 notes: the gate reruns once a failure recorded while the host was overloaded (#210)

Worker 926f04b4, wave 19, 2026-11-13. Shape: slice. Base: main at `029499709`.

A selected file that fails here while the host's one-minute load is at or
over its CPU count now runs once more, after every other run, inside the
budget. The rerun's result is the file's result. The report names it in
`runs[].retried`, and stderr says so in one line after the verdict.

## Commits

| Commit | What |
| --- | --- |
| `48dc2c972` | Report field alone: `FileRetry`, `TestFileEvidence.retried` (`types.ts`), `GateRunReport.retried` (`report.ts`). Additive. |
| `e5678b975` | The rerun: new `src/core/code/gate/retry.ts`; `lanes.ts` (`runLanes`, `runOne`); `runs.ts` (`retriedOf`); `collect.ts` (`CollectOptions.hostLoad`, a seam); tests `lanes-retry`, `collect-retry`, `retry-text`. |
| `fbda1e5e8` | The stderr line in `src/cli/code-gate.ts` (`afterVerdict`), test `test/cli/code-gate-retry.test.ts`. |
| `4cb24bd2e` | The coordinator's added test: a retried file is not kept; the next gate on the same bytes runs it again. |
| (this file) | Notes. |

Type changes, all additive: `FileRetry` (new, `types.ts`);
`TestFileEvidence.retried?`; `GateRunReport.retried?`;
`CollectOptions.hostLoad?: () => HostLoad`. `EndedRun` (`evidence.ts`) did
not change: `lanes.ts` extends it privately (`LaneRun.overloaded`).
`QUALITY_POLICY_VERSION` did not change.

## Proposed spec text

**D3.4, add at the end** (after the row 020-43 text):

> Added 2026-11-13 (row 020-54, #210; the human, 2026-11-13: "Retry once"):
> a selected file that failed here runs once more when the run that failed it
> ended while the host's one-minute load average was at or over its CPU count.
> The measure and the threshold are the daemon's own load gate (spec 001 D6 as
> amended, `hostLoad` and `loadAllows` in `src/core/retry/load.ts`). The gate
> reads the load once per run, when the run ends, and only when a file in it
> failed. Once every run ended, the files to rerun go once more through the
> runner that ran them, each runner's at once, with what is left of the
> budget. When the rerun completes the file, its result is the file's result:
> a pass reads passed, and a failure that fails again stays failed. When the
> budget or a crash stops the rerun, the first run's failure stands. A file is
> rerun at most once. No file is rerun when its evidence came from the stores
> or the parts, when the load was below the CPU count or is not known
> (Windows), or when no budget was left at the end of its run or at the start
> of the rerun. The rerun does not change a rule: the verdict reads the file's
> final evidence as before, and `QUALITY_POLICY_VERSION` does not change.

**D7, add after the row 020-50 paragraph:**

> Added 2026-11-13 (row 020-54, #210): `runs[].retried`, by path, each
> selected file that ran once more under load (D3.4): `load`, the one-minute
> load average when its first run ended, to two decimals; `cpus`, the CPU
> count then; `outcome`, `passed` or `failed` (the file's result here is the
> rerun's) or `not-finished` (the first failure stands). Absent when no file
> ran again. After the verdict, stderr gets one line for all of them: the
> count, the highest load per CPU as load and CPU count, and each outcome's
> count with at most three paths, for example `squeal code: 1 test file failed
> while the host load was at or over its CPU count (24 on 24 CPUs) and ran
> once more: 1 passed (test/flaky.test.ts).` The line comes after the parts'
> refusal lines and before the kept-log line.

**D17.3, add at the end:**

> Amended 2026-11-13 (row 020-54; the coordinator, request 27108c13, "A"):
> neither run of a file that ran again under load (D3.4) is written. The
> keeper hears the first run without that file's record, and the keeper's
> lookup serves a file's first run only. The next gate on the same bytes runs
> that file again. A follow-up row may keep the rerun's result at the key.

**D3.5 (kept logs), add:**

> Amended 2026-11-13 (row 020-54): a rerun (D3.4) is a run of its runner kind
> too. Its log folder joins the kind's one kept folder after its first run's,
> so where both wrote a file of one name (`vitest.log`, `report.json`, or a
> node:test project's files), the rerun's copy is kept. A first run whose
> failed files all passed on the rerun still keeps its log: it shows the
> failure that was retried.

D11.2 does not change: failures stay a gate input. The rerun changes what the
gate observes, not the rule.

## Decisions the spec did not settle

1. **When the load is read.** At the end of the run that failed the file.
   `RunReport` and `RunOptions` give no per-file end, so the run's end is the
   first point where the gate knows a file failed. Known limit: in a long run
   (a node:test entry with many files), the load at the run's end can differ
   from the load when the file failed. The one-minute average smooths this.
   The daemon samples at a tier's start; at the run's start the gate's own
   test load has not built up yet, so the end is the closer measure.
2. **Rerun after every first run.** "After the other files" read as after
   all runs of all runners end (`Promise.all`), not after the file's own
   runner. Reruns of different runners run at once, as the lanes do; node:test
   entries still share the slot pool. Run id `gate-<index>-rerun`, log folder
   `runs/<index>-rerun`.
3. **A rerun the budget stops keeps the first failure** (`outcome:
   "not-finished"`) instead of making the file "not finished". The verdict is
   `incomplete` either way. Keeping the failure keeps the failed test's name
   in `runs[].failed`. `budget.timedOut` becomes true, because the deadline
   stopped a run.
4. **A rerun that never started changes nothing.** When another runner used
   the rest of the budget, the rerun does not start: no `retried` entry, the
   first failure stands. The keeper did not hear that file's record (decision
   5), so this case loses one keep.
5. **Keeping (coordinator, request 27108c13, "A").** Neither run of a
   retried file is kept. Keeping the first failure would make the store say
   failed while the report says passed. The next gate on the same bytes would
   then read the failure from the store and not retry it.
6. **The rerun is not told to the keeper** (`CollectOptions.ran`). Its
   lookup is spent, so the tell would do nothing.
7. **The load is rounded to two decimals** in the report, so the report
   does not carry a float such as `30.05078125`.
8. **One stderr line** for all retried files, bounded to three paths per
   outcome (as the parts' refusal lines), with the highest load per CPU. It
   goes after the verdict, in `afterVerdict`, because the outcome is known
   only then and the text report (row 020-53's file) does not show retries.
9. **Rerun evidence.** A completed rerun gives the file's `failed`,
   `record`, `skipped` and `children`. So a passing rerun's coverage record
   is the one the functions are judged by.

## What follow-up B needs (keep the rerun's result)

The coordinator files this row. What it needs:

- `keep-expected.ts`: `Expectations.take(run)` drops a lookup whole after
  the first run, and `CodeGateKeeper.#queue` ends its run of `WorktreeKeys`
  (`pending.keys.endRun()`). A rerun finds no expectation, so the keeper
  takes nothing from it.
- The change: keep the retried files' expectations open past the first tell,
  or add them again from the same lookup before the rerun starts (a new
  `keys.beginRun()` and a fresh `copyInputs` snapshot). Then the rerun's tell
  takes them. The stability window must cover the time from the lookup to the
  rerun's end, so an input edited during either run bars the keep.
- In `lanes.ts` it is one change: tell the rerun to `options.ran` (drop the
  `rerun === undefined` guard on `tellRan` in `runOne`). `withoutRetried`
  stays, so the first failure is never kept.
- Tests: the second gate reads the retried file `from: store` with the
  rerun's outcome; an input edited during the rerun is not kept. The test
  `keeps neither run of the retried file` in
  `test/cli/code-gate-retry.test.ts` then changes to expect `store`.

## Done-when mapped to tests

| Done-when | Test |
| --- | --- |
| A failure above the threshold that passes on rerun reads passed and is named retried | `test/code/gate/lanes-retry.test.ts` "reads passed and retried when the rerun passes, after every other file"; `test/code/gate/collect-retry.test.ts` (real node:test, `flaky`); `test/cli/code-gate-retry.test.ts` "reads the rerun's pass at the threshold" (exit 0, `runs[].retried`, the stderr line) |
| One that fails again stays failed | `lanes-retry` "keeps a failure that fails again failed, and reruns it once only"; `collect-retry` (`broken`) |
| Below the threshold, no rerun | `lanes-retry` "uses the daemon's threshold" (23.99 and 3 on 24 CPUs, and an unknown load); `code-gate-retry` "keeps the failure under the threshold" (23.99, exit 3, no line) |
| No rerun past the budget | `lanes-retry` "does not rerun when the budget ended with the run" and "does not rerun when another run spent the budget first"; a rerun the deadline stops: "keeps the first failure when the rerun does not finish in the budget" |
| No rerun for stored and parts evidence | `lanes-retry` "never reruns a failure the stores or the parts gave" (the load is not even read) |
| The load sample uses the daemon's own threshold function | `lanes-retry` "uses the daemon's threshold": for each sample, a rerun happens exactly when `loadAllows` from `src/core/retry/load.ts` refuses (24 on 24 reruns, 23.99 does not). `code-gate-retry` replaces only `hostLoad` with `vi.mock` and keeps the real `loadAllows`. The source imports both from `retry/load.ts`. |
| The coordinator's addition: a retried file is not kept; the next gate runs it again | `code-gate-retry` "keeps neither run of the retried file". Mutation check: with the first run's record told to the keeper, this test fails (`flaky` read `from: store`). |
| The stderr line is one line and bounded | `test/code/gate/retry-text.test.ts` |

## Checks run

- `pnpm run lint`: `Checked 3344 files in 1141ms. No fixes applied.`
- `pnpm run typecheck` (`tsrs --fast --noEmit`): exit 0.
- `squeal status --wait` on each new test file: `lanes-retry`,
  `collect-retry`, `retry-text` and `code-gate-retry` each current and
  passing. `retry-text` first failed (`listPaths` names five, not three);
  fixed with `RETRIED_NAMES = 3`, then FAIL -> PASS.
- Direct `pnpm exec vitest run`, to see the test counts of new files:
  `lanes-retry` 8 passed of 8; `collect-retry` 1 of 1. Mutation run of
  `code-gate-retry`: 1 failed (the keep test, as intended), 2 passed;
  source restored with `git checkout`.
- `squeal status --wait 600000` over the seven changed source paths
  (revision 25): 330 affected test files pass; 4 fail, all bundle drift
  (`cli/squeal.mjs differs from the build`: `test/harness/plugin.test.ts`,
  `test/harness/codex/packaging/runtime.test.ts`,
  `test/harness/opencode/package.test.ts`, `test/harness/pi/package.test.ts`);
  22 were still pending at the deadline. A second wait (revision 26):
  342 pass, the same bundle drift, 10 queued for CPU (the host had 17 of 24
  cores busy). A third wait on those 10 minus the three drift files:
  `code-gate-keep`, `collect-budget`, `warmup`, `departure`, `drain-wait`,
  `lifecycle`, `shared-store` all pass ("no known failures; 7 test files,
  each with a current result, after 330.0 s"). End state: 349 affected test
  files pass; 4 fail, all bundle drift; the three drift files were queued
  again at the end and were not waited for.

## Checks not run

- `pnpm run build`: the wave forbids it in a worker tree. The four bundle
  drift failures above are expected until the coordinator rebuilds the
  bundles at integration.
- No full suite (wave rule; CI runs it).
- No experiment on a really overloaded host (no artificial load). The tests
  replace the load reading only.

## Repair R1 (wave 19.5, review `reviews/0.1.468.md` B1)

Base: this branch with row 020-53 cherry-picked (`029499709..cez/f3c22710`,
nine commits, no conflict). The repair commits come after them.

**The defect.** Gate tests that are not about the rerun read the real host
load. On a small CI runner the load is at or over the CPU count, so a test
with a failing file got a rerun it did not expect. CI failed
`code-gate-failed-outside.test.ts` (B was run again, not read from the
stores, because neither run of a retried file is kept),
`collect-prepare.test.ts` (two adapter runs, not one) and
`code-gate-log.test.ts` (the kept-log line). The product behaviour is right.

**The repair.**

- Seam, CLI (`src/cli/code-gate.ts`): `GateIo extends CliIo` with an
  optional `hostLoad`, which the gate gives the collector as
  `CollectOptions.hostLoad`. `codeCommand` passes its io object through, so
  a test's io reaches the gate unchanged. No environment variable. A
  `--json` relaunch's child reads the host's own; the seam is in-process.
  `CliIo` (`main.ts`) does not change.
- Seam, collector: `CollectOptions.hostLoad` (row 020-54) as it was.
- Test constants: `test/code/gate/host-load.ts`: `QUIET` (0 on 24),
  `AT` (24 on 24), `OVER` (48 on 24), and `quiet`.
- Fixture defaults: the collector fixture's `collect()` and the CLI
  fixture's `code()` give `quiet` unless the test gives a load. `code()`
  takes `hostLoad: null` for the daemon's own reading. The keep and parts
  kits go through `code()`, so they are pinned too.
- Direct callers: `collect.test.ts`'s `options()` runs `fails.test.ts` and
  `broken.test.ts` here, so it gives `quiet`.
- The three CI tests now mock the daemon's own `hostLoad` as a loaded host:
  `code-gate-failed-outside` over (48 on 24), `collect-prepare` and
  `code-gate-log` at (24 on 24). They pass only because of the pin.
- The rerun tests keep their loads: `lanes-retry` and `collect-retry` give
  them through the seam; `code-gate-retry` gives `hostLoad: null` and mocks
  the daemon's `hostLoad`, so it still proves the default reading. Its
  no-storage test (choice A) is unchanged.

**What I checked for other unpinned tests.** By reading: the direct
`collectEvidence` callers `collect-prerun`, `collect-closure` and
`collect-inputs` use fake adapters that complete no file;
`collect-stored`'s failing file comes from the stores; `collect-mixed`,
`collect-scope`, `collect-skipped`, `collect-order`, `collect-budget` and
`ci-record-coverage` select no failing file. The CLI tests that start a
real child (`code-gate-json-stdout`, `code-gate-keep-stop`,
`code-gate-prepare-cancel`) select no failing file, and the in-process
cases of `code-gate-relaunch` change no function.
