# Issue 210 throwaway probe

Run from the checkout with a packaged Squeal CLI path:

```sh
node docs/specifications/020-quality-gate/research/probes/issue-210/probe.mjs /home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.465/dist/cli/squeal.mjs
```

This is a throwaway research fixture, not a product test. It creates and removes
two temporary Git repositories. No dependencies, node_modules, generated fixture
or output belong in Git. It uses one node:test slot and checks the host load before
each gate. It aborts if one-minute load exceeds CPU count.

Only a passing callback changes against each base. An unrelated base test passes
in one repository and fails deterministically in the other. `--test` selects the
unrelated file explicitly; it imports no changed code. Each gate repeats once on
the same bytes to expose stored evidence. JSON lines record exact commands,
reports, stderr, durations, load and version. Assertions check the claimed
function coverage, loaders, gaps, completed files, failure count and exit code.

The probe does not reproduce high load, the original timing failure, automatic
selection in the original repository, daemon retries, or a cross-runner failure.
