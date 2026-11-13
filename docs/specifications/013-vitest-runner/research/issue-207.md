# Explain the pool warning from the final run evidence

Recommendation: explain the teardown warning against the final file and run
evidence, while preserving failed and unfinished results. This is a reporting
gap, reproduced with a forced short teardown threshold. It is not evidence
that every teardown warning is harmless. No product change is proposed here.

Examined 2026-11-13: Squeal **0.1.463**, installed Codex runtime, source checkout
`1eeeb9186a0dc2cfed419aaa516af0b3af2ccd36`; Vitest **5.0.3**, Vite **8.3.2**,
Node **26.13.0**, Linux, **24 CPUs**. The issue reports Squeal 0.1.460; that
version and the original Squawk test were not run. Initial measured load was
10.33. Every live probe checked one-minute load again and ran below 24.

## Questions answered

| Question | Answer and tag | Version |
| --- | --- | --- |
| Q1. Can the warning name a file that still counts as completed? | Yes. The passing-file probe printed the exact warning and reported that file completed, measured coverage, no failed tests, verdict `pass`, exit 0. **verified by experiment** | Squeal 0.1.463 / Vitest 5.0.3 |
| Q2. Does output explain whether the warning changes the result? | No. Stderr contained the pool warning without a completion explanation. JSON contained completion and verdict separately. **verified by experiment** | Same |
| Q3. Does a separate real failure survive? | Yes. Both files completed; only the assertion failure appeared in `failed`; verdict `incomplete`, exit 3. **verified by experiment** | Same |
| Q4. Can the same warning coexist with an untrusted run? | Yes. A worker killed itself with SIGKILL. The passing file still got the warning, but neither file counted as completed. Both were `notFinished`, verdict `incomplete`, exit 3. **verified by experiment** | Same |
| Q5. Where does the distinction come from? | Vitest logs the timeout directly. Squeal reads reporter completion and error events; an unattributed error makes the run crashed and empties completion. **read in source code** | Vitest 5.0.3 / Squeal source at the commit above |
| Q6. Was the original high-load cause reproduced? | Not determined, because the original fixture and its configuration were not supplied, and deliberate host load was outside this brief. The output symptom was reproduced with `teardownTimeout: 1`. | Same |

## Experiment

The throwaway [probe](probes/issue-207/probe.py) creates a separate temporary
Git repository, links the already installed dependencies, commits a baseline,
and edits one covered function from `return 1` to `return 1 + 0`. It uses one
fork worker. It does not install dependencies or start a daemon. The fixtures
are outside this worktree, so these explicit research runs are not covered by
the worktree's Squeal daemon.

Exact commands, from the Squeal checkout root:

```sh
python3 docs/specifications/013-vitest-runner/research/probes/issue-207/probe.py warning
python3 docs/specifications/013-vitest-runner/research/probes/issue-207/probe.py control
python3 docs/specifications/013-vitest-runner/research/probes/issue-207/probe.py failure
python3 docs/specifications/013-vitest-runner/research/probes/issue-207/probe.py exit
python3 docs/specifications/013-vitest-runner/research/probes/issue-207/probe.py crash
```

Each invocation runs this command in its temporary repository, with a 25 s
outer subprocess bound:

```sh
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal code --base HEAD --json --timeout 15
```

The `exit` case was first run under the name `crash`, before distinguishing
Vitest's intercepted `process.exit(7)` from a real SIGKILL. Its saved metadata
now uses `exit`; its original fixture path remains `crash.test.ts`.

All rows below are **verified by experiment**, Squeal 0.1.463 / Vitest 5.0.3.
Durations include the CLI/version measurement. Each case ran once.

| Case | Load / 24 CPUs | Time | Warning names | Completed / selected | Failed / not finished | Verdict; exit |
| --- | --- | --- | --- | --- | --- | --- |
| Control, 10,000 ms teardown threshold | 11.24 | 1.60 s | None | 1 / 1 | None / none | pass; 0 |
| Warning, 1 ms threshold | 9.47 | 1.46 s | Passing file | 1 / 1 | None / none | pass; 0 |
| Assertion failure, 1 ms threshold | 11.24 | 1.72 s | Both files | 2 / 2 | Assertion in `failure.test.ts` / none | incomplete; 3 |
| Intercepted exit, 1 ms threshold | 10.98 | 1.83 s | Both files | 2 / 2 | Test in `crash.test.ts` / none | incomplete; 3 |
| SIGKILL, 1 ms threshold | 10.05 | 1.83 s | Passing file | 0 / 2 | None / both files | incomplete; 3 |

The passing warning case printed:

```text
[vitest-pool]: Timeout terminating forks worker for test files <fixture>/pass.test.ts.
```

Its report has `completed: ["pass.test.ts"]`, `notFinished: []`, `failed: []`
and `verdict: "pass"`. No stderr line explains the relationship. In the SIGKILL
case, stderr also reports `unhandled error outside any test file` and the cause
`Worker exited unexpectedly with signal SIGKILL`. Thus the warning text alone
cannot justify saying results were kept.

Full stdout, stderr, exact arguments, versions and load readings are saved in
[the probe folder](probes/issue-207/). `<fixture>` replaces only the deleted
temporary root. The reports' kept-log paths are historical, not live links.

## Source seams and contract

Each finding here is **read in source code**, at the versions named above.

- Vitest's installed `node_modules/vitest/dist/chunks/index.DpLw24bj.js`,
  lines 11519–11557: `testfileFinished` resolves the task. Termination then
  starts with a timer calling `this.logger.error(...)`. The comment says
  “Runner terminations are started but not awaited until the end of full run.”
  This timeout callback does not call `state.catchError` or reject the task.
- The same file, lines 10919–10979, separately sends a stop request. An error
  in a `stopped` response calls `state.catchError(response.error, "Teardown Error")`.
  That real error path must not be confused with the timer's logger line.
- `src/runners/vitest/adapter.ts:233` installs Squeal's reporter through
  `createVitest`. `reporter.ts:121` records module completion;
  `reporter.ts:166` records unhandled errors at run end.
- `src/runners/vitest/run.ts:202` builds the result from those events. An
  unattributed error changes the end to `crashed`; “Nothing in a crashed run
  is trusted, so no file counts as completed.”
- `src/core/code/gate/evidence.ts:44` reads `completedFiles`;
  `gate/runs.ts:15` renders completed, not finished and failed files separately.
  `gate/collect.ts:214` prints a report's run failure. The timeout logger
  message supplies no such failure in the passing probe.

Spec 013 V4 makes reporter events the authority. V8 preserves runner failure
as a state. Spec 020 D7 reports completion separately from failed tests; D11.2
keeps failed tests as a gate input. D17 says unfinished loaders prevent a pass.
D17.3 also makes persistence depend on coverage and input validity, beyond mere
completion. **inferred**, Squeal 0.1.463: any explanation must distinguish
“counted in this report” from “saved for later reuse.” Persistence was not
tested here. Blanket suppression or a blanket “results kept” claim would lose
the distinction proved by the SIGKILL control.

## Limits and sources

Open: frequency under the original load and default timeout; other Vitest
versions; multi-project attribution; teardown errors returned through `stopped`;
and actual store reuse after the warning. No full suite, daemon-state probe,
host-load stress, product edit or hold change was made.

Verification: Python syntax parsing, JSON/report parsing and
`git diff --cached --check` passed. The required
`squeal status --wait 60000` on this findings file and `probes/issue-207/probe.py`
returned exit 3: no test file's closure holds either path. It reported zero
known failures and 1,030 unknown of 1,751 worktree test files. These research
probes are the validation evidence; no worktree-suite pass is claimed.

- [Issue #207](https://github.com/hearsay-tools/squeal/issues/207), fetched with
  `gh issue view 207 --repo hearsay-tools/squeal --json title,body,comments,url`.
- [Squeal source revision](https://github.com/hearsay-tools/squeal/tree/1eeeb9186a0dc2cfed419aaa516af0b3af2ccd36),
  local paths and lines above; [spec 013](../spec.md) V4/V8 and
  [spec 020](../../020-quality-gate/spec.md) D7/D11/D17.
- [Vitest 5.0.3 package](https://www.npmjs.com/package/vitest/v/5.0.3): installed
  source path above, read directly with `rg` and `sed`; package version read
  from `node_modules/vitest/package.json`. No claim relies on recalled APIs.
