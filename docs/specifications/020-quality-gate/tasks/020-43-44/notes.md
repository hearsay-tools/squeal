# Rows 020-44 and 020-43: runners at once, and the files using the budget (#196)

Worker f20aa6f5, wave 16, base `w16/base` (`ca51db505`). Brief: `tasks/wave-16.md`, section "020-44 and 020-43". Ownership agreed with the coordinator in request `0a18ccd3` (the node:test and Vitest construction options; the one `runLines` edit in `src/cli/code-gate-text.ts`).

## What changed

- **Runner hooks** (`117d056cf`). Two optional construction options, given only by the gate:
  - node:test `slots: (signal) => Promise<release | null>` (`NodeTestRunOptions.slots`, `NodeTestAdapterOptions.slots`). Before each file's process starts, the run loop takes a slot and gives it back when the process exits (in a `finally`). The `signal` is aborted by `stopAll` (deadline or stop), so a waiting worker gets `null` and the file does not start.
  - node:test and Vitest `fileStarted: (ref) => () => void`. node:test calls it as the file's process starts and calls the returned function after the exit. Vitest's `RunCollector` calls it from `onTestModuleQueued` (a worker starts to collect the file) and calls the returned function from `onTestModuleEnd`, in any state. Both run inside `#hook`, which sends a throw to the run log, as `fileEnded` already did.
  - `RunOptions`, `RunOptions.fileEnded` and the runner-host protocol do not change. node:test still never calls `fileEnded`: calling it would change the daemon's leases (`tiers.ts` `shrinkTo`) and yield counts. Without the options the daemon's path is the same code with one more `finally`.
- **Gate** (`2a53f6f2d`, `fa0bdd105`).
  - `lanes.ts` (new): `SlotPool` (FIFO, `runner.tierSize` slots, at least 1, a release counts once, an aborted wait leaves the queue) and `runLanes`: every node:test entry's `prepare` first, in D18's order, then every run with a file left starts at once (`Promise.all`), each with `timeoutMs` = what is left of the one deadline. `runOne` is the old loop body. A file of a run that neither completed nor was told started gets `notStarted: true`.
  - `progress.ts` (new): `FileProgress` records each start; it names a file once when it still runs past `max(stored seconds, overrunFloor(budget))`, `overrunFloor` = `max(10 s, budget / 20)`. Timers are `unref`'d and cleared at `close()`, after the runs.
  - `collect.ts`: makes the pool and the progress, gives them to `openRunners` (`runners.ts`: `slots` to each node:test entry, `fileStarted` to both kinds), and calls `runLanes`. `CollectOptions.overran` is new.
  - `runs.ts`, `report.ts`: `runs[].notStarted`.
  - CLI: `code-gate-progress.ts` (new) holds `overrunText` and `timed`, moved out of `code-gate.ts` (now 256 lines). `timed` counts a runner kind's time as the union of its runs, so two node:test entries at once count once; for runs in turn it equals the old sum.
- **Text** (`14f2bddad`, agreed in `0a18ccd3`): `runLines` keeps "did not finish in the N s budget" for a started-and-stopped file, and counts the never-started ones in one line per runner: `  2 node:test test files did not start in the 25 s budget; --json lists them`.
- **Shared list** (`47ce9eea7`): `collect-lanes.test.ts` runs real `node --test`, so it joins `test/version-sensitive.txt`, as `collect-budget.test.ts` is.

## Decisions the spec did not settle

1. **`notStarted` is a subset of `notFinished`**, and absent when empty. `notFinished` keeps its meaning (every selected file that started a run and did not complete, `notPrepared` excluded), so a consumer that reads it sees the same list. Files that worker fb85034a's early stop skips get their own flag (`overBudget`, per the coordinator) and are not given to a run, so they never read `notStarted`.
2. **"Past its estimate"** is past its stored seconds (1×), with the floor above. The research proposed 2× stored or 60 s; at 2× #196's launcher (207 s stored, 431 s left) would be named at 414 s, too late to help; at 60 s the starve shape (25 s budget) names nothing. The floor keeps short files that run a little over their stored time from making lines: at 600 s it is 30 s.
3. **Every `prepare` before any run** (research Q1 risk b): a `prepare` cannot rewrite files a Vitest file reads while it runs. Vitest then waits for the prepares. D15.3 still holds ("once, before the entry's first selected file").
4. **The pool is first come, first served.** The entries' runs start in D18's order, so the first entry's workers ask first; after that, a slot freed by one entry goes to the next waiter, so entries take turns file by file. Each entry's own files keep D17.2's order.
5. **Entries with a different `node` or `cwd` share the pool** (research open question 3). Each file is its own process with its own command and `cwd`, so nothing is shared but the count. The daemon runs them in turn inside a tier; the gate now runs them at once.
6. **The Vitest start** is `onTestModuleQueued`. Verified on a real run with one worker (`collect-order.test.ts`: in path order the second file never gets the worker and reads not started). Not verified with more than one worker or on Vitest 4 (research open question 4); with more workers, a file queued early would read started and is never wrongly not started.
7. **Runner durations**: `runs[].durationMs` is the union of a kind's runs (see `timed`).

## Proposed D18 text (replaces D18.1 to D18.4)

> ### D18. Order across runners (row 020-19, #187; amended by row 020-44, #196)
>
> 1. The gate runs its runners at once, as the daemon's lanes run: first each node:test entry's `prepare` (D15.3), then every runner's run starts under the one deadline (D3.4). Vitest runs with its own workers. The node:test entries share one pool of `runner.tierSize` processes: a file takes a slot before its process starts and gives it back when the process exits, so while one entry's slow file runs, the free slots go to the files of the other entries. The gate never stops a running file to make room; only the deadline stops one. Before, the runners ran one after another, and a runner that held the budget left every later runner's files unrun (#196).
> 2. The runners keep their order by D17.1 estimate, the smaller first. A runner with an unknown estimate counts by its file count at the median known duration; with no store at all, the runner with fewer files comes first. Ties keep Vitest, then node:test entries in config order. It is the order the pre-run print lists them in, and the order in which the node:test entries first ask the pool for processes; the pool gives them in the order asked.
> 3. Each runner's own files keep D17.2's order. Running at once changes no verdict and no rule: `QUALITY_POLICY_VERSION` stays.
> 4. The pre-run print lists the runners in that order.
> 5. A runner's `runs[].durationMs` is the time any of its runs ran, so node:test entries that run at once count once.

## Proposed spec text for 020-43 (D3.4 and D7)

> D3.4, added: while the runs go, stderr names once each file still running past its estimate: its stored seconds, and never less than 10 s or a twentieth of the budget, whichever is more; with no stored seconds, that floor. For example `squeal code: node:test is still running n1/slow.test.ts after 10 s (no stored duration); 11 s of the 25 s budget used`. With `--json` it goes to stderr, as every line but the report does (D14.4).
>
> D7, `runs[]` gains `notStarted`: the files of `notFinished` that never started, because the budget ended first or their run stopped before them; absent when every unfinished file started. The text report keeps one line per file that started and was stopped, and gives one count line per runner for those that never started.

## Proposed `commands.md` text (not edited: outside this row; worker fb85034a may edit the same paragraph)

In the three copies (`plugins/claude-code`, `plugins/codex-runtime`, `plugins/pi` `skills/squeal/references/commands.md`):

- Line 128, replace the sentence that begins "The runners run one after another" with: "The runners run at once, as the daemon's lanes do: Vitest with its own workers, and the node:test entries sharing `runner.tierSize` processes, so a slow file of one entry does not keep the others' files from running; no running file is stopped before the deadline. stderr lists the runners in the order of their estimate, the smaller first. While the run goes, stderr names once each file still running past its stored time (and at least 10 s, or a twentieth of the budget when that is more), for example `squeal code: node:test is still running n1/slow.test.ts after 10 s (no stored duration); 11 s of the 25 s budget used`."
- Line 164 (`--json`), after "`completed` and `notFinished`" add: ", `notStarted` when a file of `notFinished` never started (the budget ended first)".

## Done-when to tests

| Done-when | Test |
| --- | --- |
| The starve shape finishes the other runners' files within the budget | `test/code/gate/collect-lanes.test.ts` (fixture `test/fixtures/code/gate/lanes`: a never-ending node:test file, two quick files in its entry, two in a second entry, three Vitest files, `runner.tierSize` 2, 25 s budget): every file but the slow one completes; `src/b.ts` and `src/c.ts` pass, `src/a.ts` reads `incomplete`/`not-finished`. `collect-budget.test.ts` case 1 now has node:test's file complete beside Vitest's never-ending file, whatever the order. |
| One shared node:test pool | `test/runners/node-test/run-slots.test.ts`: two entries' runs at once, `concurrency` 3 each, never more than the pool's 2 processes; a pool with no free slot starts no file before the deadline. `test/code/gate/lanes.test.ts`: `SlotPool`. |
| A file running past its estimate is named once | `test/code/gate/progress.test.ts` (fake timers: once, at its stored seconds or the floor; not after it ended or after `close`); `collect-lanes.test.ts` (the real slow file named exactly once, before the deadline); `test/cli/code-gate-progress.test.ts` (`overrunText`). |
| The report separates started from never-started | `collect-order.test.ts` (real Vitest, one worker: stopped file started, the file behind it not started); `collect-lanes.test.ts` (`runs[].notStarted` absent when every unfinished file started); `test/cli/code-gate-text-started.test.ts` (text lines). |
| Verdict rules and `QUALITY_POLICY_VERSION` unchanged | No change to `evaluate.ts`, `rule.ts` or `policy.ts`; the collector tests' verdicts are as before except where a file now completes. |

## Type changes (all additive)

- `NodeTestRunOptions.slots?`, `NodeTestRunOptions.fileStarted?`; `NodeTestAdapterOptions.slots?`, `.fileStarted?`.
- `VitestAdapterOptions.fileStarted?`; `VitestAdapter` and `SizedVitestAdapter` constructors gain a last optional `started`; `RunCollector` constructor gains a last optional `started`.
- `GateAdapters.vitest` options gain `fileStarted`; `GateAdapters.nodeTest` options gain `slots` and `fileStarted` (required in the gate's type, since the gate always gives them; the real constructors take them as optional). New `FileStarted` type in `runners.ts`.
- `CollectOptions.overran?`; `TestFileEvidence.notStarted?: true`; `GateRunReport.notStarted?`.
- New exports: `SlotPool`, `runLanes`, `LaneContext`, `Lanes` (`lanes.ts`); `FileProgress`, `Overrun`, `overrunFloor`, `ProgressOptions` (`progress.ts`); `overrunText`, `timed` (`src/cli/code-gate-progress.ts`).

## For the next worker or the integration

- `estimateText` (`code-gate-text.ts`, not this row's) still adds each runner's estimate to the ones before it ("`N s with the runs before it`") and calls a line over budget from that sum. With runners at once the lane that matters is the larger one. The coordinator said it switches `runSeconds` to the larger lane at integration; the text's sum needs the same change.
- `commands.md`: the text above.
- Research open question 2 (how much two lanes slow each other on a loaded host) is still not measured. The peak process count is now Vitest's width plus `runner.tierSize`, the daemon's own peak.
- The kept-log merge (`keptLogs`, 020-40) still gets one log folder per run, now from runs that overlapped; node:test projects still write under their own `node-test/<project>/`.
