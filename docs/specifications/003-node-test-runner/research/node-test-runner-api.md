# node:test runner API

Recommendation: spawn the project's pinned Node with a custom reporter, explicit affected files and an external deadline.

Evidence: Linux x64, **Node v22.23.3 and v24.21.0**, **tsx 4.21.0**. Unless a paragraph specifies otherwise, its version scope is both exact versions. These observations do not establish support for every earlier Node 22/24 minor. [Throwaway probes](probes/node-test-runner-api/README.md), [recorded cases and schemas](probes/node-test-runner-api/evidence.md), and raw [22](probes/node-test-runner-api/results/v22.23.3.json)/[24](probes/node-test-runner-api/results/v24.21.0.json) records are the experimental sources; case names below index them.

## Questions answered

| # | Answer | Evidence |
|---|---|---|
| 1 | Both APIs expose structured results; fields differ across versions. | `api-*`, versioned `run()`/`TestsStream` docs |
| 2 | `run()` uses the host executable; spawning selects the project runtime. Neither native timeout is a sufficient cross-version watchdog. | `api-events`, `cli-destination`, timeout cases; `runner.js` |
| 3 | No documented collection-only API; name filtering still evaluates modules. Identity needs nesting and disambiguation. | `api-filter-none`, repeated events, source-map cases |
| 4 | Declare argv, cwd, environment and globs; arbitrary npm scripts cannot be faithfully reduced to argv by splitting strings. | workspace/glob/preload probes; inference |
| 5 | Process isolation costs startup per file; disabling it breaks warm reruns. | 20-file benchmarks, repeat cases |
| 6 | File wrappers, summaries, stderr and error causes serve different purposes. | events/import/syntax/timeout/fallback reporter cases |
| 7 | Preserve tsx, preloads and workspace cwd; coverage, snapshots and filters affect semantics. | native/tsx/coverage/snapshot/only cases |

## Findings per question

### 1. Programmatic API and events

**[verified by experiment; 22.23.3, 24.21.0]** `files` restricts execution to the explicit files; `globPatterns` also works. `execArgv` loads tsx, `--import` and `--require`; `setup` is called before events. `concurrency: 1`, `4`, `true`, `isolation: 'process'|'none'`, `timeout`, abort `signal`, `testNamePatterns`, `only` and `watch` were exercised. Watch reran `value 1` as `value 2` after editing its dependency, and aborted cleanly. Under `isolation: 'none'`, the supplied `execArgv` does not load tsx (`api-none-execArgv`: enum import fails).

**[read in official docs; both, `run([options])`]** Defaults: `concurrency: false` (one process), `isolation: 'process'`, `execArgv: []`, `timeout: Infinity`, `watch: false`; `true` concurrency means available parallelism minus one. `setup(stream)` sets listeners, not project setup. `files` and `globPatterns` are alternatives. Node 24 additionally documents `cwd` and `env`; these are absent from the examined Node 22 API. `env` replaces rather than merges the environment. Do not assume an option rejected nowhere was honored.

**[verified by experiment; both]** The event payload contract observed is below; the probe's evidence file lists every observed top-level field. Locations may be absent, null or transformed. No event supplies a ready-made hierarchical `fullName`.

| Event | Useful fields in `data` |
|---|---|
| `test:enqueue`, `test:dequeue` | `name`, `nesting`, `type` (`suite`/`test`), `file`, `line`, `column` |
| `test:start` | name, nesting, location; declaration/reporting order, not a stopwatch start |
| `test:pass`, `test:fail` | name, nesting, location, `testNumber`, `skip`/`todo`; `details.duration_ms`, `details.type`; failure `details.error` |
| `test:complete` | same identity and details plus `details.passed`; immediate completion, including file wrappers |
| `test:diagnostic` | `message`, `nesting`, optional location; observed `level: 'info'` |
| `test:stdout`, `test:stderr` | `file`, `message`; preserve chunks separately from structured results |
| `test:plan` | `count`, `nesting`, optional location |
| `test:summary` | `success`, `counts`, `duration_ms`, `file` (null for aggregate) |
| `test:coverage` | `nesting`, `summary`: file paths, line/branch/function counts and entries, totals, thresholds, working directory |
| `test:watch:drained` | no payload in the observed streams |

**[verified by experiment; 24.21.0]** Test events add `testId`, `parentId`, `tags`; child-forwarded events add `entryFile`. **[read in official docs; 24.21.0]** IDs identify an instance within its test-file execution, not a persistent check. `parentId` arrived in 24.19 and `entryFile` in 24.20. `test:log` (message/data/name/location/IDs), `test:interrupted` (`tests`: interrupted names/nesting/locations) and `test:watch:restarted` are additional documented events, not observed by this fixture. Node 22 has no IDs or entry-file field in these records. Observed top-level `parentId` is 0 despite docs describing it as undefined. Declaration-ordered pass/fail events are safer for reconstructing nesting on 22 than interleaved enqueue/complete events.

**[verified by experiment; both]** Plain API wrappers receive stdout/stderr events too, although the docs describe these as emitted only with `--test`. The source parses the isolated child pipes; do not suppress them based on the caller's flags.

### 2. Runtime, flags and process boundary

**[verified by experiment; both]** The fixture reports the executable, version, cwd, argv and preload markers. `run()` uses its caller's Node, while spawning the supplied Node path selects that exact version. API failures leave `process.exitCode` unset and the wrapper exits 0; CLI test/import/syntax failures exit 1, success exits 0. The custom reporter's destination contains per-test structured events, independent of console output. **[read in source code; both, `runner.js#getRunArgs`/`runTestFile`]** Child processes use `process.execPath`, inherit filtered parent options, then receive `execArgv`. This is not a way to select another executable, nor is `execArgv: []` a clean flag environment (`api-inherited-flags` confirms preload inheritance).

**[inferred; both]** Prefer a spawned project runtime with explicit argv and package cwd. Capture stderr, require complete stream termination, inspect the final summary and process exit, and enforce a parent-owned deadline/process-group shutdown. A nonzero exit with structured test failures differs from a reporter/bootstrap crash without a complete stream. Resolve the project Node explicitly; the daemon's PATH alone does not prove compliance with a version pin.

### 3. Enumeration and identity

**[read in official docs; both]** The documented CLI and `run()` options have no dry-run or collection-only mode. **[verified by experiment; both]** `--test-dry-run` is rejected (exit 9). An impossible name filter still prints `module-evaluated`; it yields a synthetic file pass rather than the undispatched check inventory. `describe`/`it`, dynamic `t.test`, loop-generated names, skip, todo and only all work. Skip/todo may be `test:pass` events, so an adapter must read their directives. `--test-only` selects the one marked test; without it, process-isolated runs execute ordinary tests too.

**[verified by experiment; both]** Names/nesting remain stable across the two unchanged event runs; loop names are separate runtime checks. With plain tsx the three duplicate declarations all report line 1 with different columns. Assertion `cause.stack` maps to original TS line 9. `api-source-maps` with explicit `--enable-source-maps` restores declaration lines 13, 14 and 15, and assertion declaration line 9. **[inferred; both]** Build full names from suite/parent nesting and use mapped source locations for D4's duplicate suffix. Runtime IDs/ordinal numbers are not cross-run keys. Static AST enumeration can cover literal calls and aliases, but arbitrary loops, imports and dynamic names cannot be collected exactly without executing project code. Cached prior observations cannot enumerate a fresh worktree. How incomplete enumeration satisfies `RunnerAdapter.enumerate` remains a spec question.

### 4. npm scripts and workspace paths

**[verified by experiment; both]** A fixture at `packages/demo` runs both quoted unit and e2e globs through Node, resolves `../../scripts/preload.mjs` against that cwd, loads tsx from the fixture's dependencies and observes both import and require preloads. Shell expansion is unnecessary for these particular glob arguments. **[inferred; both; supplied reference scripts in 003 status]** The reference needs package cwd, Node argv `--import ../../scripts/test-git-env.mjs --import tsx --test`, and separate `test/unit/*.test.ts` / `test/e2e/*.test.ts` globs. For affected execution, expand the globs for discovery and replace them with selected files. Preserve option order and explicit environment assignments.

**[inferred; both]** Reading a narrowly recognized `node ... --test ...` script can seed configuration, but treating all scripts as argv mishandles quoting, environment expansion, wrappers, pipelines, chained setup and npm lifecycle environment. Running the script loses selected-file control and can run extra commands. Explicit configuration for executable, argv, cwd, environment and globs avoids that ambiguity but can drift from scripts and omit setup or npm-provided variables. Recommend explicit configuration, with unsupported script forms requiring a declared equivalent. Parsing arbitrary shell is not part of these probes.

### 5. Cost and isolation

**[verified by experiment; both]** Three samples per configuration, 20 one-assertion TypeScript files, same Linux host; no intentional delay. Host instrumentation still emits proxy warnings even when the launcher clears `NODE_OPTIONS`. See the evidence table for wall times and per-file process-wrapper timings. Startup dominates; per-case bodies are tiny. Concurrency improves throughput, but a single affected file still pays a fresh tsx process startup. Measurements are host-specific, not a latency promise. Median wall milliseconds:

| Configuration | Node 22.23.3 | Node 24.21.0 |
|---|---:|---:|
| 20 files, concurrency 1 / 4 / true (23) | 12,779 / 4,184 / 1,420 | 14,230 / 4,286 / 1,646 |
| 20 files, isolation none | 871 | 928 |
| One file, API / CLI | 739 / 653 | 879 / 927 |
| Per-file wrapper, concurrency 1 (median; min–max) | 618; 380–988 | 719; 437–960 |

**[verified by experiment; both]** `repeat-process` sees `value 1`, then `value 2`. `repeat-none` never reruns the original test after the edit and instead emits a placeholder file pass. Node 24 additionally exits 13 with unsettled top-level await on second streams. `repeat-none-fresh-entry` copies the entry to a new path: its unchanged import URL still supplies cached dependency value 1. **[read in official docs; both]** Isolation none shares globals across files. **[inferred; both]** Its lower 20-file startup cost does not justify using it as a warm validation instance; it can turn stale execution into apparent success.

### 6. Durations, failures, timeout and reporters

**[verified by experiment; both]** Successful ordinary files have no separate file `test:pass`; a file wrapper `test:complete` carries whole-process `duration_ms`. Per-file `test:summary` duration is shorter and excludes startup before the test harness. Empty files produce synthetic file passes. Match wrapper completion to scheduled entry files, not arbitrary names or suite totals. Assertion failures carry `ERR_TEST_FAILURE`, `failureType: 'testCodeFailure'`, and nested cause (message, stack, actual, expected, operator); suite failure `subtestsFailed` is an aggregate, not an extra failed leaf.

**[verified by experiment; both]** Syntax/missing-import cases emit file enqueue/dequeue, stderr, file complete/start/fail and aggregate summary, with no named check result. The file error is generic (`test failed`, child exit 1, signal); the useful syntax location or module-not-found stack is in `test:stderr`, not its cause. Plain JSON serialization drops non-enumerable error fields, so the probe explicitly serializes them.

**[verified by experiment; 22.23.3]** API and CLI timeouts terminate the interval-holding promise and synchronous busy-loop files; API abort works too. **[verified by experiment; 24.21.0]** The promise emits `testTimeoutFailure` but keeps the child alive; a busy loop cannot service its timeout. Both API and CLI require the 8-second external watchdog; aborting the API stream does terminate the file. **[read in source code; 24.21.0]** `FileTest` sets `this.timeout = null`, while `getRunArgs` forwards the timeout to the child. **[inferred; both]** Treat missing end-of-run evidence as incomplete, even after a timeout failure event, and keep Squeal's policy deadline outside Node's test API.

**[verified by experiment; both]** TAP, spec and JUnit all render the failing fixture with CLI exit 1; preserved text/XML is in `reporter-*`. **[inferred; both]** They are useful full-log fallbacks. None removes the need for a semantic parser and correct skip/todo/suite handling; custom structured events avoid reparsing human formatting.

### 7. Sharp edges

**[verified by experiment; both]** Native stripping runs erasable TS, but an enum fails without tsx and passes with tsx. ESM TS importing CJS works. Missing snapshots fail; `--test-update-snapshots` writes `snapshot.test.ts.snapshot`, then a normal run passes. **[read in official docs; both]** Native stripping does not honor tsconfig paths or transform arbitrary TS; snapshot paths/serializers are customizable. `--test-concurrency` controls file processes (CLI default: available parallelism minus one), unlike the API default of one. It is ignored with isolation none; within-file test concurrency is separate. **[inferred; both]** Preserve the project's loader chain instead of substituting native stripping; include preload closures, runtime/tsx versions and flags in the environment fingerprint. Snapshot update is a mutating authoring operation, not a background validation flag. Snapshot path customization needs declared inputs or another conservative rule. Filtered/only/skip/todo runs cannot establish that omitted checks passed; never retire undispatched checks merely because this stream omitted them.

**[verified by experiment; 22.23.3]** Coverage includes the test and preload. **[verified by experiment; 24.21.0]** CLI coverage excludes the test, retaining the preload; API coverage also includes the probe driver/serializer. **[read in official docs; 24.21.0]** Matching test files are excluded by default. **[inferred; both]** Coverage output is not a stable, complete dependency closure or a portable file inventory.

## Recommendation for Squeal

**[inferred from both versions]** Use a fresh project-Node CLI process per selected tier, process isolation, a custom reporter and a parent deadline; declare cwd/argv/env/globs and preserve tsx. Enable and verify source maps before relying on declaration lines. Keep file completion, file errors and check results distinct. This fits the execution part of `RunnerAdapter`; enumeration completeness and identity ambiguities need explicit spec decisions before implementation.

## Open questions

- Exact static enumeration guarantees for dynamic names/aliases, and disambiguation for loop-generated identical names at the same mapped location: not determined, because runtime events alone cannot reconstruct unexecuted definitions.
- Node selection/pin resolution, arbitrary npm wrappers and user-defined snapshot resolvers: not determined, because those are project configuration policies, not Node test-runner APIs.
- Earliest supported Node minors and Windows/macOS process-tree termination: not determined, because experiments used only the two exact Linux versions above.

## Sources

Fetched versioned official documentation and implementation, not recalled APIs:

- Test runner docs: [22.23.3](https://github.com/nodejs/node/blob/v22.23.3/doc/api/test.md), [24.21.0](https://github.com/nodejs/node/blob/v24.21.0/doc/api/test.md), especially `run([options])`, `TestsStream`, process isolation, reporters and snapshots.
- CLI options: [22.23.3](https://github.com/nodejs/node/blob/v22.23.3/doc/api/cli.md), [24.21.0](https://github.com/nodejs/node/blob/v24.21.0/doc/api/cli.md). TypeScript: [22.23.3](https://github.com/nodejs/node/blob/v22.23.3/doc/api/typescript.md), [24.21.0](https://github.com/nodejs/node/blob/v24.21.0/doc/api/typescript.md).
- `runner.js`: [22.23.3](https://github.com/nodejs/node/blob/v22.23.3/lib/internal/test_runner/runner.js), [24.21.0](https://github.com/nodejs/node/blob/v24.21.0/lib/internal/test_runner/runner.js): `getRunArgs`, `runTestFile`, `FileTest`, none-isolation imports. `test.js` location mapping: [22.23.3](https://github.com/nodejs/node/blob/v22.23.3/lib/internal/test_runner/test.js#L670), [24.21.0](https://github.com/nodejs/node/blob/v24.21.0/lib/internal/test_runner/test.js#L789). Event construction: [22.23.3](https://github.com/nodejs/node/blob/v22.23.3/lib/internal/test_runner/tests_stream.js), [24.21.0](https://github.com/nodejs/node/blob/v24.21.0/lib/internal/test_runner/tests_stream.js).
