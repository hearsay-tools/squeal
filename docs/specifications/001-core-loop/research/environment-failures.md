# Environment failures: told apart from test failures (row 001-348)

Researcher, 2026-10-14. Squeal at `a82fdb0c` (package 0.1.159), Vitest 5.0.3 (the version in `package-lock.json`), Node 24.21.0. Cezar read-only at `5dbb4b09`: `squeal.config.json`, its Vitest configs and test files. I ran no squeal or cezar command there and read no store. Probes: `probes/environment-failures/` (throwaway). Their output is in `output.txt`.

## Answers

| # | Question | Answer | Tag |
| --- | --- | --- | --- |
| 1 | What Squeal records today | An error in a file-level `beforeAll`: the file-level check `FAIL` and the file's tests `SKIP`. A load error (import, top-level throw, no test): the file-level check `FAIL`, plus `FAIL` for each test the key already holds. A `globalSetup` throw: the run crashes, and the files are `unknown` with nothing stored. A describe-level `beforeAll` error: **nothing**. The file-level check is `PASS` and the test is `SKIP` | verified by experiment |
| 2 | Which signals are reliable | None of them alone. Every signal has a real-bug false positive with the same shape. The re-run signal is blind in the cezar case: it runs seconds later, it never runs for slow files, and it never runs above 8 new failures | verified by experiment (shapes); read in spec (re-run); inferred (rates) |
| 3 | How other tools report it | Jest, pytest and Bazel each separate "the test failed" from "the test never ran because setup or build failed". None of them calls the second kind an environment failure. They all still report it as a failure (Jest "Test suite failed to run", pytest `ERROR` and exit 2, Bazel `FAILED_TO_BUILD` or `NO_STATUS`). Buildkite defines flakiness only under "the same code and environment" | read in source code / official docs |
| 4 | Options a to d | (b) and (d) hide a real failure whenever the classifier is wrong (fixture `l`). (a) leaves the noise. (c) keeps every failure counted and adds a way to clear it, which is 001-310's open half | inferred, from Q1 to Q3 |
| 5 | The cezar case | Measured statically: 74 of 75 browser files set up in a file-level `beforeAll` (71 open the browser, 60 read the server URL), so a down environment produces the Q1 shape in each one. Rates from the store: not determined, because reading it was out of bounds | read in source code (cezar files); lessons for 005-18 |

## Q1. What is stored today

The adapter collects `onTestCaseResult`, plus `onTestModuleEnd`'s `module.errors()`, plus `onTestRunEnd`'s unhandled errors (`src/runners/vitest/reporter.ts`). `buildReport` turns module errors into `fileErrors` (`src/runners/vitest/run.ts:136-200`). `recordsForFile` (`src/core/scheduler/records.ts:39-125`) stores each reported test as itself. It adds a file-level `fail` when the file has errors, and a `fail` for each check of the previous key that did not report. A run that crashed stores nothing, and the scheduler marks its files `unknown` (`tiers.ts:312-318`, `ledger.ts:339`). The run counts as crashed when there is an unattributed unhandled error, a module-runner load failure (`broken.ts`, defect 12) or a startup error. The store's outcomes are only `pass`, `fail` and `skip` (`src/core/types/check.ts:39`).

The fixture runs Squeal's own adapter (`createVitestAdapter`) and `recordsForFile` with the real `describeFailure`:

| Fixture file | Shape | Stored by Squeal |
| --- | --- | --- |
| `d-beforeall-fetch` | file `beforeAll` fetches a closed port | `<file>` FAIL "fetch failed", location none; 2 tests SKIP |
| `e-beforeall-provider` | file `beforeAll` throws cezar's provider message | `<file>` FAIL; 2 tests SKIP |
| `l-bug-in-beforeall` | **product bug**: the server under test reports the wrong port | identical to `d`: `<file>` FAIL "fetch failed", location none; test SKIP |
| `c-import`, `g-top-level-await`, `h-zero-tests` | load error, no test collected | `<file>` FAIL, plus the previous key's tests FAIL |
| `j-env-in-test` | environment fails inside a test | that test FAIL, `<file>` PASS |
| `i-bug-econnrefused` | **product bug** inside a test, "fetch failed" | that test FAIL, `<file>` PASS |
| `f-describe-beforeall` | `describe`-level `beforeAll` throws | **`<file>` PASS, inner test SKIP: the error is lost** |
| `gs/k-under-global-setup` | `globalSetup` throws | run `crashed`, file not completed, so `unknown` |

The skips come from Vitest. `runSuite` catches a `beforeAll` error, calls `failTask(suite.result, e)`, then `markTasksAsSkipped` (`vitest/dist/chunks/run.BTlFXlnv.js:4044-4051`, 5.0.3). The error sits on the module for a file-level hook and on the `TestSuite` for a describe-level one. The adapter reads only `module.errors()`, so the `describe` case is dropped (dump in `output.txt`: `suite "group" state=failed errors=[…ECONNREFUSED…]`). Vitest hands reporters `cause.code: "ECONNREFUSED"` and `code: "ERR_MODULE_NOT_FOUND"`. `toCheckError` keeps only name, message, stack, location and diff, and undici's stack is the bare `TypeError: fetch failed`. So the stored record of `d`, `g` and `l` cannot show that the cause was ECONNREFUSED. `failureCountText` words every file-level failure as a test file "that did not load" (`src/core/status/checks.ts:60`), which is wrong for a hook that threw.

## Q2. Signals and their false positives

| Signal | What it catches | What it misses | False positive |
| --- | --- | --- | --- |
| A. File-level error, no test ran | the cezar browser files (24 of 24 at revision 47 by the brief's count; 72 of 72 in 005-18) | environment failures inside tests: 005-18's 34 tests failing with `spawnSync pnpm ENOENT`, 001-310's four `/tmp/node_modules` tests, 001-170's load timeouts. Squeal's own documented environment episodes are mostly per-test | any import or syntax error, the most common file-level failure in editing sessions (001 lessons P1, R1; 003 lessons r11). This is the vision's "broken import that takes down forty tests" |
| A'. A with tests collected and all skipped (a hook threw) | `d`, `e`; excludes import, syntax and zero-test errors | as A, plus describe-level hooks (lost today) | `l`: a regression in the server the hook starts. In cezar the browser specs drive cezar's own built server (`packages/cezar/dist/**` is a declared input), so an agent change that stops it booting gives exactly "fetch failed" in every spec |
| B. Error text: ECONNREFUSED, ENOTFOUND, fetch failed, spawn ENOENT, "not installed" | `d`, `e`, `g`, `j`, 005-18's pnpm ENOENT | Custom messages. Today the code is also lost (Q1): Squeal stores "fetch failed" without its cause | `i` and `l`: a client dialling the wrong port. "fetch failed" also covers DNS, TLS, abort and undici's "bad port" (seen in the probe at port 1) |
| C. Same fingerprint across many files in one run | the 10 + 14 cezar files: `d` and `g` share "fetch failed" with location none, so their fingerprints are identical | a single file | a broken shared import or test helper: one "Cannot find module" across 40 files. A shared fixture server's bug |
| D. A same-key re-run clears it | transient causes: load, a port that frees up | everything the 001-171 re-run never sees: slow files are not re-run, tiers above 8 new failures are not re-run, and the re-run comes seconds later while the environment is still down (spec D6) | a flaky test with a race, which is a real defect. Squeal already records it as flaky, not as environment |

Rates (inferred): no data on this host separates the two classes beyond the two cezar runs. Inside cezar, A' is almost exactly "the browser suite". Of 744 non-browser test files, 9 have a file-level hook, and all 9 only stub `scrollIntoView` or set an env var. 16 have describe-level hooks. So A' looks precise in cezar only because of how cezar lays out its tests. Signal A' cannot tell `d` from `l`, and neither can any of the others short of a re-run after the environment changes.

## Q3. Other tools

- **Vitest 5.0.3** (source). The default reporter prints "Failed Suites N" (suites and modules with `result.errors`) apart from "Failed Tests N" (`index.DpLw24bj.js:16857-16869`). Unattributed errors go under "Unhandled Errors" with "This might cause false positive tests" (`:14130-14133`). A `globalSetup` throw is a "Startup Error". It has no environment category. `TestModule.errors()` is documented as "Errors that happened outside of the test run during collection, like syntax errors" (`plugin.d.BsjqSb4-.d.ts:208`). In practice it also holds file-level hook errors.
- **Jest v30.0.0** (source, `packages/jest-message-util/src/index.ts`). `formatExecError` titles "Test suite failed to run", with the comment "an error thrown outside of the test suite … none of the tests in the file are executed". It prints `Cause:` chains. `checkForCommonEnvironmentErrors` only adds a hint for a wrong `testEnvironment` (`document is not defined`, `.unref is not a function`), as text and never as a status.
- **pytest 8.3** (docs and 8.3.5 source). Outcomes `f - failed` and `E - error`. A fixture failure prints "ERROR at setup of test_error" and is counted as "1 error" apart from "1 failed". Collection errors raise `Interrupted("%d error%s during collection")`, exit code 2, before any test runs, unless `--continue-on-collection-errors`. An error is still non-green.
- **Bazel 7.4.0** (`build_event_stream.proto`). `TestStatus` is `NO_STATUS, PASSED, FLAKY, TIMEOUT, FAILED, INCOMPLETE, REMOTE_FAILURE, FAILED_TO_BUILD, TOOL_HALTED_BEFORE_TESTING`. `overall_status` is "accumulated over all runs, shards, and attempts". `--runs_per_test_detects_flakes`: "any shard in which at least one run/attempt passes and at least one run/attempt fails gets a FLAKY status." Statuses for "the test did not get to run" exist, but they are tied to the build and the infrastructure (remote execution), not to the test's own setup.
- **Buildkite Test Engine** (docs, `/docs/pipelines/reduce-flaky-tests`, fetched 2026-10-14). "Flaky tests produce inconsistent results when run against the same code and environment". It detects them from "historical test data" and quarantines them. It says nothing about infrastructure failures.

All of them leave the setup-or-environment judgement to a human. They give it a separate name (error, failed to run, failed to build) but still count it as a failure.

## Q4. Options

| | (a) unchanged FAIL | (b) `not run: environment`, outside Known failures | (c) FAIL, marked not trusted until a later re-run | (d) never current; re-run at next boundary |
| --- | --- | --- | --- | --- |
| Agent reads | "Known failures: 26 (2 tests, 24 test files that did not load)" | "Known failures: 2" and a separate line, e.g. "24 test files not run: environment (fetch failed ×10, …)" | "Known failures: 26", with the 24 grouped and labelled "setup failed, re-run pending" | 24 counted `unknown` in the header. "Known failures: 2" |
| D6 inheritance | held, then confirmed by one run per receiving worktree (001-170) | must not be stored under a key: defect 12 shows such a row is inherited as a hit. So it acts like D12's `unknown` and is not inherited | unchanged (held, then confirmed) | nothing stored, nothing inherited. A later pass from another worktree can be looked up (inferred) |
| 001-310 | needs the per-file force to clear after the environment is back | clears at a key change, `run --all` or `run --slow`, as `unknown` does today (`checkpoint-requests.ts:58`, `slow-tier.ts:557`) | is 001-310's "later second confirmation". The force stays the manual lever | not needed for these files |
| 001-171 | blind: runs at once, or not at all for slow files or above 8 | not a failure, so no re-run | must re-run later than 001-171 does, or it repeats the same blindness | not a failure |
| Hides a real failure | never | yes, whenever the classifier is wrong: `l`, a cezar server that no longer boots | never; still counted | yes: a hook bug never becomes a current FAIL. If A rather than A' decides it, a broken import does not either |
| Cost | noise: 24 of 26 | a classifier, a new state in the versioned status and delivery payloads, and the Stop policy | one later re-run per marked file. Cezar's `globalSetup` runs `test-env-up.sh`, which in 005-18 rewrote ~120 `dist` files and re-keyed every slow file | a re-run at every boundary while the environment stays down. A real hook failure loops |

Precedent: D5 and D12 already turn a failure of the runner's own environment into `unknown` that is not stored and is retried at the next revision or `run --all` (`failures.ts:27-54`). This covers a broken config, a `globalSetup` throw and a module-runner load failure. (b) and (d) move that line from the project down to one file's hooks, where Squeal can no longer tell setup from product.

## Q5. The cezar case

Read-only, at `5dbb4b09`. `packages/web/e2e/` holds 75 `*.e2e.ts` files, and 74 have a file-level `beforeAll`. 71 call `AgentBrowser.open`, which throws "the agent-browser provider is not installed" (`agent-browser.ts:410`). 60 read `baseUrl` from the shared test environment and fetch it. The project's `globalSetup` (`environment.ts`) throws on a missing browser and would crash the whole run instead. So in the revision-47 run the descriptor must have said "installed" at setup time, or setup passed and the provider went missing later. Not determined, because that needs the run log in the store. The project is in `slow.include`, so 001-171 never re-ran these files. cezar's `npm test` does not run this project. Row 001-349 (follow the projects the test script runs) would remove all 24 from the case without any classifier.

## Recommendation for Squeal

Do not exclude any failure from "Known failures" on a signal Squeal can see: fixture `l` shows that a server the agent broke and a server nobody started leave the same record. Take (c): keep it a counted FAIL, word and group a hook failure as "setup failed" (signal A' with C), and give it a later re-run that clears it. That later re-run is 001-310's second confirmation. Take 001-349 first, because it removes the measured case at its source. Before any of these, two adapter gaps found here need rows: the lost describe-level hook error, a real failure stored as PASS today, and the error `cause` and `code`, which Squeal drops. The human decides between (b) and (c), since it is a trade of noise against hidden failures.

## Open questions

1. How often A' fires on real regressions in agent sessions. This needs store data from dogfood runs (`squeal why` or the run logs). Not determined here, because no store was read.
2. Whether Vitest runs `globalSetup` once per instance or once per run under `standalone()` plus `runTestSpecifications`. This decides the cost of (c) for cezar. Not probed.
3. What "a later boundary" for (c) is: the next session start, the next revision, or a time. It is a spec decision.

## Sources

- Squeal source: `src/runners/vitest/{reporter,run,results,broken}.ts`, `src/core/scheduler/{records,tiers,ledger,failures,checkpoint-requests,slow-tier}.ts`, `src/core/status/checks.ts`, `src/core/types/check.ts`. Spec 001 D4, D5, D6, D12. Board rows 001-170, 001-171, 001-310, 001-348, 001-349. `001-core-loop/lessons.md` defect 12. `005-agent-adoption/lessons.md` (the 005-18 cezar run).
- Vitest 5.0.3: `node_modules/vitest/dist/chunks/run.BTlFXlnv.js:3991-4090`, `index.DpLw24bj.js:14130-14133, 16857-16869`, `plugin.d.BsjqSb4-.d.ts:208`.
- Jest v30.0.0: https://raw.githubusercontent.com/jestjs/jest/v30.0.0/packages/jest-message-util/src/index.ts
- pytest: https://docs.pytest.org/en/8.3.x/how-to/output.html, https://docs.pytest.org/en/8.3.x/reference/exit-codes.html, https://raw.githubusercontent.com/pytest-dev/pytest/8.3.5/src/_pytest/main.py
- Bazel 7.4.0: https://raw.githubusercontent.com/bazelbuild/bazel/7.4.0/src/main/java/com/google/devtools/build/lib/buildeventstream/proto/build_event_stream.proto, `…/analysis/test/TestConfiguration.java`
- Buildkite: https://buildkite.com/docs/pipelines/reduce-flaky-tests
- Cezar (read-only, `5dbb4b09`): `squeal.config.json`, `vitest.config.ts`, `packages/web/e2e/{vitest.config.ts,environment.ts,agent-browser.ts,*.e2e.ts}`.
- Probes: `probes/environment-failures/{README.md,run.ts,fixture/,output.txt}`.
