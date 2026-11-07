# Issue 165 probe (throwaway)

Throwaway research probe for `../../issue-165.md`. Not product code. Delete freely.

`run.mjs` builds two scratch git repositories under `$TMPDIR` (a node:test project, no Python runner, branched Python functions), starts the committed CLI's daemon in each with an isolated HOME, and saves `squeal code` text and JSON to `results.json`. It refuses to start a fixture when the one-minute load is above the CPU count.

Run from the repository root: `node docs/specifications/015-coverage-complexity/research/probes/issue-165/run.mjs`
