# Probe: issue #192, gate results under a held store write lock

Throwaway. Not part of the product or its test suite. Findings:
`../../issue-192.md`.

Runs `squeal code --base main --json` in process (the test kit's `code`)
in scratch git repositories with five node:test files, under three store
states: no lock, a write lock a child process holds through the whole
gate, and a write lock the child frees 3 s after the gate starts its run.

Run from the repository root:

    node_modules/.bin/vitest run --config docs/specifications/020-quality-gate/research/probes/issue-192/vitest.config.ts

Scratch repositories go under `os.tmpdir()` and are removed. The lock is
taken only on the scratch repository's own `.git/squeal/store.sqlite`.
