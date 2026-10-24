# Primary-source excerpts

Fetched 2026-10-24. These are excerpts, not independent experiments. See `source-manifest.json` for hashes and byte-verified pins. The source line numbers refer to the fetched text, or to text extracted from HTML for names ending in `-plain`.

## BSP inverse sources are membership, not a closure

Source: [bsp-model](https://raw.githubusercontent.com/build-server-protocol/build-server-protocol/9097c78224910a4a285ba3207e55dd33c9e9da97/spec/src/main/resources/META-INF/smithy/bsp/bsp.smithy), lines 345–350.

> /// The inverse sources request is sent from the client to the server to query for
> /// the list of build targets containing a text document. The server communicates
> /// during the initialize handshake whether this method is supported or not. This
> /// request can be viewed as the inverse of `buildTarget/sources`, except it only
> /// works for text documents and not directories.
> @jsonRequest("buildTarget/inverseSources")

## BSP uses stdio to hide the daemon transport

Source: [bsp-discovery](https://raw.githubusercontent.com/build-server-protocol/build-server-protocol/9097c78224910a4a285ba3207e55dd33c9e9da97/docs/overview/server-discovery.md), lines 147–155.

>    BSP server.
> 1. Uses `stderr` to report execution progress to the user.
>
> The use of `stdin` and `stdout` to communicate with the build server simplifies
> the life of clients and allows build tools to implement their own underlying
> protocol to connect to a local/remote build tool instance/daemon.
>
> In addition, build tools can use the `argv` invocation for other purposes such
> as:

## MTP promises reuse only behind a capability

Source: [mtp-intro](https://raw.githubusercontent.com/microsoft/testfx/8ad685a835dce077d64d24f3a4b692fda16447ae/docs/mstest-runner-protocol/001-protocol-intro.md), lines 308–315.

>             // If true, the server supports test discovery.
>             supportsDiscovery: boolean;
>
>             // Experimental: The client currently uses this variable to determine if the test runner process can
>             // handle multiple discover/run requests. If true, then the client can keep the process alive.
>             // This has a potential performance benefit, where startup time and time to load test assemblies/sources
>             // only needs to occur once.
>             experimental_multiRequestSupport: boolean;

## MTP current implementation disables reuse

Source: [mtp-host](https://raw.githubusercontent.com/microsoft/testfx/8ad685a835dce077d64d24f3a4b692fda16447ae/src/Platform/Microsoft.Testing.Platform/Hosts/ServerTestHost.RequestExecution.cs), lines 43–53.

>                     ProcessId: ServiceProvider.GetEnvironment().ProcessId,
>                     ServerInfo: new ServerInfo("test-anywhere", Version: PlatformVersion.Version),
>                     Capabilities: new ServerCapabilities(
>                         new ServerTestingCapabilities(
>                             SupportsDiscovery: true,
>                             // Current implementation of testing platform and VS doesn't allow multi-request.
>                             MultiRequestSupport: false,
>                             VSTestProviderSupport: namedFeatureCapability?.IsSupported(JsonRpcStrings.VSTestProviderSupport) == true,
>                             SupportsAttachments: true,
>                             MultiConnectionProvider: false)
>                         {

## MTP terminal notification is separate from the response

Source: [mtp-intro](https://raw.githubusercontent.com/microsoft/testfx/8ad685a835dce077d64d24f3a4b692fda16447ae/docs/mstest-runner-protocol/001-protocol-intro.md), lines 606–622.

>     }
>     ```
>
> - Test update complete notification
>   - This notification is sent after all test update notifications are sent beforehand.
>       As soon as the client processes this notification it is guaranteed to be done
>       processing all node update notifications.
>   - Implementation detail: if a server sends callback notifications and returns a JSON-RPC response, vs-streamjsonrpc may resolve them in any order. As such, awaiting of the response is insufficient to guarantee that all updates were processed by the callback handler.
>   - method: `testing/testUpdates/tests`
>   - params: `TestUpdateNotificationParams` where `params.changes == null`.
>   - The server sends this terminal notification before the final success or error response for requests
>     whose discovery/run params were successfully deserialized, including requests canceled while queued
>     during initialization. Requests rejected by lifecycle checks and requests whose params could not be
>     deserialized receive only the error response.
>
> Response:
>

## MTP expects a single run when user code shares its process

Source: [mtp-intro](https://raw.githubusercontent.com/microsoft/testfx/8ad685a835dce077d64d24f3a4b692fda16447ae/docs/mstest-runner-protocol/001-protocol-intro.md), lines 374–379.

> The two most basic features that the a test runner should provide is the capability to discover and run tests.
>
> Since, in most cases the runner loads and runs user code in the runner's process, the expected lifetime of
> the test runner is a single run.
>
> This is the typical lifetime of a test runner process:

## LSP push replaces diagnostics and explicitly clears them

Source: [lsp-push](https://raw.githubusercontent.com/microsoft/language-server-protocol/baf2db31b5fb314a8f358f9a839d3c66e9d98734/_specifications/lsp/3.17/language/publishDiagnostics.md), lines 5–14.

> Diagnostics are "owned" by the server so it is the server's responsibility to clear them if necessary. The following rule is used for VS Code servers that generate diagnostics:
>
> * if a language is single file only (for example HTML) then diagnostics are cleared by the server when the file is closed. Please note that open / close events don't necessarily reflect what the user sees in the user interface. These events are ownership events. So with the current version of the specification it is possible that problems are not cleared although the file is not visible in the user interface since the client has not closed the file yet.
> * if a language has a project system (for example C#) diagnostics are not cleared when a file closes. When a project is opened all diagnostics for all files are recomputed (or read from a cache).
>
> When a file changes it is the server's responsibility to re-compute diagnostics and push them to the client. If the computed set is empty it has to push the empty array to clear former diagnostics. Newly pushed diagnostics always replace previously pushed diagnostics. There is no merging that happens on the client side.
>
> See also the [Diagnostic](#diagnostic) section.
>
> _Client Capability_:

## LSP pull ID is a report cache token

Source: [lsp-full](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/), lines 6193–6224.

> kind: DocumentDiagnosticReportKind.Full;
> /**
> * An optional result id. If provided it will
> * be sent on the next diagnostic request for the
> * same document.
> */
> resultId?: string;
> /**
> * The actual items.
> */
> items: Diagnostic[];
> }
> /**
> * A diagnostic report indicating that the last returned
> * report is still accurate.
> *
> * @since 3.17.0
> */
> export interface UnchangedDocumentDiagnosticReport {
> /**
> * A document diagnostic report indicating
> * no changes to the last result. A server can
> * only return `unchanged` if result ids are
> * provided.
> */
> kind: DocumentDiagnosticReportKind.Unchanged;
> /**
> * A result id which will be sent on the next
> * diagnostic request for the same document.
> */
> resultId: string;
> }

## SARIF stable identity should resist line movement

Source: [sarif](https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/sarif-v2.1.0-os.html), lines 6498–6514.

> 3.27.16 fingerprints property
> A result object MAY
> contain a property named fingerprints whose value
> is an object (§3.6).
> Each property value in this object SHALL be a string
> that provides a stable identifier for the result. This identifier SHALL,
> to the extent that it is feasible, be the same for all results that are
> logically identical, and different for any two results that are logically
> distinct. This requirement is intended to ensure that a fingerprint is
> resistant to changes that do not affect the logical identity of the result,
> such as the location of the root of a source code enlistment, or the line
> number where a result appears in a source file.
> Each property name in this object SHALL be a
> versioned hierarchical string (§3.5.4.2). A result management system MAY
> use the property names to identify the method used to calculate the
> fingerprint.
> EXAMPLE 1: In this example, the producer has calculated a fingerprint

## TAP diagnostics do not have a fixed schema

Source: [tap14](https://raw.githubusercontent.com/TestAnything/testanything.github.io/54d832874658d23c970f900d8b957eae5de8ac6f/tap-version-14-specification.md), lines 539–546.

> ```
>
> Currently (March 2022) the data structure represented by a YAML Diagnostic
> block has not been standardized.  TAP14 Harnesses _must_ allow any data
> structures supported by their YAML parser implementation.
>
> A future version of this specification _may_ provide guidance regarding
> YAML Diagnostic fields in common usage.

## Go listing excludes subtests

Source: [go-flags](https://raw.githubusercontent.com/golang/go/master/src/cmd/go/alldocs.go), lines 3475–3479.

> //	-list regexp
> //	    List tests, benchmarks, fuzz tests, or examples matching the regular
> //	    expression. No tests, benchmarks, fuzz tests, or examples will be run.
> //	    This will only list top-level tests. No subtest or subbenchmarks will be
> //	    shown.

## libtest JSON is gated

Source: [rust-opts](https://raw.githubusercontent.com/rust-lang/rust/stable/library/test/src/cli.rs), lines 411–418.

>         Some("terse") => OutputFormat::Terse,
>         Some("json") => {
>             if !allow_unstable {
>                 return Err("The \"json\" format is only accepted on the nightly compiler with -Z unstable-options".into());
>             }
>             OutputFormat::Json
>         }
>         Some("junit") => {

## nextest result output is experimental

Source: [nextest-json](https://raw.githubusercontent.com/nextest-rs/nextest/96cd53a54c410280a49fea71845d67fd1c93d937/site/src/docs/machine-readable/libtest-json.md), lines 8–25.

> # Libtest JSON output
>
> <!-- md:version 0.9.66 -->
>
> !!! experimental "Experimental: This feature is not yet stable"
>
>     - **Enable with:** Set `NEXTEST_EXPERIMENTAL_LIBTEST_JSON=1` in the environment
>     - **Tracking issue:** [#1152](https://github.com/nextest-rs/nextest/issues/1152)
>
> Nextest has experimental support for producing machine-readable output for test runs, in a format similar to `cargo test`'s [libtest JSON output](https://github.com/rust-lang/rust/issues/49359).
>
> The upstream libtest JSON format is currently unstable as of 2023-12. However, nextest's stabilization of the format is not gated on the upstream format being stabilized.
>
> The implementation, and this documentation, is a work in progress.
>
> ## Usage
>
> Pass in the `--message-format` option:

## Gradle reuses its daemon

Source: [gradle-doc](https://docs.gradle.org/current/userguide/tooling_api.html), lines 373–376.

> Tooling API and the Gradle Build Daemon
> The Tooling API always uses the Gradle daemon.
> This means that subsequent calls to the Tooling API, be it model building requests or task executing requests will be executed in the same long-living process.
> Gradle Daemon contains more details about the daemon, specifically information on situations when new daemons are forked.

## BEP carries result artifacts and cache provenance

Source: [bep-proto](https://raw.githubusercontent.com/bazelbuild/bazel/master/src/main/java/com/google/devtools/build/lib/buildeventstream/proto/build_event_stream.proto), lines 841–855.

> message TestResult {
>   reserved 1;
>
>   // The status of this test.
>   TestStatus status = 5;
>
>   // Additional details about the status of the test. This is intended for
>   // user display and must not be parsed.
>   string status_details = 9;
>
>   // True, if the reported attempt is taken from the tool's local cache.
>   bool cached_locally = 4;
>
>   // Time in milliseconds since the epoch at which the test attempt was started.
>   // Note: for cached test results, this is time can be before the start of the
