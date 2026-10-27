# Throwaway install-flow probe

Row 002-28 R3. Linux, Codex CLI 0.164.0, Node 24.21.0. Run from the repository:

```sh
node docs/specifications/002-codex-adapter/research/probes/wrapper-install-flow/run.mjs > docs/specifications/002-codex-adapter/research/probes/wrapper-install-flow/results.json
```

`PROBE_CODEX` can name another Codex executable. The default is this host's installed native CLI. Every child gets an allowlisted environment and scratch HOME, CODEX_HOME and XDG_CONFIG_HOME. No credentials, real configuration, releases or model requests are used. The local marketplace has two harmless plugins. Only one is requested. Unsupported dependency/script fields intentionally test whether acceptance executes them; they are not proposed syntax.

The probe asserts no dependency or install script ran, explicitly approves the one fixture hook, and confirms thread/start alone does not execute SessionStart. It never calls turn/start. Bootstrap checks are **shell replay** with the listed command and plugin environment: copy and execute a bundled seed once, execute an external replacement without changing approval, and emit a missing-runtime diagnostic. They contain no network operation. Offline here means the code needs no network, not an OS network-denial test. The final missing-seed replay edits the installed fixture; it does not claim real Codex would execute that modified bundle.

The tiny copy operation is not a production installer. It lacks locking, integrity checks, atomic publication, session pinning and cleanup. Real Codex SessionStart execution, network failure, runtime compatibility and timeout behavior were not exercised. The source excerpts explain the startup ordering. Successful runs remove their scratch directories; a failed assertion leaves its scratch directory for diagnosis. No node_modules is created.
