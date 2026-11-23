# Issue 268 classifier probe

Throwaway research fixture, not a product regression test. From the repository root:

```sh
node --disable-warning=ExperimentalWarning docs/specifications/023-results-at-commit/research/probes/issue-268/probe.mjs > docs/specifications/023-results-at-commit/research/probes/issue-268/result.json
```

Requires Node with `node:module.stripTypeScriptTypes` and local git refs. Defaults
to `squeal--v0.1.600` and `HEAD`; explicit refs can follow the script name.
It reads three source files from each commit with `git show`, strips types into
a temporary directory, imports the actual classifier, and removes that directory.
No dependency install, checkout, daemon, ACP process or test suite runs. It skips
the experiment if the one-minute load exceeds the available CPU count.

The input models issue #268's reported failure kinds: three body assertions and
one unstaged file-level error. The trimmed issue does not show `stage`; the body
stages reproduce its `kind: assertion` records. Passing green sides are supplied
controls, not measured results from the reported repository. Output captures
the exact source commits, Node version, time, host load and ten cases per ref.

Findings: `docs/specifications/023-results-at-commit/research/issue-268.md`.
