# Issue 167 throwaway probe

This is a throwaway, read-only triage probe, not a product test or quality engine.
Run from the repository root with installed dependencies:

```sh
pnpm exec tsx docs/specifications/015-coverage-complexity/research/probes/issue-167/probe.mts > docs/specifications/015-coverage-complexity/research/probes/issue-167/results.json
```

It checks host load before live work, invokes existing pure coverage functions,
and calls the source CLI for help, an unsupported command and a stored report.
It does not run tests, start a daemon or build the project. Existing session
validation can remain active. The CLI calls have a 20-second timeout each.
`results.json` records the exact source commit, version, loads and outputs.
The unsupported command's stderr is reduced to its first line (the rest is
ordinary global help). No node_modules or external repositories are included.
