# Check protocol: judgment

The sharpest divergence is diagnostic identity: a content anchor survives the tested line insertion, but does not establish a stable diagnostic check across edits.

Judge 016-08, 2026-10-24. Inputs: [Opus 016-03](check-protocol.md), [Astra 016-07](check-protocol-astra.md), and the [five-question brief](check-protocol-brief.md). No experiment or product change was made. The research rules prohibit timings and test-suite runs.

Opus read Squeal at `0822a4440`; Astra read `ef41742aae3e5600e61e3d9ac556c6f5ab88a112`. Their cited `RunnerAdapter` and 011 C3/C4/C14 have no diff between those commits. Both used LSP 3.17 at `baf2db31`, BSP source `9097c782`, MTP source `8ad685a8`, SARIF 2.1.0, and Node v24.21.0 for their probes. Version differences that matter are named below. Judgments and proposed rules are **inferred** from the cited evidence. An experiment outranks documentation only for the case it exercised.

## Divergences and decisions

### 1. Diagnostic identity and analysis scope (Q3)

**Opus:** Use LSP-shaped diagnostics with whole-set replacement per file. Accept SARIF partial fingerprints; otherwise compute a content anchor from rule, message, line text and an occurrence index. Exclude line numbers from the fingerprint. The line-insertion case is **verified by experiment** with Biome 2.5.15 and supported by the TypeScript 7.0.2 output. General use of that anchor is **inferred**.

**Astra:** Keep a stable file or project analysis scope. Match findings separately. Rule, range and message cannot guarantee identity; the message must not become a permanent check identity. SARIF's versioned fingerprint model helps, but its fields are optional. This is **read in official docs** for LSP 3.17 and SARIF 2.1.0, and **inferred** for the proposed Squeal check unit.

**Evidence:** Opus's [recorded comparison](probes/check-protocol/out/diag-identity.txt) proves that adding one comment above two Biome findings changes location-based fingerprints and preserves its proposed anchors. Its [script](probes/check-protocol/diag-identity.mjs) includes the message and stripped source line in the anchor. A message or source-line change therefore changes the anchor. Insertion of an identical finding can change occurrence indices. Those cases were not tested. SARIF §§3.27.16–17 require versioned fingerprint algorithms and seek resistance to irrelevant line movement. They do not make every producer supply an identity. LSP gives no per-diagnostic ID. Astra also notes SARIF findings without physical locations; a mandatory file location would exclude them.

**Decision:** Favour Astra for the public contract. Opus proves a useful matching technique, not a universal identity rule. Require the analysis scope and completeness of its diagnostic set. Keep check identity, matching identity and failure fingerprint separate. A changed message can be new failure evidence without creating a new check. Carry location as evidence; do not make a moved line alone mean recovery plus a new failure. Accept a producer's versioned partial fingerprints as matching evidence. Do not promise a generic anchor when they are absent.

**Open experiment:** The coordinator must choose the diagnostic check unit before implementation: scope-level checks or individual findings. A follow-up researcher should compare both against recorded edits that insert a line, change message text, repeat a rule on one line, insert an identical finding, move code, and report a project-only error. Record false recoveries, false new failures and merged distinct findings. Until that decision, do not specify generic per-finding transitions. Recovery requires a complete, comparable analysis of the same scope in either design.

### 2. Missing terminal events and trusted completion (Q2, Q5)

**Opus:** A started check without an end should become a file-level failure, never retirement. Its Go timeout conversion produces a completed synthetic package scope with a file error. This is **verified by experiment** as a conversion of Go's recorded timeout stream at `1fce9baf`; the universal rule is **inferred**.

**Astra:** Interrupted work proves no pass. The Node v24.21.0 TAP probe rejects a truncated stream and a signalled process, producing no completed files or trusted results. A normal exit 1 with a complete failing report remains a completed run. These fixture cases are **verified by experiment**. General completion rules follow 011 C4 and `RunReport`, **read in source code**.

**Evidence:** The probes test different cases. Opus's stream contains an explicit package failure and timeout output. Astra removes completion evidence or supplies an abnormal child exit. Neither experiment proves that every missing test end is a file error. C4 leaves unfinished work unknown or queues it again as applicable. `RunReport.completedFiles` identifies the files whose results may be trusted. `fileEnded` is an early scheduling hint and grants no storage permission. MTP's cited protocol separately requires a terminal `changes: null` notification; an RPC response alone does not prove that callbacks have consumed every result.

**Decision:** Favour Astra's completion rule. Preserve Opus's explicit package failure through a bridge only when its scope and error semantics are established. A missing end alone must not synthesize a trustworthy file failure or retire old checks. A signal, truncated output or provider loss leaves unproven work unknown. A proven load or teardown error uses the corresponding file-error path; a startup error remains distinct. A complete test-failure report can be accepted on the tool's documented nonzero exit. Exit 0 alone does not prove a complete report.

The [Go conversion](probes/check-protocol/out/report-go-timeout.json) also uses a package string as a file path and `durationMs: null`, which the current type does not allow. It shows information loss, not conformance to `RunReport`. Astra's [verification record](probes/check-protocol-astra/verification.txt) includes a literal type check, but its flat TAP fixture proves no general parser or adapter contract.

### 3. Which protocol to build on (Q1, Q2)

**Opus:** Adopt no candidate whole. For the full tier, use LSP's base protocol over stdio and MTP's test-node model: UID, location, state, discovery and selection. It calls MTP the only candidate with stable identity, discovery, structured failure, streaming and ID selection. Recommendation: **inferred**; candidate capabilities: **read in official docs** and **read in source code**.

**Astra:** Own a small Squeal semantic contract over JSON-RPC. Treat BSP and MTP as ecosystem bridges. Do not require their build or test models from every provider. MTP offers a UID, but cross-edit stability in actual frameworks remains unverified. Recommendation: **inferred**; protocol fields: **read in official docs** at the same MTP pin.

**Decision:** The transport proposals largely agree. Favour Astra's limit on the public semantic commitment. Reuse JSON-RPC framing and lifecycle conventions. Borrow MTP's separation of discovery, execution and updates where useful. Do not adopt MTP UIDs as Squeal identity without a defined mapping and provider guarantee. Do not require all providers to represent checks as test nodes with source files. BSP's target model is useful to a bridge, but target membership is neither affected-test selection nor a closure. Its draft status is secondary to that semantic mismatch.

No candidate supplies C3's inputs or C4's acceptance rule. That is the decisive reason to keep Squeal's contract. MTP is a useful test-control reference, not evidence that its UID solves identity for every framework. Stable JSON listing in nextest also does not imply a stable execution protocol.

### 4. Transport by tier and process reuse (Q4)

**Opus:** Recommend stdio RPC for the full tier, then measure before choosing a warm server or a process per run. **Read in official docs:** LSP and BSP keep sessions; MTP expects one run per process. Costs: not determined.

**Astra:** Use persistent RPC for providers in other languages, retain an in-process binding for JavaScript, and keep command/report adapters. Process reuse is a capability. **Read in official docs** and **read in source code:** MTP's current host advertises `MultiRequestSupport: false`; Gradle reuses its daemon. Costs: not determined.

**Decision:** Specify bindings by tier, without a speed claim:

- A command/report tier runs a configured command and reads a named output dialect. Its underlying tool may reuse its own daemon or cache.
- A language-neutral code provider uses JSON-RPC with `Content-Length` framing over stdio. Reserve stdout for protocol messages and stderr for logs. Negotiate process reuse, discovery, selection, cancellation and observation separately. Keep a capable provider alive; restart one whose lifecycle requires it.
- An in-process JavaScript binding may implement the same semantics for existing runners. It shares Squeal's runtime and failure scope. A process binding permits other languages and separates process failures; it does not prove safe or correct execution.

These are design choices **inferred** from the documented lifecycles, not performance results. MTP uses loopback TCP, including its embedded path. Neither report establishes why it chose TCP. A persistent controller need not keep the user-code test process alive. Cache synchronous scheduling hints locally; do not turn each call under the scheduler lock into RPC.

**Open experiment:** Before claiming a CPU benefit or requiring migration of a shipped runner, a follow-up researcher must compare an in-process binding, persistent RPC and a per-run command under equal selection and startup policy. Include encoding, process startup, memory and total CPU per edit. The reports provide no quantitative cost bound.

### 5. Format ranking, locations and discovery (Q1, Q5)

**Opus:** Rank Go/libtest streams, then JUnit, then TAP for the command tier. Its Node v24.21.0 JUnit output contains testcase files; its TAP output loses passing-test files. **Verified by experiment** for those outputs. The format ranking is **inferred**.

**Astra:** Supply file identity from launch context when needed. JUnit location depends on the dialect; libtest JSON is nightly-gated and nextest result JSON remains experimental. **Verified by experiment** for one launched TAP file; **read in official docs/source code** for the format limits. Astra reads the Jenkins xUnit schema at `0afa7007`; Opus reads testmo's JUnit survey at `1bcb6fb8`. The Rust snapshots differ (`58cf8f9c` and `df87fa66`), so omitted gating is not evidence of a common stable release.

**Decision:** Do not choose a universal format ranking. Prefer the selected tool's supported structured output and pin its dialect/version. One launched file can give TAP a sound scope mapping. A JUnit document cannot be assumed to contain file locations. Go package names and nextest binary IDs need explicit scope mappings; they must not silently become source paths. Support for package/project units remains a spec decision under divergence 1 and the spec input below.

Both reports correctly identify nextest listing as discovery. MTP's distinction is its combined control API, not exclusive ability to enumerate. Go listing covers top-level names only. No provider may call incomplete discovery a full inventory or infer deletion from an interrupted run.

## Agreements

- **Q1:** BSP, LSP and MTP offer control or diagnostic lifecycle semantics. TeamCity, TAP, JUnit, SARIF, Go, libtest, nextest and BEP supply differing result evidence. Gradle exposes a Java control API. None implements Squeal's cross-run transitions or its whole validity contract.
- **Q2:** Results alone omit complete closure and environment evidence. Core must retain key construction, stability checks, storage acceptance and transitions.
- **Q3:** LSP has no diagnostic ID. Location-based identity moves with edits. Optional SARIF fingerprints do not solve missing producer identity.
- **Q4:** LSP/BSP process reuse and MTP's current single-request lifecycle are documented. Neither report measures per-edit overhead.
- **Q5:** The probes translate real output but need launch context and Squeal-specific input/completion evidence. Both exercise Node TAP 13; neither proves TAP 14 interoperability or end-to-end conformance.

## Spec input

The coordinator can use these proposed rules without reopening the findings. They are **inferred** design input, not an approved schema.

1. **Own the semantics; reuse the wire.** Publish a versioned Squeal check-provider contract. Offer a command/report binding, a stdio JSON-RPC binding and an in-process JavaScript binding with the same acceptance rules. Bridge existing formats. Do not require BSP, LSP or MTP as a complete provider API.

2. **Require identity and coverage.** A provider declares its identity and semantic adapter version, tool version, project/scope mapping, and capabilities. It identifies the selected scope and reports whether inventory and results cover it completely. Existing test providers preserve C14's `(project, relative test path, fullName)` identity and duplicate-name rules. Foreign IDs require an explicit mapping. Incomplete enumeration stays visible.

3. **Require key inputs independently of results.** Supply the check unit's input paths and resolution candidates, snapshot paths where applicable, and environment inputs: canonical config, config/setup dependency files, tool/runtime identity, installed dependency identity and allow-listed environment values. Core adds policy inputs and hashes the inputs under C3. Retain absent candidates for invalidation; current C3 excludes absent-path entries from the content key. Core records revision, commit and worktree as provenance. Keep wire version, semantic adapter version and key-format version distinct.

4. **Allow coarse providers, state their limits.** A command tier may declare a conservative file/project input scope and rerun that scope. Observed reads do not prove closure completeness. Neither format output nor successful RPC grants shared-cache validity. If a provider cannot supply the required input/scope evidence, report that limitation; do not silently treat the result as current or reusable. The coordinator must define package/project check units and their key inputs before enabling them. Do not invent fake source paths to fit today's file-based interface.

5. **Require completion and preserve uncertainty.** Bind updates and the final report to a run and selection. Carry outcomes, errors, durations, completed scopes and a terminal completion barrier. Preserve load/after-tests errors, startup failures, started projects, whole-file skips and withheld results where the tool can produce them. Unproved completion stays unknown. Final acceptance still waits for core's input-stability check. A diagnostic may disappear as recovered only after a complete, comparable scope report.

6. **Make capabilities explicit.** Map invalidation including `touch`, recreated projects, affected direct/transitive sets, enumeration, environment recheck and shutdown. A provider without precise affected selection may conservatively select all its scope. Translate cancellation signals, hard stop, timeout, child environment, logs, worker grants and file-end hints with defined meanings. Runtime observations, ignored-path reads and environment observations remain distinct. Focus needs literal-name selection and collected/matched counts; focused output never grants stored validity. Keep scheduling hints local or cached. Preserve C14's optional capabilities without requiring every provider to implement them.

7. **Keep diagnostic identity open with an owner.** The spec 016 coordinator owns the check-unit decision and the bounded edit comparison in divergence 1. Until resolved, require stable analysis scopes and complete diagnostic sets, preserve rule/message/location and versioned producer fingerprints, and make no generic per-finding identity promise. The same coordinator owns the transport-cost comparison before any performance claim or forced runner migration. These open questions do not block choosing JSON-RPC framing.

## Evidence used

- [011 C3, C4 and C14](../../011-core/spec.md) and [`RunnerAdapter`](../../../../src/core/types/runner.ts), only the cited core contract.
- The two findings and their retained probe records linked above. [Astra's source excerpts](probes/check-protocol-astra/source-notes.md) preserve the decisive BSP, MTP, LSP, SARIF, libtest and nextest passages. [Its source manifest](probes/check-protocol-astra/source-manifest.json) records exact URLs, pins and hashes.
- External versions and evidence tags are those recorded by the researchers. No new toolchain run, protocol trial, identity experiment or benchmark was performed by this judge.
