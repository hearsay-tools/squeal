# Issue 144: callback coverage stops at the test process

Keep the child-coverage boundary explicit in path-specific code reports.

Researcher, 2026-11-03. Documentation-only triage of [#144](https://github.com/hearsay-tools/squeal/issues/144), bounded to 20 minutes. **Synthetic symptom reproduced; original incident not replayed.** Examined commit `8ce4f23fc18c67cb1259b894fed74f395c0c02b5`, committed CLI **0.1.393**, Node **24.22.1**, Linux, 24 CPUs. The issue reports **0.1.390**, revision 7, in hearsay-tools/cezarion. Probe fixtures started at one-minute loads **4.40, 4.61, 4.61**; the initial host check was **5.68**. All were below 24. Every live launch also passed the script's load gate. No build or repository suite ran.

## Questions answered

| # | Question | Answer and evidence tag |
|---|---|---|
| 1 | Does child-only callback execution produce `untested`? | Yes in the synthetic 0.1.393 fixture, even while its test passes and proves the callback wrote its marker. **verified by experiment**, 0.1.393 / Node 24.22.1. |
| 2 | Does an in-process control differ? | The identical callback has 100% coverage, CRAP 1 and `uncovered: pass`; child-only has CRAP 2 and `uncovered: fail`. **verified by experiment**, same versions. |
| 3 | Does independent child coverage prove execution? | A separate raw V8 run of the same child test records `onHelpWritten` with count 1. **verified by experiment**, Node 24.22.1. |
| 4 | Does the current report state its scope? | Unscoped `code` explicitly excludes children; `code scripts/help.mjs` only says “in the test's own thread” and omits the explicit exclusion sentence. **verified by experiment**, 0.1.393. |
| 5 | Is exclusion deliberate, and is this the original incident? | Spec 015 explicitly excludes children; its recorder removes its coverage variable before test code spawns them. **read in official docs / read in source code**, commit above. Exact incident replay is **not determined**, because its source commit, full output and bundled coverage artifact were not supplied or fetched. |

## Findings

**Q1–Q3: process boundary, not a callback that never runs** (**verified by experiment**, Squeal 0.1.393, Node 24.22.1). Three isolated git repositories contain byte-identical `scripts/help.mjs`. `showHelp` writes help and resolves a promise from the `onHelpWritten` stdout callback. The callback emits `callback-ran` to stderr. Both child tests assert the exit, help text and marker. The control awaits that same promise in the test process.

| Fixture | Named test verdict | Callback CC / CRAP | Squeal callback evidence |
|---|---|---|---|
| Child only | Current, no failures, exit 0 | 1 / 2 | `uncovered: fail`, `lines: 0`, `covered: 0`, `testFiles: 0` |
| Import in parent; call only in child | Current, no failures, exit 0 | 1 / 2 | `uncovered: fail`, `lines: 3`, `covered: 0`, `testFiles: 0` |
| Call in test process | Current, no failures, exit 0 | 1 / 1 | `uncovered: pass`, `lines: 3`, `covered: 3`, `testFiles: 1` |

Here `testFiles` counts tests that ran the function, not every test that loaded its source. Importing the module does not run the callback. All three functions in the module show the same child/control split. After the child-only daemon stopped, an independent `NODE_V8_COVERAGE` run passed its one test and recorded `showHelp`, `helpPromise` and `onHelpWritten` each with count 1. This proves execution without assuming that a passing subprocess test covered the callback.

**Q4: exact current wording** (**verified by experiment**, 0.1.393). Path-specific output in both child cases:

```text
scripts/help.mjs:3  showHelp.helpPromise.onHelpWritten  CC 1, at or under; CRAP 2; untested: no test runs it in the test's own thread
```

Unscoped `squeal code` prints:

```text
CRAP: 0 functions over 30; 3 functions untested; squeal code <path> shows them by file
  Coverage counts what ran in the test's own thread. Squeal does not measure worker threads or child processes.
```

The path report lacks that second sentence. The control's path report says `CRAP 1; 100% of its lines ran in 1 test file`. JSON exposes `uncovered` and numeric evidence but no child-process exclusion explanation. This probe did not register a harness consumer or test push-delivery wording.

**Q5: the implemented boundary matches policy** (**read in official docs / read in source code**, commit `8ce4f23fc`). Spec 015 Non-goals excludes “Coverage of code that tests reach only through a child process.” D8 limits node:test records to the test process's main thread; the recorder removes Squeal's `NODE_V8_COVERAGE` before user test code runs. D9 treats a function only a child runs as `fail`, and D6/D9 delivery examples explicitly say that Squeal does not measure children. `src/cli/code-coverage.ts` implements the observed split: `coverageWords` returns the path-specific suffix, while `coverageLines` appends `MEASURED` to a failing aggregate report. The recorder is `src/runners/node-test/runtime/recorder.cjs:32–64`. These two files and `src/core/delivery/code-coverage.ts` have no diff from tag `squeal--v0.1.390` (`ee3531548ed52c4ba692b48b0ae430d9c4965e48`) to the examined commit. That is source evidence, not a runtime replay of 0.1.390.

The earlier [child-process research](child-processes.md), examined at repository `2e36f1ed2`, Node 24.21.0 and Vitest 5.0.3, reported 50 child-only functions among 7,582, +13% to +16% CPU for child-heavy files, a changed-environment test failure, and losses on signal termination. Those measurements were **read in official docs**, not repeated here. They explain the standing fidelity/cost tradeoff. This probe supplies no new cost estimate or case for reversing that policy. Related #106 concerned kept states and node:test coverage support, not proof that child coverage must be collected; its research and subsequent status amendments distinguish that earlier case.

## Recommendation and limits

**Inferred from the experiments and policy, 0.1.393:** treat this as a known measurement boundary with a concrete wording gap for the coordinator to consider. Keep the explicit child-process exclusion visible when a user follows `code <path>`. Do not infer “no test exists” or silently change `fail` to `unknown` from child-process reach. Collecting children would reverse an explicit non-goal and needs its own human decision.

The original cezarion 0.1.390 revision-7 output, config, function bytes and bundled `check-code-quality` result remain unverified. The issue says that bundled run covered three changed functions; this probe instead has a raw Node/V8 child count and Squeal's in-process CRAP control. It does not validate that bundled tool's CRAP calculation. No daemon restart, workers, Vitest variant, performance comparison or original repository run was attempted. The next incident-specific evidence is the complete path/unscoped output plus the source commit and coverage artifact. The policy question is whether the current label plus explicit boundary is sufficient, or child collection warrants reconsideration.

## Commands and sources

Run from the examined worktree; full command arrays, output, exit codes and daemon logs are retained in [results.json](probes/issue-144/results.json). [run.mjs](probes/issue-144/run.mjs) defines all fixture files and isolated environments; [README](probes/issue-144/README.md) explains reproduction.

```sh
gh issue view 144 --repo hearsay-tools/squeal --json title,body,url,comments,createdAt
node -e 'console.log(JSON.stringify({utc:new Date().toISOString(),node:process.version,load:require("os").loadavg(),cpus:require("os").cpus().length,available:require("os").availableParallelism()}))'
node plugins/claude-code/dist/cli/squeal.mjs --version
node docs/specifications/015-coverage-complexity/research/probes/issue-144/run.mjs plugins/claude-code/dist/cli/squeal.mjs docs/specifications/015-coverage-complexity/research/probes/issue-144/results.json
git diff squeal--v0.1.390 HEAD -- src/cli/code-coverage.ts src/core/delivery/code-coverage.ts src/runners/node-test/runtime/recorder.cjs
```

Per fixture, the probe starts `node <absolute-cli> daemon <fixture>`, then reads `status --wait 30000 test/help.test.mjs`, `code scripts/help.mjs`, `code scripts/help.mjs --json`, and `code`. All recorded reads exit 0. After stopping the child-only daemon it runs `NODE_V8_COVERAGE=<private-dir> node --test test/help.test.mjs` (1 passed, 0 failed). Every fixture daemon was stopped. No full-suite checkpoint was requested.

Other sources: [spec.md](../spec.md) Non-goals, D6, D8, D9; [status.md](../status.md) 015-58/64/65, 015-75/86/95 and 015-103; [issue-106.md](issue-106.md). Source links: [CLI coverage](https://github.com/hearsay-tools/squeal/blob/8ce4f23fc18c67cb1259b894fed74f395c0c02b5/src/cli/code-coverage.ts), [recorder](https://github.com/hearsay-tools/squeal/blob/8ce4f23fc18c67cb1259b894fed74f395c0c02b5/src/runners/node-test/runtime/recorder.cjs), [delivery words](https://github.com/hearsay-tools/squeal/blob/8ce4f23fc18c67cb1259b894fed74f395c0c02b5/src/core/delivery/code-coverage.ts). No open-web search was used.

Research-file verification: `node --check research/probes/issue-144/run.mjs` and `git diff --check` passed. Assertions over `results.json` confirmed all command exits, the three expected coverage outcomes and callback count 1. The session launcher `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 research/probes/issue-144/run.mjs docs/specifications/015-coverage-complexity/research/issue-144.md` reported no selected test closure, known failures 0 and 1,385 current files; those are background/inherited results, not a suite run by this task. That launcher stays pinned to 0.1.390, separate from the explicitly selected 0.1.393 experiment bundle. Squeal also reports the throwaway probe's own untested functions; no product code was changed.

Coordinator integration: moved the probe evidence into this spec’s `research/probes/issue-144/` directory. Saved results retain the original command paths as historical evidence.
