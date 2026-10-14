# 001-360: a describe-level hook error fails its file

Worker notes, 2026-10-14. Research `environment-failures.md` Q1: a `beforeAll` that throws inside a `describe` was stored as `<file>` PASS with the suite's tests SKIP.

## What Vitest 5.0.3 does (read in source code, verified by experiment)

- `runSuite` (`vitest/dist/chunks/run.BTlFXlnv.js:4015-4090`) catches a `beforeAll` error, calls `failTask(suite.result, e)` and `markTasksAsSkipped(suite)`. An `afterAll` error is caught in the `finally` and also lands on `suite.result`. The suite is the module for a file-level hook and the `describe`'s suite otherwise.
- The error stays on the suite whose hook threw: a parent suite's state becomes `fail` through `hasFailed`, but its `errors` are not copied. So reading each suite's own `TestSuite.errors()` gives the innermost failing suite's error once, never a duplicate up the chain.
- The same block also fails a `describe` that holds no test ("No test found in suite <name>") unless `passWithNoTests` is set. Vitest's own run fails such a file ("Failed Suites 1").

## What the code does

- `src/runners/vitest/reporter.ts` `RunCollector.moduleEnd`: `ModuleEnd.errors` is now `module.errors()` followed by every suite's own `errors()`, in declaration order (`module.children.allSuites()`, depth-first). `buildReport` (`run.ts`) turns them into the file's `fileErrors` as before, so `recordsForFile` stores the file-level check FAIL with that error, exactly as for a file-level hook.
- The run log names the suite: `suite-level error (<suite fullName>): <error>`, beside the existing `file-level error:` lines.
- `broken.ts` `runnerFailure` reads `ModuleEnd.errors` too, so a runner module-loading failure inside a describe-level hook now counts as a runner failure, like the same failure in a file-level hook (D5, defect 12).
- The stored `CheckError` is unchanged (row 001-361 owns its shape): it does not name the suite. Its location points at the hook's line in the test file, which is enough to find it. If the suite name is wanted in the stored message or the delivery, that is 001-361's call.

## Decisions

- **The tests under the failing suite stay SKIP.** Vitest reports them `skipped`, and a file-level hook today stores the same: `<file>` FAIL, its tests SKIP (research Q1, fixture `d`). D4's expansion ("a `fail` for every check previously known in that file") applies, via `recordsForFile`, only to checks that did not report in the run; the skipped tests did report. So describe-level and file-level hook failures are stored alike, and the failure is counted once, on the file-level check, not once per test.
- **An empty `describe` now stores FAIL.** It follows from reading suite errors, and it agrees with Vitest's own verdict and with `npx vitest run`, which Squeal's results are checked against. Pinned by a test. A project that wants it to pass sets `passWithNoTests`, which the suite check honours.
- **Nested describes:** each suite's own error counts once; the innermost failing suite is the one that carries it.
- **An `afterAll` error inside a describe** fails the file the same way; the suite's tests keep their own results (they ran).

## Spec sentence drafts

D4, after "File-level errors (import or syntax failures) become a `fail` …":

> A hook error inside a `describe` lands on that suite, not the module; the adapter reads every suite's own errors after the module's, so it fails the file-level check as a file-level hook does, and the suite's tests keep the `skip` Vitest reports (task 001-360).

D6, after "The file-level check of a test file records `pass` whenever the file loads, …":

> It records `fail` when the file loads but a `beforeAll` or `afterAll` throws, at file level or inside a `describe`; the tests that hook kept from running are `skip`.

## Tests

`test/runners/vitest/suite-errors.test.ts`, red before (3 of 3 failed on the old reporter), green after:

- the research fixture's shape (`f-describe-beforeall`): `<file>` FAIL with "connect ECONNREFUSED 127.0.0.1:5432" and the hook's location, `group > inside` SKIP, `outside` PASS, through `recordsForFile` and `describeFailure`;
- nested describes and a describe-level `afterAll`: one error each, innermost suite only;
- a file-level and a describe-level `afterAll` together: the file's error first, and the `suite-level error (group)` log line;
- an empty `describe`: FAIL with "No test found in suite empty".

## For the coordinator

- `src/runners/vitest/reporter.ts` is a guarded key source: `test/keys/key-format.test.ts` fails until `KEY_FORMAT_VERSION` is bumped and the new sources hash pinned (`69201afcf387e87f3024bc4557c76e51bdb6009e2765383006ca945287bbdb20` at this commit's sources).
- `test/evals/atomic-trend.test.ts` was already failing at Squeal's baseline (revision 0) before any edit here.
