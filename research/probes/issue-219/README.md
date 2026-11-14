# Issue 219: throwaway component probe

This is research evidence, not a product test or proposed implementation.
Run from the Squeal repository root with its already-installed dependencies:

```sh
timeout 45s pnpm exec tsx research/probes/issue-219/run.mts
```

The probe checks one-minute load against the CPU count and skips when load is
higher. Each child has a 15-second bound; the provider has its normal 5-second
guard. There are three one-file cases. No install, build, daemon or test suite
runs. The scratch project is removed in `finally`; its `node_modules` contains
only a temporary symlink and is not committed.

The local Cezar checkout defaults to `~/projects/cezar`; set
`ISSUE_219_CEZAR` to another checkout with the same helper and existing
dependencies. Examined revision: `cc34d00d6fb8fa838f533d59c9a2d9eba1bf7a01`.
The helper hash is checked before import. It supplies the installed ast-grep
binary resolver and the actual `tally` and `compareToBaseline` functions.

`active-run-literal.yml` is copied unchanged from that checkout's
`.ai/ast-grep/rules/active-run-literal.yml` at that revision. SHA-256:
`e87ae93806a04512be79a1da57777b1daa2409e69db562a5e2aec8d5a59dfd25`.
The helper `packages/cezar/src/ast-grep-rules.testkit.ts` SHA-256 is
`7d9f90b979a8eb112d29c3d572749d733307670c575dda96af433a82fa1463ad`.

The scratch `package.json` defines `lint` as a narrow invocation of this probe's
`--repository-lint` branch. That branch runs the real ast-grep binary with
`scan --rule <copied rule> --json=compact <one file>`, then compares matches
with an empty baseline using the real repository helper. The new file has no
allowance. A new match exits 1, as the repository's lint runner does. This is
not a run of the full original repository lint command.

The enabled provider is called directly. The fixture records
`lint: { enabled: true, tools: ["oxlint"] }`, but no daemon reads that policy.
The commit tally uses an explicit synthetic view of the actual provider
result: one changed file, equal committed and working bytes, no differing
environment inputs, no test results. It calls Squeal's real `lintCounts` and
`commitReportText`. The transition calls real `lintTransition` and
`lintEntryLine`. No fake oxlint response is supplied. This verifies component
composition, not the store, scheduler, HEAD watcher or harness delivery.

`result.json` is the captured successful run: Squeal source 0.1.497, oxlint
1.90.0, ast-grep 0.51.0, Node 26.13.0, pnpm 12.15.0, tsx 4.23.15.
The fixture path in stderr belonged to the removed scratch directory.

Cases: both linters fail; oxlint passes while ast-grep fails; both pass.
Assertions check the actual oxlint counts, covered-file membership, provider
availability, child termination and repository-lint exit codes.
