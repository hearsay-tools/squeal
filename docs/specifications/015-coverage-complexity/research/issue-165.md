# Issue 165: 0%-coverage CRAP for Python files that no Squeal runner runs

## Verdict

**Reproduced.** In a project with only node:test configured, Squeal 0.1.414 gives branched Python functions a numeric CRAP of CC² + CC and an `untested` fail. Text and JSON both read as measured zero coverage. Neither says that no configured runner can measure Python. The cause is D9's zero-loader rule: a source that no test file loads is judged at 0% coverage, whatever its language. The existing `coverage.exclude` switch removes the false result for a named directory.

Researcher, 2026-11-07. Documentation-only. Squeal commit `6922ff21415850088e3efe558c66b58bf341a5a1`, committed CLI `plugins/claude-code/dist/cli/squeal.mjs` **0.1.414**, Node **v24.22.1**, Linux, 24 CPUs. One-minute load **16.42** at the first check and **16.39–16.42** at each fixture and daemon launch, all below 24. No build, install or full suite ran. The original cezarion incident (cezarion issue 2829) was not replayed; its exact output was not recorded in the issue.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does a Python function with branches get a numeric CRAP when no Python runner is configured? | Yes. `classify` CC 3 → CRAP 12; `summarize` CC 7 → CRAP 56, over 30. Both equal CC² + CC. | verified by experiment, 0.1.414 |
| 2 | Does text or JSON say coverage was not measured? | No. Text: `CRAP 56, over; untested: no test runs it in the test's own thread`. JSON: `crap: { outcome: "fail", value: 56 }`, `uncovered: "fail"`, `lines: 0, covered: 0, testFiles: 0`, no reason field. | verified by experiment, 0.1.414 |
| 3 | Does the worktree summary count them? | Yes. `squeal code`: `CRAP: 1 function over 30; 4 functions untested`; `squeal status`: `Coverage: 1 function over CRAP 30, 4 untested`. The 4 include the two pytest-style test functions in `bench/test_stats.py`. | verified by experiment, 0.1.414 |
| 4 | Why does the code judge it this way? | `fileCondition` returns `ready` with no loaders for a source no test file loads (`src/core/code/crap/file.ts`, comment: "A source no test file loads is ready with no loader"). No language or runner check precedes it. `RECORDING_RUNNERS` and `notMeasuredNames` only act on configured runners' loaders. | read in source code, `6922ff214` |
| 5 | Does the spec allow this? | Yes, as written. D9 makes a source `unknown` when a configured non-recording runner (pytest) loads it. A source no configured runner loads has no loader, so no `unknown` cause applies. D9's no-loader wording (`no test Squeal runs loads this file`) is defined for delivery lines; the CLI line uses the generic `untested` text. | read in spec 015 D1/D9 at `6922ff214`; inferred for the gap |
| 6 | Is there a workaround today? | Yes. `coverage.exclude: ["bench/**"]` keeps CC and prints `coverage not checked (coverage.exclude)`, JSON `coverage: { excluded: true }`; summary drops to 0 over and 0 untested. | verified by experiment, 0.1.414 |

## Findings

**Experiment** (verified by experiment). Two scratch git repositories, each with `nodeTest: [{ name: "probe", include: ["test/*.test.mjs"] }]`, `complexity.enabled`, `coverage.enabled`, `crap.enabled`, no `pytest` key, `baseline.onStart: lookup-then-run-missing`, an isolated HOME. Files: `src/sign.mjs` with one node:test test; `bench/stats.py` with `classify` (2 `if`) and `summarize` (loop, 3 `if`, 2 logical); `bench/test_stats.py` that would test both under pytest. The second repository adds `coverage.exclude: ["bench/**"]`.

| Function | Case | Text from `squeal code bench/stats.py` |
|---|---|---|
| `classify` | no Python runner | `CC 3 (if 2), at or under; CRAP 12; untested: no test runs it in the test's own thread` |
| `summarize` | no Python runner | `CC 7 (if 3, logical 2, loop 1), at or under; CRAP 56, over; untested: no test runs it in the test's own thread` |
| both | `coverage.exclude` | `coverage not checked (coverage.exclude)` |
| `sign` (JS control) | both | `CRAP 3; 100% of its lines ran in 1 test file` |

The worktree view in the first case adds `bench/stats.py  summarize  CRAP 56, fail, since revision 0` and the sentence `Coverage counts what ran in the test's own thread. Squeal does not measure worker threads or child processes.` That sentence names threads and processes, not languages. An agent reading it has no signal that the Python functions are unmeasured. This matches the issue's report: CRAP read as a finding.

**Wording sources** (read in source code). `src/cli/code-coverage.ts` uses one fixed `UNTESTED = "untested: no test runs it in the test's own thread"`. `src/core/delivery/code-coverage.ts` has `NOT_LOADED = "no test Squeal runs loads this file"` for `file.count === 0`; that wording is on the hook delivery path, not checked here live. Neither names the language or the missing runner.

**Comparison with adjacent issues.**

- **#149** (`issue-149.md`, 0.1.402): a TypeScript source run only by a separately configured Vitest child reads `untested`, CRAP 2. Same mechanism (zero in-process loaders → measured 0%), same workaround (`coverage.exclude`). The difference: in #149 a recording runner exists for the language but does not see the run; in #165 no configured runner exists for the language at all, so Squeal can tell statically that it cannot measure.
- **#135** (`issue-135.md`, 0.1.390, not reproduced because of load): the opposite symptom, a missing `crap` field with no reason while coverage waits. Together they show two gaps in D6's reason vocabulary: no reason for "absent while pending" (#135) and no reason for "cannot be measured" (#165). The missing-state explanation shipped in 0.1.408 (015-104); #135 now retains only the focused-wait decision. Not expanded here.

## Recommendation for Squeal

Treat a counted source whose language no configured runner can record (today: `.py` without a coverage-recording Python runner) as not measured: keep complexity, omit the CRAP value and `untested` state, and say why in text and JSON, as `coverage.exclude` already does (for example a reason `no-runner` beside `excluded`). This is the issue's suggested fix and reuses an existing output shape. It is a product decision for spec 015 D9 and needs the coordinator and the human; no implementation is authorized. The tradeoff: a Python file truly loaded by nothing would lose its `untested` flag, but Squeal cannot tell that apart from "tested by an unconfigured runner", so the flag is not evidence either way. Accepting coverage.py or LCOV reports is a separate, larger option.

## Open questions

- Does a configured `pytest` project change the result? D9 says its loaded sources go `unknown`, named by runner. Not run here: `pytest` is not installed for `/usr/bin/python3` on this host, and the time box was 20 minutes.
- Should the same rule cover a JS/TS file that no configured runner's include pattern can reach? Not examined.
- Should Python test files (`test_*.py`) count toward `untested` at all? They did here (2 of 4). `coverage.exclude` already covers them per project.
- The live hook delivery line for this case was not captured.

## Limitations

Synthetic fixture, not the cezarion repository. One run per case, no daemon restart tried. Hook delivery not exercised. Load was about two thirds of the CPU count, from other coordinators' work.

## Commands

```sh
gh issue view 165 -R hearsay-tools/squeal --json title,body,comments,state
cat /proc/loadavg; nproc        # 16.42 14.37 10.71; 24
node plugins/claude-code/dist/cli/squeal.mjs --version   # 0.1.414
node docs/specifications/015-coverage-complexity/research/probes/issue-165/run.mjs
```

Per case, the probe runs, with the committed CLI and an isolated HOME: `daemon <root>`, `status --wait 30000 test/sign.test.mjs`, `code bench/stats.py`, `code bench/stats.py --json`, `code src/sign.mjs`, `code`, `status`. All exited 0; both daemons exited 0 on SIGTERM.

## Sources

- Issue: https://github.com/hearsay-tools/squeal/issues/165 (open, read 2026-11-07)
- Probe: [`probes/issue-165/run.mjs`](probes/issue-165/run.mjs), [`results.json`](probes/issue-165/results.json) (fixture bytes, exact commands, outputs, load gates, daemon logs), [`run-output.txt`](probes/issue-165/run-output.txt)
- Spec 015 D1, D6, D8, D9: `docs/specifications/015-coverage-complexity/spec.md` at `6922ff214`
- Code: `src/core/code/crap/file.ts` (`fileCondition`), `src/core/code/coverage/runtime.ts` (`RECORDING_RUNNERS`), `src/core/delivery/code-runners.ts` (`notMeasuredNames`), `src/cli/code-coverage.ts` (`UNTESTED`), `src/core/delivery/code-coverage.ts` (`NOT_LOADED`)
- Adjacent research: `issue-149.md`, `issue-135.md`
