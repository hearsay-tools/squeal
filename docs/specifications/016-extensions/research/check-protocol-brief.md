# Research brief 016-03: a language-neutral check protocol

Use /researcher. Shape: research. Outcome: which existing protocol or format could carry Squeal's runner contract to a check provider in any language, and what Squeal would have to add. Follow the rules in `README.md`.

Read first: 011 C3 (keys and closures), C4 (validity), C14 (adapter contracts, check identity); 013 V4 (check identity in Vitest); `src/core/types/runner.ts`.

Candidates: Build Server Protocol (test, compile, diagnostics, inverse sources), LSP diagnostics (push and pull), Microsoft.Testing.Platform's server mode, TeamCity service messages, TAP 14, JUnit XML, SARIF 2.1, `go test -json`, libtest JSON and cargo-nextest, Gradle's Tooling API test events, Bazel's Build Event Protocol. Add others you find; say why.

Questions:

1. **Coverage.** For each candidate: check identity, enumeration without a run, states and their transitions, failure output and location, streaming, a long-lived process, selection of a subset to run.
2. **Squeal's needs.** Map each `RunnerAdapter` member and C3's inputs onto the candidates: what each already carries, what Squeal must add (input closure for keys, the environment, focus, file-level errors, withheld results).
3. **Diagnostics.** How linters and type checkers report: per file or per project, stable identity of a diagnostic across edits (rule, location, message), and what makes a diagnostic "the same failure" for Squeal's fingerprint.
4. **Transport.** JSON-RPC over stdio against a command and its files against an in-process module: what LSP, BSP and Microsoft.Testing.Platform chose and their reasons; the per-edit cost a process boundary adds, from their docs.
5. **Probe.** Turn one small real output (for example `go test -json` or TAP from a tool on this host) into Squeal's `RunReport` shape with a throwaway script, and list what was missing.

Own `check-protocol.md` and `probes/check-protocol/`.
