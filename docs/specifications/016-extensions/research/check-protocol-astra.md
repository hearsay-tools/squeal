# A language-neutral check protocol: independent findings

**Recommendation [inferred]: use a small Squeal contract over persistent JSON-RPC for providers in other languages, with existing result formats read by adapters.** No candidate supplies the complete validity contract. BSP offers the nearest build-oriented control model; MTP offers the nearest test-oriented one. Neither removes the need for Squeal-specific input and completion evidence.

Research 016-07, 2026-10-24. Squeal examined at `ef41742aae3e5600e61e3d9ac556c6f5ab88a112`. No spec exists yet. This report follows 011 C3/C4/C14, 013 V4, and `RunnerAdapter`. It did not read or fetch `check-protocol.md`. Tags below: **D** = `read in official docs`; **S** = `read in source code`; **E** = `verified by experiment`; **I** = `inferred`. Source IDs give the version or dated snapshot for each finding.

## Questions answered

| Question | Answer and evidence |
| --- | --- |
| 1. Candidate coverage | **D/S:** Control protocols and result formats solve different parts. The table below covers all twelve candidates. |
| 2. `RunnerAdapter` and keys | **S/I, S0:** No candidate carries C3's whole input model or C4's acceptance rule. Every adapter member is mapped below. |
| 3. Diagnostic identity | **D/S/I, S0/S2/S7:** LSP has no stable per-diagnostic ID. SARIF defines versioned fingerprints, but does not guarantee that producers supply them. Location plus message is not stable across edits. |
| 4. Transport and per-edit cost | **D/I, S1/S2/S3:** JSON-RPC can reuse a process; it does not promise that a provider can. No quantitative per-edit overhead was established. No timing experiment was run. |
| 5. Real conversion | **E, Node v24.21.0:** Three TAP 13 outcomes became a `RunReport`; truncated and signalled runs produced no trusted results. Input identity and completion needed launch context. |

## Findings

### 1. Coverage

**D/S, versions in S1–S12.** “No” means the cited protocol has no such operation; a tool around it may add one. Enumeration means without executing test bodies, not necessarily without compilation or loading code. None supplies Squeal's revision-aware cross-run transitions. State columns describe producer events or comparisons instead.

| Candidate | Identity and enumeration | States, failure output and location | Streaming / reusable process | Subset selection |
| --- | --- | --- | --- | --- |
| BSP (D, S1) | Target URI; test display name/task ID is not a stable check ID. Lists targets and sources. Test-class discovery is a language extension. | Test start/finish and pass/fail/ignored/cancelled/skipped; message, optional location/data. Compile diagnostics have target and file. | Notifications / yes, server lifecycle | Targets in base protocol; Scala extensions select classes/tests. |
| LSP push and pull diagnostics (D, S2) | Document URI, rule/code, range; no diagnostic ID or check enumeration. | Push replaces a file's diagnostics; empty list clears them. Pull returns full or unchanged reports. Message, severity, range, related locations. | Push and partial workspace pull / yes | Pull selects a document or workspace, not test cases. Push is server-driven. |
| Microsoft.Testing.Platform JSON-RPC (D/S, S3) | Test-node `uid`; discovery without execution is a capability. | Discovered, in-progress, passed, failed, skipped, timed-out, error, canceled; structured error, stack, location, output. | Updates / conditional: current host advertises **no multi-request support** | Discovered nodes or graph filter. |
| TeamCity service messages (D, S4) | Suite/test name plus flow context; no discovery operation. | Started/failed/ignored/finished; no failure before finish means success. Details, comparison values and output; source location is not a required structured field. | Stdout messages / no lifecycle contract | No. |
| TAP 14 (D, S5) | Stream-local number and optional description; no discovery. | `ok`/`not ok`, skip/todo, bailout, plan; optional YAML diagnostics without a fixed error/location schema. | Line stream / no lifecycle contract | No. |
| JUnit XML, Jenkins xUnit dialect (S, S6) | Suite/class/name; no discovery. | Failure/error/skipped elements, output; missing failure means pass only within a complete report. Suite `file` is optional; testcase location absent in this schema. | Report document / no lifecycle contract | No. |
| SARIF 2.1.0 (D, S7) | Rule and locations; optional fingerprints/correlation. Rule catalogue is not check enumeration. | Findings, messages, locations, stacks/flows; `baselineState` compares runs: new/unchanged/updated/absent. | Log document, not a live control protocol / no | No execution selection. |
| `go test -json` (D, S8) | Package and test name, not source file. Separate `-list` lists top-level tests only. | Run/pause/continue/pass/fail/skip/output; failure location usually embedded in output. Package/build failures can lack a test name. | NDJSON / one invocation | CLI `-run`; finding subtests executes parents. |
| libtest JSON (S, S9) | Test name within a binary. `--list` discovery emits names and source positions in examined source. | Started/ok/failed/ignored/timeout, captured output; execution failure lacks a required structured source frame. | NDJSON / one invocation | Name filters and `--exact`; JSON remains gated by nightly unstable options. |
| cargo-nextest (D, S10) | Binary/package plus test name. JSON list enumerates cases. | Experimental libtest-compatible result stream; optional nextest fields. Failure output, no guaranteed structured failure location. | NDJSON / one invocation | Filtersets and name filters. |
| Gradle Tooling API (D, S11) | Operation/test descriptors; JVM class/method selectors. No separate enumeration operation in the cited TestLauncher API. | Start/finish with success/failure/skipped results and failures; source location is not guaranteed. | Listener events / Gradle daemon reused | Descriptors, classes, methods, task test specs. Java API, not a neutral wire contract. |
| Bazel BEP (D/S, S12) | Configured target and run/shard/attempt. No test-case discovery operation. | Target/attempt status, timeout/cache information and log/XML artifacts; individual case detail may require `test.xml`. | Protobuf/JSON events, optional BES upload / no control lifecycle in BEP | Bazel invocation selects targets; BEP itself does not. |

**D/S, S1/S3/S8/S12:** Four distinctions matter. BSP `inverseSources` returns targets *containing* a document, not its dependent tests or transitive inputs. MTP's terminal `changes: null` notification is needed to finish consuming updates; awaiting the RPC response alone is insufficient. Go can replay cached successes. BEP explicitly identifies cached attempts. **I:** A protocol bridge must preserve that provenance and completion evidence rather than call every received result a fresh local run.

### 2. The contract Squeal would still need

**S, S0:** Check identity is `(project, relative test path, fullName)`, with line suffixes for duplicate names. Foreign UIDs, target IDs, and binary/test names need an explicit mapping; several producers do not give a test file at all. Focused outcomes are not ordinary stored validity results. `fileEnded` is a scheduling hint; only the later report, completion barrier and stability check permit storage.

**I, grounded in S0 and the candidate table:** The following maps every `RunnerAdapter` member. “Add” means the examined standard does not supply the required semantics.

| Members | Existing support and required addition |
| --- | --- |
| `name`, `adapterVersion` | BSP/LSP/MTP identify a server/version; SARIF identifies a tool. Add the version of Squeal's conversion and observation semantics, distinct from the tool and wire versions. |
| `invalidate`, `recheck` | LSP file notifications and BSP target changes cover some invalidation. Add add/change/delete/**touch** semantics, recreated-project reporting and cheap checks of unwatched environment inputs. |
| `affected` | BSP membership and target dependencies can support coarse selection. LSP reports whether inter-file dependencies exist. Add direct/transitive affected-check sets; neither supplies this mapping. |
| `closure` | BSP sources/resources/dependencies and BEP artifacts are useful inputs. Add per-check transitive input paths, snapshots, resolution candidates, package segments and observations. They are not complete closures by themselves. |
| `enumerate`, `testFiles`, `omittedTestFiles` | MTP discovery, libtest/nextest lists and partial BSP/Go discovery help. Add stable project/file mapping, templated or incomplete enumeration and excluded-file accounting. A result-only format supplies none of these operations. |
| `environment` | Tool versions, settings, platform or invocation metadata occur in several formats. Add resolved configuration, config/setup dependency files, installed dependency identity and allow-listed environment inputs. `formerFiles`/`formerPackages` serve Squeal's key migration, not a general standard. |
| `run` | All carry some results; BSP/MTP/Gradle also request execution. Add the exact `RunOptions` and `RunReport` guarantees described below. |
| `focuses`, `focusesFile` | Native selectors in BSP/MTP/Go/libtest/nextest/Gradle help. Add Squeal's literal full-name matching, per-file support and collected/matched counts. Zero matches prove no pass. |
| `slowWidth`, `tierWidth`, `tierPart`, `besideBacklog`, `backlogSlot`, `lane` | No candidate expresses these scheduler semantics. Keep their answers local or cached: current calls are synchronous while the scheduler holds its lock. |
| `releaseLane`, `close` | BSP/LSP shutdown/exit and MTP exit cover server termination; Gradle closes a connection. Add ownership of lane-specific resources and safe restart after lane release. |

**S/I, S0:** A run bridge must carry the run ID and selected scope, log destination, timeout, lane, child environment, worker grant, observation request and focus. It must translate `signal`, `stop`, cancellation causes and `fileEnded` callbacks into messages with explicit semantics. JSON serialization alone cannot carry these values. Existing result streams partly fill `end`, durations, results and errors. They do not generally prove `completedFiles`, distinguish file load/teardown errors from project startup failures, name started projects or whole-file skips, or report `observed`, `reads`, `environmentObserved`, `withheld` and `focused`. Interrupted work must not become a pass. A complete producer run still needs Squeal's stability barrier.

**S, S0; I for candidate sufficiency:** C3 keys require content hashes, key/adapter/tool/runtime versions, platform/architecture, canonical resolved configuration, config/setup closures, installed dependencies and allow-listed environment values. Per-file inputs include static/dynamic imports, snapshots, policy inputs and observed reads/listings. Absent resolution candidates remain in the closure so additions invalidate it; current C3 omits absent-path entries from the content key. Revision, commit and worktree are provenance, not key inputs. No examined candidate guarantees this whole set. Transport success, diagnostic `resultId`, a TAP plan, or a SARIF fingerprint cannot substitute for it. Runtime reads also do not prove closure completeness.

### 3. Diagnostics and “the same failure”

**D, S1/S2/S7:** LSP diagnostics belong to a document even when analysis depends on a project. Workspace pull adds per-document reports; `interFileDependencies` states that one file can affect another, without exposing the graph. Push version is optional. Pull `resultId` identifies a cached *report*, not a diagnostic or a Squeal content key. BSP adds a build target and `reset` to diagnostics, so consumers must distinguish replacement from accumulation. SARIF can report project-level findings without a physical location.

**S, S0:** Squeal currently fingerprints the first error name, normalized first non-empty message line and location. It excludes later errors, stack changes and diff changes. Moving a diagnostic to another line changes that fingerprint. **I:** Rule, range and message are useful matching evidence, but cannot guarantee stable identity: lines move, messages change, and one rule can report several instances on one line. Do not put the whole message into a permanent check identity. Prefer a stable file/project analysis scope; correlate its findings separately. The exact new diagnostic check unit remains a spec decision.

**D, SARIF 2.1.0 §§3.27.16–17, S7:** Fingerprint keys name versioned algorithms. Fingerprints should resist irrelevant line-number changes; comparison uses the newest common algorithm version. Direct producers should generally supply partial fingerprints rather than final management-system fingerprints. **I:** This is the strongest reusable identity model in the candidates, but optional fields provide no universal solution. An absent diagnostic means recovery only after a complete, comparable scope was analysed. No message, a disconnected server, or an unfinished report proves no recovery.

### 4. Transport and cost

**D, S1/S2:** LSP uses JSON-RPC with byte-counted framing and supports stdio, pipes and sockets. Its stated goal is reuse across development tools. BSP adopts that base protocol; its discovery command connects through stdin/stdout so clients need not know the build daemon's transport. Both support sessions, capabilities and shutdown. Neither gives a measured per-edit IPC cost in the sources examined.

**D/S, S3:** MTP uses JSON-RPC over loopback TCP with `Content-Length` framing, not stdio. Even its embedded client path uses TCP. Its rationale for multi-request support is avoiding repeated process startup and assembly loading. However, the current host sets `MultiRequestSupport: false`; the protocol says to exit after each request without that capability because tests commonly load user code into the runner process. The reason for selecting TCP over stdio was **not determined** from these sources. The separate `dotnet test` binary named-pipe protocol must not be mistaken for this JSON-RPC protocol.

**I:** A persistent process adds message encoding, copying and dispatch, but need not add process startup per edit. One command per run adds startup and report I/O; it can still reuse an external tool's cache or daemon. An in-process module avoids wire conversion but shares runtime and failure scope. Those are structural tradeoffs, not measured CPU claims. With Squeal's current synchronous scheduling hints, serial RPC per hint would be an avoidable new cost. No source establishes which option is fastest for Squeal; no timing or full-suite run was permitted by this brief.

### 5. Probe

**E, Node v24.21.0:** The [probe](probes/check-protocol-astra/README.md) ran three real Node tests with TAP output. It converted pass/fail/skip, a failure location, message, code, stack and durations into `RunReport`. Exit 1 was a completed failing run. Removing the terminal plan/summary, or supplying a signal, yielded `crashed`, no completed files and no results. Project/file identity came from the launch context. Passing locations, pre-run enumeration, closures, environment, revision, runtime observations, focus and withholding evidence were absent. Node emitted TAP **13**; TAP 14 was read, not exercised. No general TAP parser or full adapter was tested.

## Recommendation for Squeal

**I, from Q1–Q5:** Reuse JSON-RPC's transport conventions and lifecycle for language-neutral code providers, but retain a small Squeal-owned semantic contract. Keep an in-process binding possible for existing JavaScript runners. Treat TAP/JUnit/Go/libtest/nextest as result inputs, LSP as a diagnostic source, and BSP/MTP/Gradle as ecosystem bridges. Do not require every provider to implement BSP's build model or LSP's editor model. Start with conservative scope and declared inputs where precise closures are unavailable; do not grant shared-cache validity from output alone. Capability and failure semantics matter more than the wire format. This recommends a direction, not a protocol schema.

## Open questions

- **Not determined:** measured per-edit CPU and memory for persistent RPC versus the present adapters. The brief prohibits timing; measure a minimal bridge later.
- **Not determined:** cross-edit stability of each framework's MTP UID and completeness of each BSP server's discovery. Specifications alone do not establish implementation behaviour.
- **Not determined:** the right key unit for package/binary tests and project diagnostics that do not map to source files. The present interface assumes test files.
- **Not determined:** end-to-end conformance under edits during execution, provider crashes, duplicate names, retries and incomplete enumeration. The small probe establishes none of these.

## Sources

All external sources were fetched on 2026-10-24. [The manifest and excerpts](probes/check-protocol-astra/README.md) retain URLs, content hashes and exact source pins. Live documentation versions below are observations, not claims about installed tools.

- **S0:** [011 C3/C4/C14](../../011-core/spec.md), [013 V4](../../013-vitest-runner/spec.md), `src/core/types/{runner,check,keys,common}.ts`, `src/core/state/fingerprint.ts`, at the Squeal commit above.
- **S1:** [BSP specification](https://github.com/build-server-protocol/build-server-protocol/blob/9097c78224910a4a285ba3207e55dd33c9e9da97/spec/src/main/resources/META-INF/smithy/bsp/bsp.smithy), Scala extension and server discovery at `9097c782` (source snapshot, not a claimed released BSP version).
- **S2:** [LSP 3.17 specification](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/), diagnostic definitions at `baf2db31`, and [overview](https://microsoft.github.io/language-server-protocol/overviews/lsp/overview/).
- **S3:** [MTP JSON-RPC reference](https://github.com/microsoft/testfx/blob/8ad685a835dce077d64d24f3a4b692fda16447ae/docs/mstest-runner-protocol/001-protocol-intro.md), IDE extension, `TcpMessageHandler.cs` and `ServerTestHost.RequestExecution.cs`, at `8ad685a8`.
- **S4:** [TeamCity service messages](https://www.jetbrains.com/help/teamcity/service-messages.html), dated live documentation.
- **S5:** [TAP 14](https://github.com/TestAnything/testanything.github.io/blob/54d832874658d23c970f900d8b957eae5de8ac6f/tap-version-14-specification.md).
- **S6:** [Jenkins xUnit JUnit schema](https://github.com/jenkinsci/xunit-plugin/blob/0afa700702a6617f483cfd9407711976dc0bd74a/src/main/resources/org/jenkinsci/plugins/xunit/types/model/xsd/junit-10.xsd), representative dialect, not a universal JUnit standard.
- **S7:** [SARIF 2.1.0 OASIS standard](https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/sarif-v2.1.0-os.html), especially §§3.27.16, 3.27.17, 3.27.24.
- **S8:** [Go test2json](https://github.com/golang/go/blob/0d37007fda071631fbcb520b99c85a8e4c93108a/src/cmd/test2json/main.go) and `cmd/go/alldocs.go`, source snapshot `0d37007f`.
- **S9:** [libtest JSON formatter](https://github.com/rust-lang/rust/blob/58cf8f9c35b355199727627d07ae34a4e2846d67/library/test/src/formatters/json.rs) and `cli.rs`, stable-branch snapshot `58cf8f9c`.
- **S10:** [nextest JSON docs](https://github.com/nextest-rs/nextest/blob/96cd53a54c410280a49fea71845d67fd1c93d937/site/src/docs/machine-readable/libtest-json.md), list and filterset docs at `96cd53a5`; result format `0.1` remains experimental in this snapshot.
- **S11:** [Gradle Tooling API guide](https://docs.gradle.org/current/userguide/tooling_api.html), [TestLauncher](https://docs.gradle.org/current/javadoc/org/gradle/tooling/TestLauncher.html) and test-event Javadocs; live guide identifies Gradle 9.8.2.
- **S12:** [Bazel BEP guide](https://bazel.build/remote/bep) and [event schema](https://github.com/bazelbuild/bazel/blob/a5c50fcb65841b505ec72840d83381a704e70afa/src/main/java/com/google/devtools/build/lib/buildeventstream/proto/build_event_stream.proto), source snapshot `a5c50fcb`.
