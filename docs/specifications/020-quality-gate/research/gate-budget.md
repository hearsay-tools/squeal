# Row 020-41: the gate's time budget across runners (#196, #198 part 2)

Recommendation: run the gate's Vitest lane and its node:test lane at the same time, as the daemon's lanes already run, and let the node:test entries share one pool of `runner.tierSize` processes. Never stop a running file to make room. Name the files that hold the budget while they run and in the report. Keep "the run starts", but end every over-budget report with one rerun command with a fitted `--timeout`. Stopping early, before the files that load no changed path, is an option for the human.

Examined 2026-11-12: Squeal main `52534310d` (0.1.457), the released 0.1.457 bundle for probes, Vitest 5.0.3 in this repository and 4.1.10 in `~/projects/cezar/node_modules` (read only), Node 26.13.0, 24 vCPUs. The one-minute load was 76 to 98 from 17:30Z. The live probes ran from 22:42Z to 22:44Z at a one-minute load of 21.1 to 22.7, under the guard's limit of 24 (`probes/gate-budget/guard.sh`); see "Live probes".

| # | Question | Answer | Tag |
| --- | --- | --- | --- |
| 1 | A bounded rule that lets later runners produce evidence when the first overruns | Lanes at once (the daemon's rule), plus one node:test pool across entries. A share per runner and a per-file cap both stop running files: the stopped work is lost, and the later runner gains less. | read in source code; inferred (model); verified by experiment (starve, control, long: today's starvation on 0.1.457) |
| 2 | An early over-budget outcome and the command it names | Keep the run. Name `squeal code --base <ref> --timeout <N>`, with N from the estimate, before the run and in the final report, and say how many completed files are kept for that rerun. Option for the human: stop before the files that load no changed path when the estimate is at least 2× over. | read in source code; verified by experiment (store history); inferred |
| 3 | Naming the file that consumes the budget while it runs | Both runners already know when a file starts; the gate is not told. Add a start callback, a stderr progress line, and a report that tells a stopped file (with its seconds) from one that never started. | read in source code; verified by experiment (hooks on Vitest 5.0.3; starve on 0.1.457) |

## Q1. Sharing the budget across runners

**What happens today. read in source code** (`52534310d`):

- The collector runs one pick after another: Vitest, then each node:test entry, in D18's estimate order (`collect.ts:190-214`, `plan.ts:54-77`). Each run gets what is left of the one deadline as `timeoutMs` (`collect.ts:200-204`). A pick reached after the deadline runs nothing.
- Each node:test entry is its own pick, so its own run. The entries run in turn.
- In a node:test run, a worker loop starts one process per file, `concurrency` at once. At the deadline every running process gets SIGTERM, and no queued file starts (`src/runners/node-test/run/run.ts:151-219`). When the queue is empty and one slow file still runs, the other slots stay idle until it ends.
- So in #196 the launcher file held the run for the whole 431 s. Three of the four node:test slots and all of Vitest's workers were idle. In the 0.1.447 comment, 11 of entry 1's 12 files ended and the other 139 files in later entries never started.

**The daemon does not do this. read in source code** (spec 011, line 136; spec 001, line 110): "Tiers run one at a time per lane, ... and the lanes run at once. ... Vitest is one lane and every node:test project together another. ... The cap is one tier per lane, each with its runner's own workers: two today." Inside the node:test lane, "a composite's adapters share a lane but run in turn" (`src/core/types/runner.ts:691-697`, `tierPart`). The gate's turn-taking across runners is its own rule (D3.2, D18), not the daemon's.

**Model on #196's numbers. inferred** (`probes/gate-budget/simulate.mjs`, output `simulate.out.txt`). Case A: 431 s left; node:test runs 1 file stored at 207 s; Vitest runs 1,232 files, 2,114 s at width 5 (8.58 s each). Case B (the comment): 492 s left; node:test only, 151 files, 343 s at width 4; the launcher and 11 quick files in entry 1, 139 files in later entries. The launcher takes 311 s (the retry) or 700 s (stands for "did not finish in either budget"). Every file of a group costs the same, and the runners do not slow each other.

| Rule | A, launcher 311 s | A, launcher 700 s | B, launcher 311 s | B, launcher 700 s |
| --- | --- | --- | --- | --- |
| R0 today: in turn | node 1, Vitest 65 | node 0, Vitest **0** | 104 | **11** |
| R1 share by estimate (stop at the share) | node 0 (38 s stopped), Vitest 225 | node 0, Vitest 225 | 104 | 11 |
| R2 per-file cap at 2× stored (414 s) | node 1, Vitest 65 | node 0, Vitest 5 | 104 | 51 (launcher stopped) |
| R3 lanes at once | node 1, Vitest **250** | node 0, Vitest **250** | 104 | 11 |
| R4 R3 and one node:test pool across entries | node 1, Vitest 250 | node 0, Vitest 250 | **151** | **150** |

Files completed in the budget. R0's 0 and 11 match both reports.

**The options, with cost and risk:**

- **R1, a share per runner.** Each runner gets a part of the budget in proportion to its estimate, and its running files stop at the end of its part. Cost: the stopped work is lost. A stopped file is not kept (D17.3), so the rerun repeats it. Risk: the share comes from stored durations, and a single file's next run is over 2× its stored time in 6.7% of cases (Q2). In case A with a 311 s launcher, R1 stops a file that would finish. It does nothing inside one lane (case B).
- **R2, a per-file cap.** A file is stopped at k× its stored duration. Cost: as R1. Risk: k is host-bound. The launcher ran 311 s on the retry and more than 480 s in the comment's run, against 207 s stored (1.5× to over 2.3×). A file that is always slower than k× its stored time never completes, so its paths never pass.
- **R3, lanes at once.** The Vitest lane and the node:test lane run at the same time, each with its own width, under the one deadline. No file is stopped early. Cost: the peak number of test processes is the sum of the two widths (5 + 4 in cezar), which is the daemon's own peak. Risks: (a) tests of the two runners share the machine and outside resources at once. A project that works under the daemon already does this. (b) A node:test entry's `prepare` (D15) could rewrite files that a Vitest file reads while it runs. The daemon never runs `prepare` (D15.6), so this is new. Running every `prepare` before either lane starts removes it. (c) The two lanes slow each other under load. That is not measured: the probe files sleep, so they make no CPU load.
- **R4, one node:test pool.** The node:test entries share `tierSize` slots: when one entry's queue is empty, the next entry's files take the free slots. The peak stays `tierSize`, because each node:test file is its own process (`run.ts:85-100`). Risk: two entries with a different `node`, argv or `cwd` run at the same time. In the daemon they run in turn inside a tier.

**Interleaving** file by file across runners needs one queue across adapters. Vitest takes its whole list in one `runTestSpecifications` call, so this is a larger change. R3 and R4 give the same gain in both cases without it.

D18's order (the smaller estimate first) then matters only inside the node:test pool. The verdict does not change: any selected file that does not finish still makes it `incomplete` (D3.4). None of these rules can turn #196 into a pass while the launcher does not finish. They complete more paths, and they keep more files for the rerun (D17.3).

## Q2. An early outcome when the estimate is clearly over

**Today. read in source code:** the estimate line ends with the ways out and "The run starts anyway." (`src/cli/code-gate-text.ts:226-252`). The run then goes to the deadline. Each completed file is kept at its key (D17.3). Since 0.1.450 a serving daemon writes it (`keep.ts:207-213`, `keep-sent.ts`), so a rerun on the same bytes reads it. The #198 report ("327 ... were not kept: a daemon runs in this worktree") is from 0.1.447, before that change. No flag stops a run before it starts (`code-gate-args.ts`).

**How good the estimate is. verified by experiment** (read-only, `probes/gate-budget/estimate-error.mjs` over this repository's daemon history, 11,813 runs from 2026-10-08 to 2026-11-12, output `estimate-error.out.json`). "Stored" is the same file's duration in its previous run, which is what the store holds:

| Next run ÷ stored | p01 | p05 | p50 | p95 | p99 | over 2× | under 0.5× |
| --- | --- | --- | --- | --- | --- | --- | --- |
| one file (154,141) | 0.21 | 0.44 | 1.00 | 2.28 | 4.88 | 6.7% | 6.7% |
| one file stored ≥ 30 s (4,260) | 0.14 | 0.31 | 0.98 | 1.41 | 2.11 | 1.3% | 11.7% |
| a run of ≥ 20 files, summed (1,179) | 0.48 | 0.64 | 0.97 | 1.63 | 2.65 | 2.5% | 1.4% |

So an estimate summed over many files is good: a run that the estimate puts at 2× what is left fits in it in about 1.4% of cases (ratio under 0.5). One file's estimate is not: #196's launcher was one file. The #198 numbers agree (**inferred** from the issue): 336 files completed in about 440 s at width 5, 6.5 s each, against an estimated 7.2 s each. These are Vitest module durations on this host, under its load, for one repository.

**The options:**

- **E0, keep the run and name the command.** The early line and the final report (text and JSON) name one rerun: `squeal code --base <ref> --timeout <N>`, with N = the seconds before the first run + 2 × the estimate of the files still to run, rounded up to the minute (2× covers 97.5% of the runs above). The final report adds how many completed files were kept, so the rerun starts after them. It reverses nothing. Cost: the 600 s are still spent. They count for a local rerun and not for a CI route.
- **E1, stop before any run.** When the estimate is clearly over, exit 3 before the first file runs. Gain: up to the whole budget, in wall time and CPU. Cost: the run gives no function evidence. In #198 the run showed all 77 functions passing, because loader order runs their loaders first (D17.2). It keeps nothing for the rerun either. The functions need a new gap name, and that raises `QUALITY_POLICY_VERSION`. Not recommended.
- **E2, run the decisive files, then stop.** D17.2 already runs each changed path's loaders first, then "the files that load no changed path" (`order.ts:23-31`, `56-63`). These are files that config, setup or declared `inputs` selected. When the estimate of those remaining files is at least 2× what is left, with at least 20 known durations, the gate stops before them and reports. Gain: the function evidence of E0, in the time its loaders take. In #198 the 77 functions' loaders were the head of a 1,655-file run selected through the config. Cost: the kept progress for a local rerun is smaller by what those files would have done. Risk: a wrong stop in about 1.4% of cases (above), and the verdict is `incomplete` either way. It changes D17.1's "the run always starts" only in part, so the human decides.
- **E3, an opt-in flag** for E1 or E2. It adds a flag that a repository's instructions must name. cezar's pre-PR step names the exact command (#196, #198).

**Commands an outcome can name. read in source code and spec:** the rerun with `--timeout` (D3.4; kept files under D17.3, D11.7); `--parts <dir>` from `squeal ci record` (D13). Path arguments and `--group` narrow the selection. Both reports call them invalid for their repository, so the line names them last.

## Q3. Naming the file that holds the budget

**Today. read in source code:** between the pre-run print and the report the gate writes nothing. The node:test runner's note gives a count, not a name: "deadline of 431375 ms passed with 1 of 1 test files unfinished" (`run.ts:287-299`). The report lists each unfinished file with the same words, "did not finish in the 600 s budget" (`code-gate-text.ts:146-148`), whether it ran for 431 s or never started. In #198 that is 1,329 such lines.

**The signals exist. read in source code:**

- node:test: the worker loop starts each file's process (`run.ts:182-214`). No callback tells the caller, and node:test does not call `RunOptions.fileEnded`. Only Vitest does (`src/runners/vitest/adapter.ts:632`).
- Vitest: a worker sends `onQueued` when it starts to collect a file (`testRunner.onCollectStart`, Vitest 5.0.3 `dist/chunks/index.ggMXe2IF.js:151-154`; 4.1.10 `index.DXx9Dtk7.js:141-144`). That reaches reporters as `onTestModuleQueued` ("The file itself is not loaded yet", `plugin.d.BsjqSb4-.d.ts:2128-2130`). Squeal's reporter already counts it (`reporter.ts:117-119`, `263`). **Verified by experiment** (probe `hooks`, Vitest 5.0.3, one worker): it fires once per file, 0.01 to 0.03 s before `onTestModuleStart`, and not all at once at the start ("Live probes"). Vitest 4.1.10 was only read.

**Proposal (inferred):**

1. `RunOptions.fileStarted(testFile)`, from `onTestModuleQueued` in Vitest and from the process start in node:test. node:test also calls `fileEnded`.
2. A stderr line, when a running file passes 2× its stored duration (or 60 s with none), and then every 60 s while any file runs. It gives the elapsed time against the budget, each lane's files done of total, and the up to 3 longest-running files with seconds and stored seconds. Example: `squeal code: 240 s of 600: node:test 11 of 12 done; running packages/cezar/test/unit/test-env-launcher.test.ts for 229 s (stored 207 s); Vitest: 1232 waiting`. With `--json` it goes to stderr, as all output does (D14.4).
3. The report tells stopped files from files that never started: JSON `runs[].stopped: [{ path, seconds, storedSeconds }]`, and `notFinished` stays. Text: one line per stopped file, and one line for the count that did not start.

## Proposed rows (numbers for the coordinator)

1. **Name the running files (Q3).** `RunOptions.fileStarted` in `src/core/types/runner.ts`; node:test `run/run.ts` (start, `fileEnded`); Vitest `reporter.ts`/`adapter.ts`; gate `collect.ts`, `report.ts`, `types.ts`, `src/cli/code-gate-text.ts`. Tests: a sleeping node:test file and a sleeping Vitest file each named on stderr before the deadline, and `stopped` against not started in plain and `--json` output, with stdout still one object. No rule changes.
2. **Lanes at once and one node:test pool (Q1, R3 and R4).** It replaces D18.1's "one runner after another". Every `prepare` runs before the lanes start. Gate `collect.ts`, `plan.ts`, `steps.ts`; the node:test entry's run takes the free slots. Tests: the `starve` fixture of `probes/gate-budget/` (a 60 s node:test file, quick Vitest and quick node:test files of a second entry, a 25 s budget): the quick files complete, and the verdict stays `incomplete`. A `prepare` runs before any Vitest file. The keeper keeps both lanes' files. No state rule changes.
3. **The over-budget command (Q2, E0).** `estimateText` and the final report name the rerun command with N, and the count of kept files. JSON `budget.rerunSeconds`. Tests on `estimate.test.ts` and `code-gate-estimate.test.ts` cases.
4. **Stop before the files that load no changed path (Q2, E2), only if the human approves it.**

Rows 1 and 2 both edit `collect.ts`: run them one after the other.

## Open questions

1. For the human: E2 (stop before the files that load no changed path when the estimate is at least 2× over), E0 alone, or E3.
2. How much two lanes at once slow each other on a loaded host. The daemon's lanes already do this every day; the gate's cost was not measured.
3. Whether node:test entries with a different `node` or `cwd` can share one pool in every project. The daemon runs them in turn.
4. Whether `onTestModuleQueued` also fires per file start with more than one worker, and in Vitest 4.1.10. The probe used one worker on 5.0.3.

## Live probes

**Verified by experiment**, 2026-11-12 22:42Z to 22:44Z, Squeal 0.1.457 (released bundle), Vitest 5.0.3, Node 26.13.0. Each run under `env -i` with HOME and TMPDIR in `/tmp/gate-budget`, `nice 10` on 8 vCPUs, one-minute load 21.1 to 22.7 at start. The only file the runs wrote to their HOME was Vitest's `.local/share/vitest/.vitest-secret-token`. No process was left. Outputs in `probes/gate-budget/out/`.

The fixture (`fixture.mjs`) has #196's shape on a small scale: node:test entry `slow` (one file sleeps 60 s, three quick files, all load `src/a.mjs`), node:test entry `quick` (two files that load `src/c.mjs`), and eight Vitest files of 1 s that load `src/b.ts`. No durations are stored, so the estimate is unknown for both runners.

| Step | Edited | `--timeout` | Exit | Wall | Files completed | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| control | b, c | 25 s | 0 | 4.8 s | Vitest 8 of 8 in 2.6 s; node:test 2 of 2 in 0.2 s | pass |
| starve | a, b, c | 25 s | 3 | 25.9 s | node:test 3 of 6 (the `slow` entry's quick files); `quick` entry 0 of 2; Vitest 0 of 8 | incomplete |
| long | a, b, c | 180 s | 0 | 64.8 s | node:test 6 of 6 in 60.6 s; Vitest 8 of 8 in 2.6 s | pass |

What the runs show:

1. **Starvation is today's rule, not a host effect.** In `starve` the node:test run took 24.0 s of the 25 s, and the deadline stopped the 60 s file. The `quick` entry's two files and all eight Vitest files never started (Vitest `durationMs: null`). `control` shows that the same ten files need 2.8 s in all. So `b` and `c` are `incomplete` (`not-finished`) only because of the wait. Under R3 and R4 they would have completed in the first 3 s (**inferred** from `control`), and only `a` would stay `incomplete`. The verdict is `incomplete` under every rule.
2. **The runners run in turn.** In `long` the wall time is 64.8 s: node:test 60.6 s, then Vitest 2.6 s, plus about 1.6 s of setup. With lanes at once it would be about 62 s (**inferred**). The gain on a run that fits is small. The gain on a run that does not fit is every file of the later runners.
3. **Nothing names the file that holds the budget.** Between the pre-run lines (1.7 s) and the end (25.7 s) `starve` wrote nothing. The one runner line gives a count: `node-test run: deadline of 23862 ms passed with 1 of 4 test files unfinished`. Its "4" counts only the `slow` entry, so the two `quick` files that never started are not in it. In the JSON report the file that ran 24 s (`test/n1/slow.test.mjs`) and the two files that never started (`test/n2/c1.test.mjs`, `c2`) are in the same `notFinished` list.
4. **The start signal for Vitest exists.** In `hooks` (four files of 2 s, one worker) each file's `queued` and `start` came 0.01 to 0.03 s apart, at 0.16, 2.35, 4.49 and 6.66 s. Each came 0.10 to 0.15 s after the end of the file before it. A `fileStarted` callback from `onTestModuleQueued` names the file when it starts, not when the run starts.

## Sources

- Issues: https://github.com/hearsay-tools/squeal/issues/196 (body and the 0.1.447 comment), https://github.com/hearsay-tools/squeal/issues/198 (read with `gh issue view`, 2026-11-12).
- Spec 020 D3.2, D3.4, D14.4, D15, D17, D18 and `status.md`; spec 011 line 136 and spec 001 line 110 (lanes); `research/issue-196.md`, `research/issue-198.md`, `research/wide-import.md`.
- Squeal `52534310d`: `src/core/code/gate/{collect,plan,order,estimate,runner-order,steps,runners,keep,keep-sent}.ts`, `src/cli/code-gate-text.ts`, `src/cli/code-gate-args.ts`, `src/core/types/runner.ts`, `src/runners/node-test/run/run.ts`, `src/runners/node-test/adapter-project.ts`, `src/runners/vitest/{reporter,adapter,width}.ts`.
- Vitest 5.0.3 `node_modules/vitest/dist/chunks/index.ggMXe2IF.js`, `index.DpLw24bj.js` (`enqueued` 19996, `onQueued` 10677), `plugin.d.BsjqSb4-.d.ts`; Vitest 4.1.10 `~/projects/cezar/node_modules/vitest/dist/chunks/index.DXx9Dtk7.js`.
- Store history: `~/projects/squeal/.git/squeal/runs/*/report.json`, read only.
- Probes: `probes/gate-budget/` (README); live outputs `probes/gate-budget/out/` (`*.stdout` JSON reports, `*.stderr` with seconds, `*.load` load and exit, `queue.log`).
