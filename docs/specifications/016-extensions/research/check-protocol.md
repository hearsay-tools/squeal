# 016-03: a language-neutral check protocol

Brief: `check-protocol-brief.md`. Researcher, 2026-10-24. Evidence: protocol specifications and schemas fetched on 2026-10-24 at the revisions in Sources; Squeal's runner contract at `0822a4440`; probes in `probes/check-protocol/` (Node v24.21.0 TAP and JUnit, real `go test -json` streams from Go's test data, Biome 2.5.15 SARIF and TypeScript 7.0.2 on one file before and after an edit). No Go, Rust, .NET, Gradle or Bazel toolchain is on this host, so those were read, not run.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Coverage | Only Microsoft.Testing.Platform (MTP) has all of: a stable test id, enumeration without a run, streamed states, a structured failure, and selection by id. BSP's unit is the build target; its tests are display names. TAP, JUnit XML and SARIF are documents with no enumeration and no selection. `go test -json` and libtest JSON are streams keyed by name with no location in Go. | read in official docs, read in source code |
| 2 | Squeal's needs | Results, states and a whole-run end map onto every test format. No candidate carries the closure, the environment inputs, a per-file end, withheld results or focused counts. Three carry part of the rest: BSP `inverseSources` (file to target), LSP `didChangeWatchedFiles` (invalidate), MTP `discoverTests` (enumerate). | read in official docs, verified by experiment |
| 3 | Diagnostics | LSP and BSP report per document and replace the whole set; LSP declares `interFileDependencies`. A diagnostic has no id in LSP; SARIF's fingerprints are optional and Biome writes none. A fingerprint with a line number changes when a line is added above; rule, message and a hash of the line's text do not. | read in official docs, verified by experiment |
| 4 | Transport | LSP, BSP and MTP all chose JSON-RPC to a separate process. Their reasons: servers in their own language, CPU and memory kept out of the editor, one server for many clients. MTP expects one run per process. None of their docs gives a per-message or per-edit cost. | read in official docs; cost not determined |
| 5 | Probe | Converted. Missing in all three: closure, environment, per-file end, withheld, focused counts, duplicate-name disambiguation. TAP drops the file of a passing test. JUnit drops the import error. Go gives no location, and a timed-out test has no end event. | verified by experiment |

## 1. Coverage per candidate

| Candidate (version) | Check identity | Enumerate without a run | States | Failure output, location | Streaming | Long-lived | Subset |
|---|---|---|---|---|---|---|---|
| BSP 2.2.0-M4 | build target URI; a test is a `displayName` string | no, except language extensions (`buildTarget/scalaTestClasses`, deprecated for `jvmTestEnvironment`) | `PASSED FAILED IGNORED CANCELLED SKIPPED` | `message` string, LSP `Location`, opaque `data` | `build/taskStart`/`taskFinish` notifications | yes, client-managed | targets; per test only through language `data` (`scala-test-suites-selection`) |
| LSP 3.17 diagnostics | none per diagnostic; set per document URI | n/a | present or absent | `range`, `code`, `source`, `message` | push notification; pull with `resultId` and `unchanged` | yes | per document; workspace pull |
| MTP JSON-RPC 1.0 | `uid`, "Used by client for equality of tests" | `testing/discoverTests` | `discovered in-progress passed skipped failed timed-out error canceled` | `error.message`, `error.stacktrace`, `assert.actual/expected`, `location.file`, `line-start/end` | `testing/testUpdates/tests` | no: "the expected lifetime of the test runner is a single run"; `multiRequestSupport: false` today | `tests?: TestNode[]` or `filter` |
| TeamCity service messages | suite + test name; "must not deviate from one build to another" | no | `testStarted testFailed testIgnored testFinished` | `message`, `details`, `expected`, `actual` | yes, lines on stdout, `flowId` per parallel flow | no | no |
| TAP 14 | test point number and description | plan gives a count only | `ok`, `not ok`, `# SKIP`, `# TODO`, `Bail out!` | YAML block; "has not been standardized" | yes | no | no |
| JUnit XML (no official spec) | `classname` + `name`, optional `file`, `line` | no | pass, `failure`, `error`, `skipped` | `message`, `type`, body text | no, one document | no | no |
| SARIF 2.1.0 | `ruleId` + `locations`; optional `fingerprints`, `partialFingerprints` | n/a | `kind` (`pass fail review open notApplicable informational`), `baselineState` (`new unchanged updated absent`) | `message`, `region`; `invocations[].executionSuccessful`, `toolExecutionNotifications` | no, one document | no | no |
| `go test -json` (go master `1fce9ba`) | `Package` + `Test`, subtests by `/` | `-list regexp`: top-level tests only, no file or line | `start run pause cont pass fail skip output bench` | output text only, `OutputType` `error`; `FailedBuild` | yes, "no unnecessary input or output buffering" | no; one binary per package | `-run`, `-skip` regexps |
| libtest JSON (rust `df87fa6`) | test `name` | `discovered` event with `source_path`, `start_line`, `start_col` | `started ok failed ignored timeout` | `stdout`, `message` | yes | no | name substrings, `--exact` |
| cargo-nextest (`96cd53a`) | binary id + test name | `list --message-format json` (stable) | through JUnit; libtest JSON experimental | JUnit | experimental | no | not read |
| Gradle Tooling API 9.8.2 | `JvmTestOperationDescriptor` suite, class, method, `getSource()` | not found in the pages read | `TestSuccessResult`, `TestFailureResult`, `TestSkippedResult` | `Failure`: message, description, causes | progress events | Java client library | `TestLauncher.withTests(descriptor)`, `withJvmTestMethods` |
| Bazel BEP (master `a5c50fc`) | target `label` + configuration + run, shard, attempt | no | `PASSED FLAKY TIMEOUT FAILED INCOMPLETE REMOTE_FAILURE FAILED_TO_BUILD TOOL_HALTED_BEFORE_TESTING` | per target; per test case only in `test.xml` in `test_action_output` | delimited protobuf, JSON file, or gRPC | Bazel server | targets |

Added beyond the brief:

- **Squeal's own NDJSON streams** (read in source code, `src/runners/node-test/run/events.ts`, `src/runners/pytest/run/events.ts`). The node:test and pytest adapters already run the runner as a child process, with a Squeal reporter or plugin that writes one JSON event per line. The closure stays in Squeal's process: pytest's import graph is parsed with tree-sitter in `src/runners/pytest/graph/`. These are the out-of-process precedent the core already trusts.
- **Biome's rdjson reporter** (Reviewdog Diagnostic Format, verified by experiment). It writes relative paths, `code.value` (the rule), a `range` and `suggestions`. Biome's SARIF writes absolute URIs and no fingerprints.

CTRF and pytest-reportlog were not examined.

## 2. Squeal's needs against the candidates

`RunnerAdapter` at `0822a4440` (`src/core/types/runner.ts`) against what a candidate already carries:

| Squeal member or input | Carried by | Squeal must add |
|---|---|---|
| `name`, `adapterVersion` | BSP `build/initialize` result, SARIF `tool.driver` | the version as a key input (011 C3 environment hash) |
| `testFiles()` | BSP `buildTarget/sources`, MTP `discoverTests` (`location.file`), nextest `list` | per project |
| `enumerate(file)` | MTP `discoverTests`, libtest `discovered`; Go `-list` partly | the duplicate-name line suffix (013 V4) |
| `invalidate(paths)` with `touch` | LSP `workspace/didChangeWatchedFiles` (Created, Changed, Deleted) | `touch`, and `InvalidateResult.recreatedProjects` |
| `affected(paths)` direct and transitive | BSP `buildTarget/inverseSources` gives targets, not test files | the direct/transitive split (011 C4 step 4) |
| `closure(file)` paths and packages | none | all of it; it is the key (011 C3) |
| `environment()` | none | all of it |
| `run()` results, outcomes, durations | all test candidates | — |
| `completedFiles` | Go per-package `pass`/`fail` event, BSP `taskFinish` per target | a per-file end in every format |
| `fileErrors` with `phase` | Go `FailedBuild` and package `fail`; Node TAP and JUnit only as "test failed" | the error text, and `load` vs `after-tests` |
| `startupFailure`, `startedProjects` | none | all |
| `withheld`, `observed`, `reads` | none | all |
| `focused` counts, `RunOptions.checks` | selection: MTP `tests`/`filter`, Go `-run`, Gradle `withTests`; counts: none | `collected` and `matched` |
| `RunOptions.signal`, `stop` | LSP, BSP, MTP `$/cancelRequest`; BSP "Cancelling this request must kill the running process" | — |
| `lane`, `tierWidth`, `slowWidth`, `backlogSlot`, `besideBacklog` | none | scheduling hints; outside keys (011 C14) |

The gap is the same in every candidate. They report what ran and how it ended. None reports what a result depends on, so none can key a result or prove it stable (011 C3, C4). That part is Squeal's own, whatever the wire format.

## 3. Diagnostics

- **Per file or per project.** LSP pushes per document and "Newly pushed diagnostics always replace previously pushed diagnostics. There is no merging" (read in official docs, 3.17). BSP adds the build target and a `reset` flag, so one document may hold diagnostics from several targets (read in source code). LSP's `interFileDependencies` says whether "editing code in one file can result in a different diagnostic set in another file", "common for most programming languages and typically uncommon for linters". Biome lints per file. `tsc` compiles a program, so one edit can change another file's diagnostics (inferred).
- **Stable identity.** An LSP `Diagnostic` has `code`, `source`, `range`, `message` and no id. SARIF has `ruleId` and optional `fingerprints` and `partialFingerprints`; Biome 2.5.15 writes neither (verified by experiment). GitHub fills `partialFingerprints.primaryLocationLineHash` itself when absent: a rolling hash over the first 100 non-space characters from the start of the line, plus a count of equal hashes in the file (read in source code, `codeql-action/src/fingerprints.ts`). TeamCity inspections carry `typeId`, `file`, `line` (read in official docs).
- **Experiment** (`out/diag-identity.txt`). One comment line was added above the code. Both Biome diagnostics moved from line 2 to line 3, and `tsc`'s TS2322 moved from `(3,3)` to `(4,3)`. A fingerprint built as Squeal builds a test's, `<name>: <message> @ <path>:<line>:<column>` (`src/core/state/fingerprint.ts`), changed for both. Rule, message and a hash of the line's text with an occurrence index stayed equal for both.
- **"The same failure".** For a test, the identity is the check and the fingerprint is the first error line and its location. For a diagnostic, the location is part of what identifies it. If a line number enters its fingerprint, an edit above it reads as a changed failure. 015 D5 already chose, for code checks, a fingerprint without the value. The candidates give rule and message. A content-anchored location is Squeal's to compute when the tool gives none (inferred).

## 4. Transport

- **LSP** (read in official docs). JSON-RPC with a `Content-Length` header. A server should accept `--stdio`, `--pipe`, `--socket` or `--node-ipc`, and `--clientProcessId` so that it can exit with its client. The VS Code guide gives the reasons for a separate process: servers "are usually implemented in their native programming languages", and analysis "could incur significant CPU and memory usage", so a separate process "avoids performance cost". The client restarts a crashed server, but VS Code stops after 5 crashes in 180 s.
- **BSP** (read in official docs). LSP's base protocol. Discovery by a connection file (`.bsp/*.json`) that holds `argv`, run in the workspace root with the client's environment. The client starts and stops the server. No dynamic registration, "for simplicity". It states: "not an approved standard".
- **MTP** (read in official docs). JSON-RPC over loopback TCP (`--server jsonrpc --client-host --client-port`). The child process is the default; an in-process path exists for platforms that cannot start processes. Since the runner "loads and runs user code in the runner's process, the expected lifetime of the test runner is a single run".
- **Per-edit cost.** None of the three documents a cost per message or per edit: not determined. The brief allows no timings on this loaded host. What Squeal knows of its own: Vitest's per-run floor is 110 to 350 ms for one file (013 V4), and node:test and pytest already start a process per run (read in source code). So a protocol boundary adds serialization per message. A process per run adds a start-up per run, unless the provider stays warm as LSP and BSP servers do (inferred).

## 5. Probe

`probes/check-protocol/convert.mjs` turned each output into a `RunReport` (`out/report-*.json`). Verified by experiment:

- **Node TAP.** Writes "TAP version 13" with TAP 14 subtests. A passing or skipped test has no `location`, and nesting starts at the `describe`, so its test file is unknown (`testPath: "?"`). The import error of `broken-import.mjs` is only `#` comments before the point `not ok 1 - broken-import.mjs`, whose YAML says "test failed".
- **Node JUnit.** Every `testcase` has `file`, none has `line`. `classname` is the innermost suite only. The import error is not in the XML at all.
- **Both.** The two tests named `math > adds` are told apart only by their order. The run's end is the only end, so every file reads as completed when the process exits.
- **`go test -json`.** No location; a failure's `a_test.go:6` is in output text. In `timeout.json` the test `Test` has `run` and output "panic: test timed out after 1s" but no `pass` or `fail`; only the package fails. A naive reading lists the package as completed with no result for `Test`. 011 C5 then reports it as "no longer reported" (inferred). The converter maps it to a file-level error instead.
- **Missing everywhere:** closure, environment, `withheld`, `observed`, `focused` counts, startup failure as distinct from a file's load failure.

## Recommendation for Squeal

1. **Adopt no existing protocol whole (Q1, Q2).** Each one carries results. None carries the inputs that make a result current (011 C3), so a third-party check behind any of them alone could store a false pass under a wrong key. That is the tradeoff that decides it.
2. **A no-code tier can read existing formats as run output only (Q1, Q5).** Rank: `go test -json` and libtest-style streams (a per-package end, streamed), then JUnit XML (has `file`), then TAP (loses the file). Their results need keys Squeal builds from declared input globs, at whole-file or whole-project granularity. They need two rules: a started check with no end is a file-level failure, never a retirement; and a file with no end of its own completes only when the process exits 0 or the format says so.
3. **For the full tier, use LSP's base protocol over stdio and MTP's test-node model (Q1, Q4).** That means a `uid`, `location`, `execution-state`, discover separate from run, and selection by ids. Add Squeal's members: `closure`, `environment`, `invalidate` with `touch`, `affected` with the direct/transitive split, a per-file end, file errors with `phase`, `withheld`, focused counts. Its framing, cancellation and capability handshake are proven across editors. BSP's target unit, display-name tests and unapproved status make it the wrong base.
4. **Diagnostics in LSP's `Diagnostic` shape, per file, whole-set replace (Q3).** Optionally accept SARIF `partialFingerprints`. When absent, Squeal computes a content-anchored location as GitHub does. A line number must not enter the fingerprint.
5. **Measure before choosing per-run processes or warm servers (Q4).** The docs give no cost. Squeal's own node:test and pytest adapters are the in-house baseline to measure against when the host is free.

## Open questions

1. The per-message and per-run cost of a process boundary on this host: not measured (no timings allowed; host loaded).
2. Can a provider in a language Squeal does not parse report a closure that is complete? Squeal's recorder observes reads only for Node and Python. A Go provider could read `go list -deps -test`; `go test`'s cache matches a result only while "the files and environment variables are unchanged" that a test opened or consulted (read in official docs); whether that list is output was not found (not determined).
3. Gradle Tooling API enumeration without a run: not found in the pages read.
4. Whether MTP's `multiRequestSupport` becomes general, which would make it a warm server.
5. CTRF and pytest-reportlog were not examined.

## Sources

Fetched 2026-10-24.

- BSP: github.com/build-server-protocol/build-server-protocol at `9097c78224910a4a285ba3207e55dd33c9e9da97` (`BSP_VERSION = "2.2.0-M4.TEST"`): `spec/src/main/resources/META-INF/smithy/bsp/bsp.smithy`, `extensions/scala.smithy`, `docs/specification.md`, `docs/overview/server-discovery.md`.
- LSP 3.17: github.com/microsoft/language-server-protocol at `baf2db31b5fb314a8f358f9a839d3c66e9d98734`: `_specifications/lsp/3.17/specification.md`, `language/publishDiagnostics.md`, `language/pullDiagnostics.md`, `workspace/didChangeWatchedFiles.md`. https://microsoft.github.io/language-server-protocol/overviews/lsp/overview/. VS Code guide: github.com/microsoft/vscode-docs `api/language-extensions/language-server-extension-guide.md` (main).
- MTP: github.com/microsoft/testfx at `8ad685a835dce077d64d24f3a4b692fda16447ae`: `docs/mstest-runner-protocol/001-protocol-intro.md`.
- TeamCity: https://www.jetbrains.com/help/teamcity/service-messages.html.
- TAP 14: github.com/TestAnything/testanything.github.io at `54d832874658d23c970f900d8b957eae5de8ac6f`, `tap-version-14-specification.md`.
- JUnit XML: github.com/testmoapp/junitxml at `1bcb6fb8b620906ec001a2c8e7a7c8e7c563a64b`, `README.md`.
- SARIF 2.1.0: https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json. GitHub: https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/sarif-support; github.com/github/codeql-action at `3306ba4df796b6b5059316f3af8bdea1e2138c9b`, `src/fingerprints.ts`.
- Go: github.com/golang/go at `1fce9bafb0581a5d894b80d91674659854104012`: `src/cmd/test2json/main.go`, `src/cmd/go/alldocs.go`, `src/cmd/internal/test2json/testdata/{panic,timeout,smiley}.json`.
- libtest: github.com/rust-lang/rust at `df87fa6604e33760d4703cccc777a2281bf15a2d`, `library/test/src/formatters/json.rs`, `library/test/src/cli.rs`. nextest at `96cd53a54c410280a49fea71845d67fd1c93d937`, `site/src/docs/machine-readable/{index,list,libtest-json}.md`.
- Gradle 9.8.2: https://docs.gradle.org/current/javadoc/org/gradle/tooling/TestLauncher.html, `events/test/JvmTestOperationDescriptor.html`, `TestOperationDescriptor.html`, `TestOperationResult.html`, `TestFailureResult.html`, `TestSkippedResult.html`, `Failure.html`.
- Bazel: github.com/bazelbuild/bazel at `a5c50fcb65841b505ec72840d83381a704e70afa`, `src/main/java/com/google/devtools/build/lib/buildeventstream/proto/build_event_stream.proto`; https://bazel.build/remote/bep.
- Squeal at `0822a4440`: `src/core/types/runner.ts`, `src/core/types/check.ts`, `src/core/state/fingerprint.ts`, `src/runners/node-test/run/events.ts`, `src/runners/pytest/run/events.ts`; specs 011 C3, C4, C5, C14; 013 V4; 015 D2, D5.
- Probes: `probes/check-protocol/README.md`.
